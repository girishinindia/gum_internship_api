import { env } from '../../config/env';
import { AppError } from '../../core/appError';
import { ErrorCodes } from '../../core/errorCodes';
import { query, queryOne, tx } from '../../db/pool';
import { razorpayService } from '../../services/razorpay';

interface BundleRow {
  id: number; slug: string; name: string; description: string | null;
  internship_ids: number[]; price: string; currency: string; is_active: boolean;
}

async function bundleBySlug(slug: string): Promise<BundleRow | null> {
  return queryOne<BundleRow>(`select * from bundles where slug = $1 and is_active = true`, [slug]);
}

async function enrollAll(userId: number, internshipIds: number[]): Promise<number[]> {
  return tx(async (client) => {
    const ids: number[] = [];
    for (const internshipId of internshipIds) {
      const r = await client.query<{ id: number }>(
        `insert into enrollments (user_id, internship_id, status, enrolled_at)
         values ($1, $2, 'active', now())
         on conflict do nothing returning id`,
        [userId, internshipId],
      );
      if (r.rows[0]) ids.push(r.rows[0].id);
    }
    return ids;
  });
}

export const bundlesService = {
  async create(input: { slug: string; name: string; description?: string; internshipIds: number[]; price: number }): Promise<Record<string, unknown>> {
    const r = await queryOne<{ id: number }>(
      `insert into bundles (slug, name, description, internship_ids, price)
       values ($1, $2, $3, $4::bigint[], $5) returning id`,
      [input.slug.toLowerCase(), input.name, input.description ?? null, input.internshipIds, input.price],
    );
    return { id: r?.id, slug: input.slug.toLowerCase() };
  },

  async list(): Promise<unknown[]> {
    return query(
      `select b.slug, b.name, b.description, b.price, b.currency,
              coalesce(json_agg(json_build_object('id', i.id, 'title', i.title, 'slug', i.slug)
                order by i.id) filter (where i.id is not null), '[]') as internships
       from bundles b
       left join internships i on i.id = any(b.internship_ids)
       where b.is_active = true
       group by b.id order by b.created_at desc`,
    );
  },

  async get(slug: string): Promise<Record<string, unknown>> {
    const b = await bundleBySlug(slug);
    if (!b) throw AppError.notFound('Bundle');
    const internships = await query(
      `select id, title, slug, pricing_type as "pricingType", price from internships where id = any($1::bigint[])`,
      [b.internship_ids],
    );
    return { slug: b.slug, name: b.name, description: b.description, price: Number(b.price), currency: b.currency, internships };
  },

  /**
   * Purchase a bundle. Free bundles enroll into all internships immediately;
   * paid bundles return a Razorpay order to be confirmed via /confirm.
   */
  async purchase(userId: number, slug: string): Promise<Record<string, unknown>> {
    const b = await bundleBySlug(slug);
    if (!b) throw AppError.notFound('Bundle');
    const price = Number(b.price);
    if (price <= 0) {
      const enrolled = await enrollAll(userId, b.internship_ids);
      return { status: 'enrolled', enrolledCount: enrolled.length, internshipIds: b.internship_ids };
    }
    const { razorpayOrderId } = await razorpayService.createOrder(Math.round(price * 100), `bundle_${b.slug}_${userId}`);
    return {
      status: 'pending_payment',
      bundleSlug: b.slug,
      payment: { razorpayOrderId, amount: price, currency: b.currency, keyId: env.RAZORPAY_KEY_ID },
    };
  },

  /** Confirm a paid bundle purchase (Checkout signature) → enroll into all. */
  async confirm(userId: number, slug: string, razorpayOrderId: string, paymentId: string, signature: string): Promise<Record<string, unknown>> {
    const b = await bundleBySlug(slug);
    if (!b) throw AppError.notFound('Bundle');
    if (!razorpayService.verifyCheckoutSignature(razorpayOrderId, paymentId, signature)) {
      throw new AppError(ErrorCodes.WEBHOOK_SIGNATURE_INVALID, 'Payment signature verification failed.');
    }
    const enrolled = await enrollAll(userId, b.internship_ids);
    return { status: 'enrolled', enrolledCount: enrolled.length, internshipIds: b.internship_ids };
  },
};
