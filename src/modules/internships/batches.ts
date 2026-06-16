import { z } from 'zod';
import { AppError } from '../../core/appError';
import { query, queryOne } from '../../db/pool';
import type { AuthUser } from '../../middlewares/auth';

/**
 * Batch management, shipped with module 2.4 (full internship authoring comes
 * in its own session). Instructors manage batches of THEIR internships;
 * moderators/super_admin manage any.
 */

export const batchCreateSchema = z
  .object({
    name: z.string().min(2).max(120),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    enrollmentDeadline: z.string().datetime({ offset: true }).optional(),
    seatsTotal: z.coerce.number().int().min(1),
    waitlistEnabled: z.boolean().default(false),
    waitlistLimit: z.coerce.number().int().min(1).optional(),
    status: z.enum(['scheduled', 'enrolling']).default('scheduled'),
  })
  .refine((v) => v.endDate >= v.startDate, { message: 'endDate must be on/after startDate' });
export type BatchCreateInput = z.infer<typeof batchCreateSchema>;

export const batchPatchSchema = z
  .object({
    name: z.string().min(2).max(120).optional(),
    enrollmentDeadline: z.string().datetime({ offset: true }).optional(),
    seatsTotal: z.coerce.number().int().min(1).optional(),
    waitlistEnabled: z.boolean().optional(),
    waitlistLimit: z.coerce.number().int().min(1).optional(),
    status: z.enum(['scheduled', 'enrolling', 'ongoing', 'completed', 'cancelled']).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Provide at least one field' });
export type BatchPatchInput = z.infer<typeof batchPatchSchema>;

async function assertCanManage(user: AuthUser, internshipId: number): Promise<void> {
  if (user.roles.includes('super_admin') || user.roles.includes('moderator')) return;
  const owner = await queryOne<{ user_id: number }>(
    `select ip.user_id from internships i
     join instructor_profiles ip on ip.id = i.instructor_profile_id
     where i.id = $1`,
    [internshipId],
  );
  if (!owner) throw AppError.notFound('Internship');
  if (owner.user_id !== user.id) throw AppError.forbidden('Not your internship');
}

const B_COLS = `id, internship_id, name, start_date::text as start_date, end_date::text as end_date,
  enrollment_deadline, seats_total, seats_filled, waitlist_enabled, waitlist_limit, status`;

function toDto(b: Record<string, unknown>): Record<string, unknown> {
  return {
    id: b.id,
    internshipId: b.internship_id,
    name: b.name,
    startDate: b.start_date,
    endDate: b.end_date,
    enrollmentDeadline: b.enrollment_deadline,
    seatsTotal: b.seats_total,
    seatsFilled: b.seats_filled,
    seatsLeft: Number(b.seats_total) - Number(b.seats_filled),
    waitlistEnabled: b.waitlist_enabled,
    waitlistLimit: b.waitlist_limit,
    status: b.status,
  };
}

export const batchesService = {
  async create(user: AuthUser, internshipId: number, input: BatchCreateInput): Promise<unknown> {
    await assertCanManage(user, internshipId);
    const row = await queryOne<Record<string, unknown>>(
      `insert into internship_batches
         (internship_id, name, start_date, end_date, enrollment_deadline, seats_total,
          waitlist_enabled, waitlist_limit, status)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       returning ${B_COLS}`,
      [
        internshipId,
        input.name,
        input.startDate,
        input.endDate,
        input.enrollmentDeadline ?? null,
        input.seatsTotal,
        input.waitlistEnabled,
        input.waitlistLimit ?? null,
        input.status,
      ],
    );
    return toDto(row as Record<string, unknown>);
  },

  async list(user: AuthUser, internshipId: number): Promise<unknown[]> {
    await assertCanManage(user, internshipId);
    const rows = await query<Record<string, unknown>>(
      `select ${B_COLS} from internship_batches where internship_id = $1 order by start_date`,
      [internshipId],
    );
    return rows.map(toDto);
  },

  async patch(user: AuthUser, batchId: number, input: BatchPatchInput): Promise<unknown> {
    const batch = await queryOne<{ internship_id: number; seats_filled: number }>(
      `select internship_id, seats_filled from internship_batches where id = $1`,
      [batchId],
    );
    if (!batch) throw AppError.notFound('Batch');
    await assertCanManage(user, batch.internship_id);
    if (input.seatsTotal !== undefined && input.seatsTotal < batch.seats_filled) {
      throw AppError.conflict(`seatsTotal cannot go below seats already filled (${batch.seats_filled})`);
    }
    const sets: string[] = [];
    const params: unknown[] = [];
    const push = (col: string, v: unknown): void => {
      params.push(v);
      sets.push(`${col} = $${params.length}`);
    };
    if (input.name !== undefined) push('name', input.name);
    if (input.enrollmentDeadline !== undefined) push('enrollment_deadline', input.enrollmentDeadline);
    if (input.seatsTotal !== undefined) push('seats_total', input.seatsTotal);
    if (input.waitlistEnabled !== undefined) push('waitlist_enabled', input.waitlistEnabled);
    if (input.waitlistLimit !== undefined) push('waitlist_limit', input.waitlistLimit);
    if (input.status !== undefined) push('status', input.status);
    params.push(batchId);
    const row = await queryOne<Record<string, unknown>>(
      `update internship_batches set ${sets.join(', ')} where id = $${params.length} returning ${B_COLS}`,
      params,
    );
    return toDto(row as Record<string, unknown>);
  },

  async students(user: AuthUser, batchId: number): Promise<unknown[]> {
    const batch = await queryOne<{ internship_id: number }>(
      `select internship_id from internship_batches where id = $1`,
      [batchId],
    );
    if (!batch) throw AppError.notFound('Batch');
    await assertCanManage(user, batch.internship_id);
    return query(
      `select e.id as "enrollmentId", u.full_name as "studentName", e.status,
              e.progress_percent::float8 as "progressPercent", e.waitlist_position as "waitlistPosition",
              e.enrolled_at as "enrolledAt"
       from enrollments e join users u on u.id = e.user_id
       where e.batch_id = $1 and e.status <> 'dropped'
       order by e.enrolled_at`,
      [batchId],
    );
  },
};
