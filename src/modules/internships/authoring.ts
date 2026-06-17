import { z } from 'zod';
import { AppError } from '../../core/appError';
import type { PaginationMeta } from '../../core/apiResponse';
import { query, queryOne, tx } from '../../db/pool';
import type { AuthUser } from '../../middlewares/auth';
import { audit } from '../admin/service';

/**
 * Internship AUTHORING (the session promised in internships/routes.ts).
 * Super-admins and moderators author/manage any internship; instructors manage
 * only their own. Curriculum (sections + lessons) lives here too; batches stay
 * in batches.ts. Every mutation is written to the audit log.
 */

/* ----------------------------------- enums -------------------------------- */
const PROVIDER = ['system', 'external'] as const;
const PRICING = ['free', 'paid', 'stipend'] as const;
const DELIVERY = ['recorded', 'live', 'hybrid', 'project_only'] as const;
const PACE = ['batch', 'self_paced'] as const;
const LEVEL = ['beginner', 'intermediate', 'advanced'] as const;
const LESSON_TYPE = ['video', 'live', 'document', 'quiz'] as const;
const STATUS = ['draft', 'pending_review', 'published', 'rejected', 'archived'] as const;

/* ---------------------------------- schemas ------------------------------- */
const faqsSchema = z
  .array(z.object({ question: z.string().min(3).max(300), answer: z.string().min(1).max(2000) }))
  .max(30);

export const createInternshipSchema = z
  .object({
    title: z.string().min(4).max(160),
    categoryId: z.coerce.number().int().positive(),
    instructorProfileId: z.coerce.number().int().positive().optional(),
    shortDescription: z.string().max(300).optional(),
    description: z.string().max(20000).optional(),
    outcomes: z.array(z.string().min(1).max(300)).max(40).default([]),
    prerequisites: z.array(z.string().min(1).max(300)).max(40).default([]),
    faqs: faqsSchema.default([]),
    languages: z.array(z.string().min(1).max(40)).min(1).default(['english']),
    providerType: z.enum(PROVIDER).default('system'),
    pricingType: z.enum(PRICING).default('free'),
    price: z.coerce.number().min(0).default(0),
    stipendAmount: z.coerce.number().min(0).optional(),
    deliveryMode: z.enum(DELIVERY),
    paceType: z.enum(PACE).default('batch'),
    level: z.enum(LEVEL).optional(),
    durationWeeks: z.coerce.number().int().min(1).max(104).optional(),
    thumbnailUrl: z.string().url().max(500).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.pricingType === 'paid' && !(v.price > 0)) ctx.addIssue({ code: 'custom', message: 'Paid internships need a price greater than 0', path: ['price'] });
    if (v.pricingType !== 'paid' && v.price !== 0) ctx.addIssue({ code: 'custom', message: 'Only paid internships can set a price', path: ['price'] });
    if ((v.pricingType === 'stipend') !== (v.stipendAmount != null)) ctx.addIssue({ code: 'custom', message: 'Stipend internships must set a stipend amount (and only those)', path: ['stipendAmount'] });
  });
export type CreateInternshipInput = z.infer<typeof createInternshipSchema>;

export const patchInternshipSchema = z
  .object({
    title: z.string().min(4).max(160).optional(),
    categoryId: z.coerce.number().int().positive().optional(),
    instructorProfileId: z.coerce.number().int().positive().optional(),
    shortDescription: z.string().max(300).nullable().optional(),
    description: z.string().max(20000).nullable().optional(),
    outcomes: z.array(z.string().min(1).max(300)).max(40).optional(),
    prerequisites: z.array(z.string().min(1).max(300)).max(40).optional(),
    faqs: faqsSchema.optional(),
    languages: z.array(z.string().min(1).max(40)).min(1).optional(),
    providerType: z.enum(PROVIDER).optional(),
    pricingType: z.enum(PRICING).optional(),
    price: z.coerce.number().min(0).optional(),
    stipendAmount: z.coerce.number().min(0).nullable().optional(),
    deliveryMode: z.enum(DELIVERY).optional(),
    paceType: z.enum(PACE).optional(),
    level: z.enum(LEVEL).nullable().optional(),
    durationWeeks: z.coerce.number().int().min(1).max(104).nullable().optional(),
    thumbnailUrl: z.string().url().max(500).nullable().optional(),
    regenerateSlug: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Provide at least one field' });
export type PatchInternshipInput = z.infer<typeof patchInternshipSchema>;

export const listInternshipsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(STATUS).optional(),
  categoryId: z.coerce.number().int().positive().optional(),
  q: z.string().max(160).optional(),
});
export type ListInternshipsInput = z.infer<typeof listInternshipsSchema>;

