import type { PoolClient } from 'pg';
import { query, queryOne } from '../../db/pool';

export interface EnrollmentRow {
  id: number;
  user_id: number;
  internship_id: number;
  batch_id: number | null;
  order_id: number | null;
  status: 'pending_payment' | 'waitlisted' | 'active' | 'completed' | 'dropped' | 'suspended';
  progress_percent: string;
  waitlist_position: number | null;
  offer_letter_no: string | null;
  offer_letter_url: string | null;
  enrolled_at: Date;
}

export interface InternshipLite {
  id: number;
  title: string;
  slug: string;
  pricing_type: 'free' | 'paid' | 'stipend';
  price: string;
  gst_rate: string;
  status: string;
  pace_type: 'batch' | 'self_paced';
  duration_weeks: number | null;
  provider_type: 'system' | 'external';
  instructor_profile_id: number;
  instructor_name: string;
  revenue_share_percent: string;
}

export interface BatchLite {
  id: number;
  internship_id: number;
  name: string;
  start_date: string;
  end_date: string;
  enrollment_deadline: Date | null;
  seats_total: number;
  seats_filled: number;
  waitlist_enabled: boolean;
  waitlist_limit: number | null;
  status: string;
}

const E_COLS = `id, user_id, internship_id, batch_id, order_id, status, progress_percent,
  waitlist_position, offer_letter_no, offer_letter_url, enrolled_at`;

