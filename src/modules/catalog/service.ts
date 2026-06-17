import { buildPagination } from '../../core/apiResponse';
import type { PaginationMeta } from '../../core/apiResponse';
import { AppError } from '../../core/appError';
import { env } from '../../config/env';
import { cacheGet, cacheSet } from '../../services/redis';
import type { CatalogRow } from './repository';
import { catalogRepository as repo } from './repository';
import type { CatalogListInput } from './schemas';

function money(n: string | number): number {
  return Math.round(Number(n) * 100) / 100;
}

function toSummary(r: CatalogRow): Record<string, unknown> {
  return {
    id: r.id,
    title: r.title,
    slug: r.slug,
    shortDescription: r.short_description,
    category: { name: r.category_name, slug: r.category_slug },
    pricingType: r.pricing_type,
    price: money(r.price),
    currency: r.currency,
    deliveryMode: r.delivery_mode,
    paceType: r.pace_type,
    level: r.level,
    durationWeeks: r.duration_weeks,
    languages: r.languages,
    thumbnailUrl: r.thumbnail_url,
    enrollmentCount: r.enrollment_count,
    instructorName: r.instructor_name,
    instructorProfileId: r.instructor_profile_id,
    publishedAt: r.published_at,
  };
}

export const catalogService = {
  async categories(): Promise<unknown[]> {
    const cached = await cacheGet('catalog:categories');
    if (cached) return JSON.parse(cached) as unknown[];
    const rows = await repo.activeCategories();
    const out = rows.map((c) => ({
      id: c.id,
      name: c.name,
      slug: c.slug,
      description: c.description,
      iconUrl: c.icon_url,
      displayOrder: c.display_order,
    }));
    await cacheSet('catalog:categories', JSON.stringify(out), 300); // 5 min
    return out;
  },

  async list(input: CatalogListInput): Promise<{ items: unknown[]; pagination: PaginationMeta }> {
    const rows = await repo.list(input);
    const total = rows[0]?.total_count ?? 0;
    return { items: rows.map(toSummary), pagination: buildPagination(input.page, input.limit, total) };
  },

  async detail(slug: string): Promise<Record<string, unknown>> {
    const cacheKey = `catalog:detail:${slug}`;
    const cached = await cacheGet(cacheKey);
    if (cached) return JSON.parse(cached) as Record<string, unknown>;
    const row = await repo.detailBySlug(slug);
    if (!row) throw AppError.notFound('Internship');
    const price = money(row.price as string);
    const gstRate = Number(row.gst_rate);
    const dto: Record<string, unknown> = {
      id: row.id,
      title: row.title,
      slug: row.slug,
      shortDescription: row.short_description,
      description: row.description,
      outcomes: row.outcomes,
      prerequisites: row.prerequisites,
      languages: row.languages,
      pricingType: row.pricing_type,
      price,
      currency: row.currency,
      gstRate,
      totalWithGst: row.pricing_type === 'paid' ? money(price * (1 + gstRate / 100)) : 0,
      deliveryMode: row.delivery_mode,
      paceType: row.pace_type,
      level: row.level,
      durationWeeks: row.duration_weeks,
      thumbnailUrl: row.thumbnail_url,
      certificateRules: row.certificate_rules,
      enrollmentCount: row.enrollment_count,
      // Ratings are a v1 non-goal (SRS §6); the key ships now so clients
      // don't need a contract change when reviews arrive.
      ratingSummary: null,
      faqs: row.faqs,
      category: row.category,
      instructor: row.instructor,
      curriculum: row.curriculum,
      upcomingBatches: row.upcoming_batches,
      batches: row.batches, // every selectable batch (for reliable label lookup)
      publishedAt: row.published_at,
    };
    await cacheSet(cacheKey, JSON.stringify(dto), 60); // 1 min — short, catalog tolerates slight staleness
    return dto;
  },

  async instructor(profileId: number): Promise<Record<string, unknown>> {
    const row = await repo.publicInstructor(profileId);
    if (!row) throw AppError.notFound('Instructor');
    return {
      id: row.id,
      name: row.name,
      avatarUrl: row.avatar_url,
      bio: row.bio,
      expertise: row.expertise,
      linkedinUrl: row.linkedin_url,
      websiteUrl: row.website_url,
      instructorType: row.instructor_type,
      internships: row.internships,
    };
  },
};

/** CDN cache windows (seconds) per catalog surface. */
export const CACHE_SECONDS = {
  categories: 3600,
  list: 60,
  detail: 300,
  instructor: 600,
} as const;

export function cacheHeader(seconds: number): string {
  // public → CDN may cache; SWR keeps p95 flat while revalidating.
  return env.NODE_ENV === 'production'
    ? `public, max-age=${seconds}, stale-while-revalidate=${seconds * 2}`
    : 'no-store';
}