export const statusActionSchema = z.object({
  action: z.enum(['submit', 'publish', 'unpublish', 'archive']),
  reason: z.string().max(1000).optional(),
});
export type StatusActionInput = z.infer<typeof statusActionSchema>;

export const sectionCreateSchema = z.object({
  title: z.string().min(2).max(160),
  displayOrder: z.coerce.number().int().min(0).optional(),
});
export type SectionCreateInput = z.infer<typeof sectionCreateSchema>;

export const sectionPatchSchema = z
  .object({
    title: z.string().min(2).max(160).optional(),
    displayOrder: z.coerce.number().int().min(0).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Provide at least one field' });
export type SectionPatchInput = z.infer<typeof sectionPatchSchema>;

export const lessonCreateSchema = z
  .object({
    title: z.string().min(2).max(200),
    type: z.enum(LESSON_TYPE),
    displayOrder: z.coerce.number().int().min(0).optional(),
    durationMinutes: z.coerce.number().int().min(0).max(100000).nullable().optional(),
    bunnyVideoId: z.string().max(200).nullable().optional(),
    documentUrl: z.string().url().max(500).nullable().optional(),
    quizId: z.coerce.number().int().positive().nullable().optional(),
    content: z.string().max(20000).nullable().optional(),
    isPreview: z.boolean().optional(),
    isMandatory: z.boolean().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.type === 'quiz' && !v.quizId) ctx.addIssue({ code: 'custom', message: 'Quiz lessons need a quizId', path: ['quizId'] });
  });
export type LessonCreateInput = z.infer<typeof lessonCreateSchema>;

export const lessonPatchSchema = z
  .object({
    title: z.string().min(2).max(200).optional(),
    displayOrder: z.coerce.number().int().min(0).optional(),
    durationMinutes: z.coerce.number().int().min(0).max(100000).nullable().optional(),
    bunnyVideoId: z.string().max(200).nullable().optional(),
    documentUrl: z.string().url().max(500).nullable().optional(),
    quizId: z.coerce.number().int().positive().nullable().optional(),
    content: z.string().max(20000).nullable().optional(),
    isPreview: z.boolean().optional(),
    isMandatory: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Provide at least one field' });
export type LessonPatchInput = z.infer<typeof lessonPatchSchema>;

/* --------------------------------- helpers -------------------------------- */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

function isAdmin(user: AuthUser): boolean {
  return user.roles.includes('super_admin') || user.roles.includes('moderator');
}

async function ownInstructorProfileId(userId: number): Promise<number | null> {
  const r = await queryOne<{ id: number }>(`select id from instructor_profiles where user_id = $1`, [userId]);
  return r?.id ?? null;
}

/** Owner (instructor) or any admin may manage. Returns the current status. */
async function assertCanManageInternship(user: AuthUser, internshipId: number): Promise<{ status: string }> {
  const row = await queryOne<{ status: string; user_id: number }>(
    `select i.status, ip.user_id from internships i
     join instructor_profiles ip on ip.id = i.instructor_profile_id
     where i.id = $1`,
    [internshipId],
  );
  if (!row) throw AppError.notFound('Internship');
  if (!isAdmin(user) && row.user_id !== user.id) throw AppError.forbidden('Not your internship');
  return { status: row.status };
}

async function internshipOfSection(sectionId: number): Promise<number> {
  const r = await queryOne<{ internship_id: number }>(`select internship_id from curriculum_sections where id = $1`, [sectionId]);
  if (!r) throw AppError.notFound('Section');
  return r.internship_id;
}

async function internshipOfLesson(lessonId: number): Promise<number> {
  const r = await queryOne<{ internship_id: number }>(
    `select s.internship_id from lessons l join curriculum_sections s on s.id = l.section_id where l.id = $1`,
    [lessonId],
  );
  if (!r) throw AppError.notFound('Lesson');
  return r.internship_id;
}

function slugify(s: string): string {
  const base = s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return base || 'internship';
}

async function uniqueSlug(base: string, excludeId?: number): Promise<string> {
  let slug = base;
  let n = 1;
  for (;;) {
    const row = await queryOne<{ id: number }>(`select id from internships where slug = $1`, [slug]);
    if (!row || (excludeId !== undefined && Number(row.id) === excludeId)) return slug;
    n += 1;
    slug = `${base}-${n}`;
  }
}

async function nextOrder(table: 'curriculum_sections' | 'lessons', col: 'internship_id' | 'section_id', parentId: number): Promise<number> {
  const r = await queryOne<{ next: number }>(
    `select coalesce(max(display_order) + 1, 0) as next from ${table} where ${col} = $1`,
    [parentId],
  );
  return r?.next ?? 0;
}

function isFkViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === '23503';
}

function toListDto(r: Row): Record<string, unknown> {
  return {
    id: Number(r.id),
    title: r.title,
    slug: r.slug,
    status: r.status,
    pricingType: r.pricing_type,
    price: Number(r.price),
    deliveryMode: r.delivery_mode,
    paceType: r.pace_type,
    level: r.level,
    enrollmentCount: Number(r.enrollment_count),
    publishedAt: r.published_at,
    updatedAt: r.updated_at,
    categoryName: r.category_name,
    instructorName: r.instructor_name,
    sectionCount: Number(r.section_count),
    lessonCount: Number(r.lesson_count),
  };
}

async function detailById(internshipId: number): Promise<Record<string, unknown> | null> {
  const row = await queryOne<{ detail: Record<string, unknown> }>(
    `select jsonb_build_object(
        'id', i.id, 'title', i.title, 'slug', i.slug, 'status', i.status,
        'shortDescription', i.short_description, 'description', i.description,
        'outcomes', i.outcomes, 'prerequisites', i.prerequisites, 'faqs', i.faqs, 'languages', i.languages,
        'providerType', i.provider_type, 'pricingType', i.pricing_type, 'price', i.price,
        'stipendAmount', i.stipend_amount, 'currency', i.currency, 'gstRate', i.gst_rate,
        'deliveryMode', i.delivery_mode, 'paceType', i.pace_type, 'level', i.level,
        'durationWeeks', i.duration_weeks, 'thumbnailUrl', i.thumbnail_url,
        'categoryId', i.category_id, 'categoryName', c.name,
        'instructorProfileId', i.instructor_profile_id, 'instructorName', u.full_name,
        'enrollmentCount', i.enrollment_count, 'publishedAt', i.published_at,
        'rejectionReason', i.rejection_reason, 'updatedAt', i.updated_at,
        'sections', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', s.id, 'title', s.title, 'displayOrder', s.display_order,
            'lessons', (
              select coalesce(jsonb_agg(jsonb_build_object(
                'id', l.id, 'title', l.title, 'type', l.type, 'displayOrder', l.display_order,
                'durationMinutes', l.duration_minutes, 'bunnyVideoId', l.bunny_video_id,
                'videoStatus', l.video_status, 'documentUrl', l.document_url, 'quizId', l.quiz_id,
                'content', l.content, 'isPreview', l.is_preview, 'isMandatory', l.is_mandatory
              ) order by l.display_order), '[]'::jsonb)
              from lessons l where l.section_id = s.id
            )
          ) order by s.display_order)
          from curriculum_sections s where s.internship_id = i.id
        ), '[]'::jsonb),
        'batches', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', b.id, 'name', b.name, 'startDate', b.start_date, 'endDate', b.end_date,
            'seatsTotal', b.seats_total, 'seatsLeft', b.seats_total - b.seats_filled, 'status', b.status
          ) order by b.start_date)
          from internship_batches b where b.internship_id = i.id
        ), '[]'::jsonb)
      ) as detail
      from internships i
      join categories c on c.id = i.category_id
      join instructor_profiles ip on ip.id = i.instructor_profile_id
      join users u on u.id = ip.user_id
      where i.id = $1`,
    [internshipId],
  );
  return row?.detail ?? null;
}

/* --------------------------------- service -------------------------------- */
export const authoringService = {
  async create(user: AuthUser, input: CreateInternshipInput): Promise<Record<string, unknown>> {
    let instructorProfileId = input.instructorProfileId ?? null;
    if (!isAdmin(user)) {
      const own = await ownInstructorProfileId(user.id);
      if (!own) throw AppError.forbidden('You need an instructor profile to author internships');
      instructorProfileId = own; // instructors author only under their own profile
    }
    if (!instructorProfileId) throw AppError.validation('instructorProfileId is required');

    const cat = await queryOne<{ id: number }>(`select id from categories where id = $1`, [input.categoryId]);
    if (!cat) throw AppError.validation('Unknown categoryId');
    const ins = await queryOne<{ id: number }>(`select id from instructor_profiles where id = $1`, [instructorProfileId]);
    if (!ins) throw AppError.validation('Unknown instructorProfileId');

    const slug = await uniqueSlug(slugify(input.title));
    const created = await queryOne<{ id: number }>(
      `insert into internships
         (instructor_profile_id, category_id, created_by, title, slug, short_description, description,
          outcomes, prerequisites, faqs, languages, provider_type, pricing_type, price, stipend_amount,
          delivery_mode, pace_type, level, duration_weeks, thumbnail_url)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12::provider_type, $13::pricing_type, $14, $15,
               $16::delivery_mode, $17::pace_type, $18::internship_level, $19, $20)
       returning id`,
      [
        instructorProfileId, input.categoryId, user.id, input.title, slug,
        input.shortDescription ?? null, input.description ?? null,
        input.outcomes, input.prerequisites, JSON.stringify(input.faqs ?? []), input.languages,
        input.providerType, input.pricingType, input.price, input.stipendAmount ?? null,
        input.deliveryMode, input.paceType, input.level ?? null, input.durationWeeks ?? null,
        input.thumbnailUrl ?? null,
      ],
    );
    const id = Number(created?.id);
    await audit({ actorId: user.id, action: 'internship.create', entityType: 'internship', entityId: id, after: { slug, title: input.title } });
    return (await detailById(id)) ?? { id, slug };
  },

  async patch(user: AuthUser, id: number, input: PatchInternshipInput): Promise<Record<string, unknown>> {
    await assertCanManageInternship(user, id);
    if (input.instructorProfileId !== undefined && !isAdmin(user)) {
      throw AppError.forbidden('Only moderators can reassign the instructor');
    }
    const cur = await queryOne<{ pricing_type: string; price: string; stipend_amount: string | null }>(
      `select pricing_type, price, stipend_amount from internships where id = $1`,
      [id],
    );
    if (!cur) throw AppError.notFound('Internship');

    // Normalise pricing so the DB check constraints are always satisfied.
    let { pricingType, price, stipendAmount } = input;
    const finalPricing = pricingType ?? cur.pricing_type;
    if (pricingType !== undefined) {
      if (finalPricing !== 'paid' && price === undefined) price = 0;
      if (finalPricing !== 'stipend' && stipendAmount === undefined) stipendAmount = null;
    }
    const finalPrice = price !== undefined ? price : Number(cur.price);
    const finalStipend = stipendAmount !== undefined ? stipendAmount : cur.stipend_amount != null ? Number(cur.stipend_amount) : null;
    if (finalPricing === 'paid' && !(finalPrice > 0)) throw AppError.validation('Paid internships need a price greater than 0');
    if (finalPricing !== 'paid' && finalPrice !== 0) throw AppError.validation('Only paid internships can set a price');
    if ((finalPricing === 'stipend') !== (finalStipend != null)) throw AppError.validation('Stipend internships must set a stipend amount (and only those)');

    const sets: string[] = [];
    const params: unknown[] = [];
    const push = (col: string, val: unknown, cast = ''): void => {
      params.push(val);
      sets.push(`${col} = $${params.length}${cast ? `::${cast}` : ''}`);
    };
    if (input.title !== undefined) push('title', input.title);
    if (input.title !== undefined && input.regenerateSlug) push('slug', await uniqueSlug(slugify(input.title), id));
    if (input.categoryId !== undefined) push('category_id', input.categoryId);
    if (input.instructorProfileId !== undefined) push('instructor_profile_id', input.instructorProfileId);
    if (input.shortDescription !== undefined) push('short_description', input.shortDescription);
    if (input.description !== undefined) push('description', input.description);
    if (input.outcomes !== undefined) push('outcomes', input.outcomes);
    if (input.prerequisites !== undefined) push('prerequisites', input.prerequisites);
    if (input.faqs !== undefined) push('faqs', JSON.stringify(input.faqs), 'jsonb');
    if (input.languages !== undefined) push('languages', input.languages);
    if (input.providerType !== undefined) push('provider_type', input.providerType, 'provider_type');
    if (pricingType !== undefined) push('pricing_type', pricingType, 'pricing_type');
    if (price !== undefined) push('price', price);
    if (stipendAmount !== undefined) push('stipend_amount', stipendAmount);
    if (input.deliveryMode !== undefined) push('delivery_mode', input.deliveryMode, 'delivery_mode');
    if (input.paceType !== undefined) push('pace_type', input.paceType, 'pace_type');
    if (input.level !== undefined) push('level', input.level, 'internship_level');
    if (input.durationWeeks !== undefined) push('duration_weeks', input.durationWeeks);
    if (input.thumbnailUrl !== undefined) push('thumbnail_url', input.thumbnailUrl);

    if (sets.length > 0) {
      params.push(id);
      await query(`update internships set ${sets.join(', ')}, updated_at = now() where id = $${params.length}`, params);
    }
    await audit({ actorId: user.id, action: 'internship.update', entityType: 'internship', entityId: id, after: input });
    return (await detailById(id)) ?? { id };
  },

  async list(user: AuthUser, input: ListInternshipsInput): Promise<{ items: unknown[]; pagination: PaginationMeta }> {
    const where: string[] = [];
    const params: unknown[] = [];
    const add = (cond: string, v: unknown): void => {
      params.push(v);
      where.push(cond.replace('$$', `$${params.length}`));
    };
    if (!isAdmin(user)) add('i.instructor_profile_id = $$', (await ownInstructorProfileId(user.id)) ?? -1);
    if (input.status) add('i.status = $$::internship_status', input.status);
    if (input.categoryId) add('i.category_id = $$', input.categoryId);
    if (input.q) add('i.title ilike $$', `%${input.q}%`);
    const whereSql = where.length ? `where ${where.join(' and ')}` : '';

    const totalRow = await queryOne<{ count: string }>(`select count(*)::int as count from internships i ${whereSql}`, params);
    const total = totalRow ? Number(totalRow.count) : 0;
    const limit = input.limit;
    const offset = (input.page - 1) * limit;

    const rows = await query<Row>(
      `select i.id, i.title, i.slug, i.status, i.pricing_type, i.price, i.delivery_mode, i.pace_type,
              i.level, i.enrollment_count, i.published_at, i.updated_at,
              c.name as category_name, u.full_name as instructor_name,
              (select count(*) from curriculum_sections s where s.internship_id = i.id) as section_count,
              (select count(*) from lessons l join curriculum_sections s on s.id = l.section_id where s.internship_id = i.id) as lesson_count
       from internships i
       join categories c on c.id = i.category_id
       join instructor_profiles ip on ip.id = i.instructor_profile_id
       join users u on u.id = ip.user_id
       ${whereSql}
       order by i.updated_at desc
       limit ${limit} offset ${offset}`,
      params,
    );
    return {
      items: rows.map(toListDto),
      pagination: { page: input.page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
    };
  },

  async get(user: AuthUser, id: number): Promise<Record<string, unknown>> {
    await assertCanManageInternship(user, id);
    const detail = await detailById(id);
    if (!detail) throw AppError.notFound('Internship');
    return detail;
  },

  async setStatus(user: AuthUser, id: number, input: StatusActionInput): Promise<Record<string, unknown>> {
    const { status } = await assertCanManageInternship(user, id);
    const admin = isAdmin(user);
    let next: string;
    if (input.action === 'submit') {
      if (!['draft', 'rejected'].includes(status)) throw AppError.conflict(`Cannot submit for review from "${status}"`);
      next = 'pending_review';
    } else if (input.action === 'publish') {
      if (!admin) throw AppError.forbidden('Only moderators can publish');
      if (status === 'published') return { id, status };
      const cnt = await queryOne<{ n: string }>(
        `select count(*)::int as n from lessons l join curriculum_sections s on s.id = l.section_id where s.internship_id = $1`,
        [id],
      );
      if (!cnt || Number(cnt.n) === 0) throw AppError.conflict('Add at least one lesson before publishing');
      next = 'published';
    } else if (input.action === 'unpublish') {
      if (!admin) throw AppError.forbidden('Only moderators can unpublish');
      if (status !== 'published') throw AppError.conflict(`Cannot unpublish from "${status}"`);
      next = 'draft';
    } else {
      if (!admin) throw AppError.forbidden('Only moderators can archive');
      next = 'archived';
    }
    await query(
      `update internships set status = $2::internship_status,
         published_at = case when $2 = 'published' and published_at is null then now() else published_at end,
         rejection_reason = case when $2 = 'rejected' then rejection_reason else null end,
         updated_at = now()
       where id = $1`,
      [id, next],
    );
    await audit({ actorId: user.id, action: `internship.${input.action}`, entityType: 'internship', entityId: id, before: { status }, after: { status: next, reason: input.reason ?? null } });
    return { id, status: next };
  },

  /* ------------------------------- curriculum ----------------------------- */
  async addSection(user: AuthUser, internshipId: number, input: SectionCreateInput): Promise<Record<string, unknown>> {
    await assertCanManageInternship(user, internshipId);
    const order = input.displayOrder ?? (await nextOrder('curriculum_sections', 'internship_id', internshipId));
    const row = await queryOne<Row>(
      `insert into curriculum_sections (internship_id, title, display_order) values ($1, $2, $3)
       returning id, internship_id, title, display_order`,
      [internshipId, input.title, order],
    );
    return { id: Number(row?.id), internshipId, title: row?.title, displayOrder: row?.display_order };
  },

  async patchSection(user: AuthUser, sectionId: number, input: SectionPatchInput): Promise<Record<string, unknown>> {
    const internshipId = await internshipOfSection(sectionId);
    await assertCanManageInternship(user, internshipId);
    const sets: string[] = [];
    const params: unknown[] = [];
    if (input.title !== undefined) { params.push(input.title); sets.push(`title = $${params.length}`); }
    if (input.displayOrder !== undefined) { params.push(input.displayOrder); sets.push(`display_order = $${params.length}`); }
    params.push(sectionId);
    const row = await queryOne<Row>(
      `update curriculum_sections set ${sets.join(', ')}, updated_at = now() where id = $${params.length}
       returning id, internship_id, title, display_order`,
      params,
    );
    return { id: Number(row?.id), internshipId: row?.internship_id, title: row?.title, displayOrder: row?.display_order };
  },

  async deleteSection(user: AuthUser, sectionId: number): Promise<Record<string, unknown>> {
    const internshipId = await internshipOfSection(sectionId);
    await assertCanManageInternship(user, internshipId);
    try {
      await tx(async (client) => {
        await client.query(`delete from lessons where section_id = $1`, [sectionId]);
        await client.query(`delete from curriculum_sections where id = $1`, [sectionId]);
      });
    } catch (e) {
      if (isFkViolation(e)) throw AppError.conflict('Cannot delete — students already have progress in this section');
      throw e;
    }
    return { id: sectionId, deleted: true };
  },

  async addLesson(user: AuthUser, sectionId: number, input: LessonCreateInput): Promise<Record<string, unknown>> {
    const internshipId = await internshipOfSection(sectionId);
    await assertCanManageInternship(user, internshipId);
    const order = input.displayOrder ?? (await nextOrder('lessons', 'section_id', sectionId));
    const videoStatus = input.type === 'video' ? (input.bunnyVideoId ? 'ready' : 'processing') : null;
    const row = await queryOne<{ id: number }>(
      `insert into lessons
         (section_id, title, type, display_order, duration_minutes, bunny_video_id, video_status,
          document_url, quiz_id, content, is_preview, is_mandatory)
       values ($1, $2, $3::lesson_type, $4, $5, $6, $7::video_status, $8, $9, $10, $11, $12)
       returning id`,
      [
        sectionId, input.title, input.type, order, input.durationMinutes ?? null,
        input.bunnyVideoId ?? null, videoStatus, input.documentUrl ?? null, input.quizId ?? null,
        input.content ?? null, input.isPreview ?? false, input.isMandatory ?? true,
      ],
    );
    return { id: Number(row?.id), sectionId, internshipId };
  },

  async patchLesson(user: AuthUser, lessonId: number, input: LessonPatchInput): Promise<Record<string, unknown>> {
    const internshipId = await internshipOfLesson(lessonId);
    await assertCanManageInternship(user, internshipId);
    const sets: string[] = [];
    const params: unknown[] = [];
    const push = (col: string, val: unknown, cast = ''): void => {
      params.push(val);
      sets.push(`${col} = $${params.length}${cast ? `::${cast}` : ''}`);
    };
    if (input.title !== undefined) push('title', input.title);
    if (input.displayOrder !== undefined) push('display_order', input.displayOrder);
    if (input.durationMinutes !== undefined) push('duration_minutes', input.durationMinutes);
    if (input.bunnyVideoId !== undefined) {
      push('bunny_video_id', input.bunnyVideoId);
      push('video_status', input.bunnyVideoId ? 'ready' : null, 'video_status');
    }
    if (input.documentUrl !== undefined) push('document_url', input.documentUrl);
    if (input.quizId !== undefined) push('quiz_id', input.quizId);
    if (input.content !== undefined) push('content', input.content);
    if (input.isPreview !== undefined) push('is_preview', input.isPreview);
    if (input.isMandatory !== undefined) push('is_mandatory', input.isMandatory);
    params.push(lessonId);
    const row = await queryOne<{ id: number }>(
      `update lessons set ${sets.join(', ')}, updated_at = now() where id = $${params.length} returning id`,
      params,
    );
    return { id: Number(row?.id), internshipId };
  },

  async deleteLesson(user: AuthUser, lessonId: number): Promise<Record<string, unknown>> {
    const internshipId = await internshipOfLesson(lessonId);
    await assertCanManageInternship(user, internshipId);
    try {
      await query(`delete from lessons where id = $1`, [lessonId]);
    } catch (e) {
      if (isFkViolation(e)) throw AppError.conflict('Cannot delete — students already have progress in this lesson');
      throw e;
    }
    return { id: lessonId, deleted: true };
  },
};
