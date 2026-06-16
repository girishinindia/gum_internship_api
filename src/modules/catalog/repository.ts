import { query, queryOne } from '../../db/pool';
import type { CatalogListInput } from './schemas';

/**
 * MAIN CATALOG QUERY — index usage (0002 + 0006):
 * 1. Equality filters land on idx_internships_catalog (category_id,
 *    pricing_type, delivery_mode, published_at desc) WHERE status='published'
 *    — the partial predicate matches our constant filter, newest sort reads
 *    the index order with no sort node.
 * 2. sort=popular flips to idx_internships_popular (enrollment_count desc,
 *    published_at desc, same partial); language uses GIN idx_internships_languages
 *    (languages array containment), q uses GIN trigram idx_internships_title_trgm.
 * 3. count(*) over() window avoids a second round-trip for pagination totals;
 *    price sorts are in-memory top-N over the already-filtered set (small by then).
 */

export interface CatalogRow {
  id: number;
  title: string;
  slug: string;
  short_description: string | null;
  pricing_type: 'free' | 'paid' | 'stipend';
  price: string;
  currency: string;
  delivery_mode: string;
  pace_type: string;
  level: string | null;
  duration_weeks: number | null;
  languages: string[];
  thumbnail_url: string | null;
  enrollment_count: number;
  published_at: Date | null;
  category_name: string;
  category_slug: string;
  instructor_name: string;
  instructor_profile_id: number;
  total_count: number;
}

const SORTS: Record<CatalogListInput['sort'], string> = {
  newest: 'i.published_at desc nulls last',
  popular: 'i.enrollment_count desc, i.published_at desc nulls last',
  price_asc: 'i.price asc, i.published_at desc nulls last',
  price_desc: 'i.price desc, i.published_at desc nulls last',
};

export const catalogRepository = {
  async list(input: CatalogListInput): Promise<CatalogRow[]> {
    const where: string[] = [`i.status = 'published'`];
    const params: unknown[] = [];
    const add = (sql: string, v: unknown): void => {
      params.push(v);
      where.push(sql.replaceAll('$N', `$${params.length}`));
    };

    if (input.category) add(`c.slug = $N`, input.category);
    if (input.pricingType) add(`i.pricing_type = $N`, input.pricingType);
    if (input.deliveryMode) add(`i.delivery_mode = $N`, input.deliveryMode);
    if (input.level) add(`i.level = $N`, input.level);
    if (input.durationWeeks) add(`i.duration_weeks <= $N`, input.durationWeeks);
    if (input.language) add(`i.languages @> array[$N]::text[]`, input.language.toLowerCase());

    // Full-text search (Postgres FTS): weighted tsvector + relevance ranking.
    // websearch_to_tsquery safely parses user input (quotes, OR, -exclude).
    let rankExpr = '';
    if (input.q) {
      params.push(input.q);
      const p = params.length;
      where.push(`i.search_tsv @@ websearch_to_tsquery('english', $${p})`);
      rankExpr = `ts_rank(i.search_tsv, websearch_to_tsquery('english', $${p})) desc, `;
    }

    const offset = (input.page - 1) * input.limit;
    return query<CatalogRow>(
      `select i.id, i.title, i.slug, i.short_description, i.pricing_type, i.price,
              i.currency, i.delivery_mode, i.pace_type, i.level, i.duration_weeks,
              i.languages, i.thumbnail_url, i.enrollment_count, i.published_at,
              c.name as category_name, c.slug as category_slug,
              u.full_name as instructor_name, ip.id as instructor_profile_id,
              count(*) over()::int8 as total_count
       from internships i
       join categories c on c.id = i.category_id
       join instructor_profiles ip on ip.id = i.instructor_profile_id
       join users u on u.id = ip.user_id
       where ${where.join(' and ')}
       order by ${rankExpr}${SORTS[input.sort]}
       limit ${input.limit} offset ${offset}`,
      params,
    );
  },

  activeCategories(): Promise<
    { id: number; name: string; slug: string; description: string | null; icon_url: string | null; display_order: number }[]
  > {
    return query(
      `select id, name, slug, description, icon_url, display_order
       from categories where is_active order by display_order, name`,
    );
  },

  detailBySlug(slug: string): Promise<Record<string, unknown> | null> {
    // Single round-trip: curriculum outline (NO bunny ids / video URLs),
    // upcoming batches with seats left, instructor public profile, faqs.
    return queryOne(
      `select i.id, i.title, i.slug, i.short_description, i.description, i.outcomes,
              i.prerequisites, i.languages, i.pricing_type, i.price, i.currency,
              i.gst_rate, i.delivery_mode, i.pace_type, i.level, i.duration_weeks,
              i.thumbnail_url, i.faqs, i.enrollment_count, i.certificate_rules,
              i.published_at,
              jsonb_build_object('name', c.name, 'slug', c.slug) as category,
              jsonb_build_object(
                'id', ip.id, 'name', u.full_name, 'bio', ip.bio,
                'expertise', ip.expertise, 'avatarUrl', u.avatar_url
              ) as instructor,
              coalesce((
                select jsonb_agg(jsonb_build_object(
                  'id', s.id, 'title', s.title,
                  'lessons', (
                    select coalesce(jsonb_agg(jsonb_build_object(
                      'id', l.id, 'title', l.title, 'type', l.type,
                      'durationMinutes', l.duration_minutes, 'isPreview', l.is_preview
                    ) order by l.display_order), '[]'::jsonb)
                    from lessons l where l.section_id = s.id
                  )
                ) order by s.display_order)
                from curriculum_sections s where s.internship_id = i.id
              ), '[]'::jsonb) as curriculum,
              coalesce((
                select jsonb_agg(jsonb_build_object(
                  'id', b.id, 'name', b.name, 'startDate', b.start_date,
                  'endDate', b.end_date, 'enrollmentDeadline', b.enrollment_deadline,
                  'seatsTotal', b.seats_total, 'seatsLeft', b.seats_total - b.seats_filled,
                  'waitlistEnabled', b.waitlist_enabled, 'status', b.status
                ) order by b.start_date)
                from internship_batches b
                where b.internship_id = i.id and b.status in ('scheduled', 'enrolling')
              ), '[]'::jsonb) as upcoming_batches
       from internships i
       join categories c on c.id = i.category_id
       join instructor_profiles ip on ip.id = i.instructor_profile_id
       join users u on u.id = ip.user_id
       where i.slug = $1 and i.status = 'published'`,
      [slug],
    );
  },

  publicInstructor(profileId: number): Promise<Record<string, unknown> | null> {
    return queryOne(
      `select ip.id, u.full_name as name, u.avatar_url, ip.bio, ip.expertise,
              ip.linkedin_url, ip.website_url, ip.instructor_type,
              coalesce((
                select jsonb_agg(jsonb_build_object(
                  'title', x.title, 'slug', x.slug, 'pricingType', x.pricing_type,
                  'price', x.price, 'deliveryMode', x.delivery_mode,
                  'thumbnailUrl', x.thumbnail_url, 'enrollmentCount', x.enrollment_count
                ) order by x.published_at desc)
                from internships x
                where x.instructor_profile_id = ip.id and x.status = 'published'
              ), '[]'::jsonb) as internships
       from instructor_profiles ip
       join users u on u.id = ip.user_id
       where ip.id = $1 and ip.kyc_status = 'approved'`,
      [profileId],
    );
  },
};