export const enrollmentsRepository = {
  internshipLite(id: number): Promise<InternshipLite | null> {
    return queryOne<InternshipLite>(
      `select i.id, i.title, i.slug, i.pricing_type, i.price, i.gst_rate, i.status,
              i.pace_type, i.duration_weeks, i.provider_type, i.instructor_profile_id,
              u.full_name as instructor_name, ip.revenue_share_percent
       from internships i
       join instructor_profiles ip on ip.id = i.instructor_profile_id
       join users u on u.id = ip.user_id
       where i.id = $1`,
      [id],
    );
  },

  /** Lock the batch row inside a transaction before seat math. */
  async batchForUpdate(client: PoolClient, batchId: number): Promise<BatchLite | null> {
    const res = await client.query<BatchLite>(
      `select id, internship_id, name, start_date::text, end_date::text, enrollment_deadline,
              seats_total, seats_filled, waitlist_enabled, waitlist_limit, status
       from internship_batches where id = $1 for update`,
      [batchId],
    );
    return res.rows[0] ?? null;
  },

  findLiveEnrollment(userId: number, internshipId: number): Promise<EnrollmentRow | null> {
    return queryOne<EnrollmentRow>(
      `select ${E_COLS} from enrollments
       where user_id = $1 and internship_id = $2 and status <> 'dropped'`,
      [userId, internshipId],
    );
  },

  findById(id: number): Promise<EnrollmentRow | null> {
    return queryOne<EnrollmentRow>(`select ${E_COLS} from enrollments where id = $1`, [id]);
  },

  findByOrderId(orderId: number): Promise<EnrollmentRow | null> {
    return queryOne<EnrollmentRow>(`select ${E_COLS} from enrollments where order_id = $1`, [orderId]);
  },

  async insert(
    client: PoolClient,
    input: {
      userId: number;
      internshipId: number;
      batchId: number | null;
      orderId: number | null;
      status: EnrollmentRow['status'];
      waitlistPosition: number | null;
    },
  ): Promise<EnrollmentRow> {
    const res = await client.query<EnrollmentRow>(
      `insert into enrollments (user_id, internship_id, batch_id, order_id, status, waitlist_position)
       values ($1, $2, $3, $4, $5, $6) returning ${E_COLS}`,
      [input.userId, input.internshipId, input.batchId, input.orderId, input.status, input.waitlistPosition],
    );
    const row = res.rows[0];
    if (!row) throw new Error('enrollment insert returned no row');
    return row;
  },

  async bumpSeats(client: PoolClient, batchId: number, delta: 1 | -1): Promise<void> {
    await client.query(
      `update internship_batches set seats_filled = seats_filled + $2 where id = $1`,
      [batchId, delta],
    );
  },

  async bumpEnrollmentCount(client: PoolClient, internshipId: number, delta: 1 | -1): Promise<void> {
    await client.query(
      `update internships set enrollment_count = greatest(enrollment_count + $2, 0) where id = $1`,
      [internshipId, delta],
    );
  },

  async setStatus(
    client: PoolClient,
    enrollmentId: number,
    status: EnrollmentRow['status'],
    extra?: { batchId?: number | null; clearWaitlist?: boolean },
  ): Promise<void> {
    await client.query(
      `update enrollments set
         status = $2::enrollment_status,
         batch_id = coalesce($3, batch_id),
         waitlist_position = case when $4 then null else waitlist_position end,
         dropped_at = case when $2::enrollment_status = 'dropped' then now() else dropped_at end
       where id = $1`,
      [enrollmentId, status, extra?.batchId ?? null, extra?.clearWaitlist ?? false],
    );
  },

  async nextWaitlistPosition(client: PoolClient, batchId: number): Promise<number> {
    const res = await client.query<{ next: number }>(
      `select coalesce(max(waitlist_position), 0)::int8 + 1 as next
       from enrollments where batch_id = $1 and status = 'waitlisted'`,
      [batchId],
    );
    return Number(res.rows[0]?.next ?? 1);
  },

  async firstWaitlisted(client: PoolClient, batchId: number): Promise<EnrollmentRow | null> {
    const res = await client.query<EnrollmentRow>(
      `select ${E_COLS} from enrollments
       where batch_id = $1 and status = 'waitlisted'
       order by waitlist_position asc limit 1 for update`,
      [batchId],
    );
    return res.rows[0] ?? null;
  },

  myList(
    userId: number,
    status: EnrollmentRow['status'] | undefined,
    limit: number,
    offset: number,
  ): Promise<(EnrollmentRow & { title: string; slug: string; thumbnail_url: string | null; batch_name: string | null; start_date: string | null; end_date: string | null; total_count: number })[]> {
    return query(
      `select e.id, e.user_id, e.internship_id, e.batch_id, e.order_id, e.status,
              e.progress_percent, e.waitlist_position, e.offer_letter_no, e.offer_letter_url,
              e.enrolled_at,
              i.title, i.slug, i.thumbnail_url,
              b.name as batch_name, b.start_date::text, b.end_date::text,
              count(*) over()::int8 as total_count
       from enrollments e
       join internships i on i.id = e.internship_id
       left join internship_batches b on b.id = e.batch_id
       where e.user_id = $1 and ($2::enrollment_status is null or e.status = $2)
       order by e.enrolled_at desc
       limit ${limit} offset ${offset}`,
      [userId, status ?? null],
    );
  },

  setOfferLetter(enrollmentId: number, no: string, url: string): Promise<unknown> {
    return query(
      `update enrollments set offer_letter_no = $2, offer_letter_url = $3 where id = $1`,
      [enrollmentId, no, url],
    );
  },

  async nextOfferLetterNo(): Promise<string> {
    const row = await queryOne<{ n: number }>(`select nextval('seq_offer_letter_no')::int8 as n`);
    return `OL-${new Date().getFullYear()}-${String(row?.n ?? 0).padStart(6, '0')}`;
  },

  audit(input: {
    actorId: number;
    action: string;
    entityType: string;
    entityId: number;
    before: unknown;
    after: unknown;
  }): Promise<unknown> {
    return query(
      `insert into audit_logs (actor_id, action, entity_type, entity_id, before_data, after_data)
       values ($1, $2, $3, $4, $5, $6)`,
      [
        input.actorId,
        input.action,
        input.entityType,
        input.entityId,
        JSON.stringify(input.before),
        JSON.stringify(input.after),
      ],
    );
  },
};
