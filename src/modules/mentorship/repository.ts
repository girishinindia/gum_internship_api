import { query, queryOne, tx } from '../../db/pool';

export interface SlotRow {
  id: number;
  mentor_user_id: number;
  starts_at: Date;
  duration_minutes: number;
  price: string;
  currency: string;
  topic: string | null;
  status: string;
}

export const mentorshipRepository = {
  async createSlot(mentorUserId: number, input: { startsAt: string; durationMinutes: number; price: number; topic?: string }): Promise<Record<string, unknown>> {
    const r = await queryOne<Record<string, unknown>>(
      `insert into mentor_availability (mentor_user_id, starts_at, duration_minutes, price, topic)
       values ($1, $2, $3, $4, $5)
       returning id, starts_at as "startsAt", duration_minutes as "durationMinutes", price, topic, status`,
      [mentorUserId, input.startsAt, input.durationMinutes, input.price, input.topic ?? null],
    );
    return r ?? {};
  },

  async mySlots(mentorUserId: number): Promise<unknown[]> {
    return query(
      `select s.id, s.starts_at as "startsAt", s.duration_minutes as "durationMinutes",
              s.price, s.topic, s.status,
              b.id as "bookingId", b.student_user_id as "studentUserId", su.full_name as "studentName"
       from mentor_availability s
       left join mentor_bookings b on b.slot_id = s.id and b.status in ('confirmed','completed')
       left join users su on su.id = b.student_user_id
       where s.mentor_user_id = $1
       order by s.starts_at desc`,
      [mentorUserId],
    );
  },

  /** Open future slots, optionally for one mentor. */
  async openSlots(mentorUserId: number | null): Promise<unknown[]> {
    return query(
      `select s.id, s.mentor_user_id as "mentorUserId", u.full_name as "mentorName",
              ip.expertise, s.starts_at as "startsAt", s.duration_minutes as "durationMinutes",
              s.price, s.currency, s.topic
       from mentor_availability s
       join users u on u.id = s.mentor_user_id
       left join instructor_profiles ip on ip.user_id = s.mentor_user_id
       where s.status = 'open' and s.starts_at > now()
         and ($1::bigint is null or s.mentor_user_id = $1)
       order by s.starts_at asc`,
      [mentorUserId],
    );
  },

  async slotById(slotId: number): Promise<SlotRow | null> {
    return queryOne<SlotRow>(`select * from mentor_availability where id = $1`, [slotId]);
  },

  async cancelSlot(mentorUserId: number, slotId: number): Promise<boolean> {
    const r = await queryOne<{ id: number }>(
      `update mentor_availability set status = 'cancelled'
       where id = $1 and mentor_user_id = $2 and status = 'open' returning id`,
      [slotId, mentorUserId],
    );
    return r !== null;
  },

  /**
   * Atomically claim an open slot and create a booking. Returns the new booking
   * row, or null if the slot was already taken (race-safe via the UPDATE guard).
   */
  async claimSlotAndBook(
    slotId: number,
    studentUserId: number,
    mentorUserId: number,
    price: number,
    currency: string,
    status: 'pending_payment' | 'confirmed',
    note: string | null,
  ): Promise<{ id: number } | null> {
    return tx(async (client) => {
      const upd = await client.query(`update mentor_availability set status = 'booked' where id = $1 and status = 'open'`, [slotId]);
      if (upd.rowCount === 0) return null;
      const res = await client.query<{ id: number }>(
        `insert into mentor_bookings (slot_id, student_user_id, mentor_user_id, status, price, currency, student_note)
         values ($1, $2, $3, $4, $5, $6, $7) returning id`,
        [slotId, studentUserId, mentorUserId, status, price, currency, note],
      );
      return res.rows[0] ?? null;
    });
  },

  async bookingById(bookingId: number): Promise<Record<string, unknown> | null> {
    return queryOne(`select * from mentor_bookings where id = $1`, [bookingId]);
  },

  async setBookingOrder(bookingId: number, razorpayOrderId: string): Promise<void> {
    await query(`update mentor_bookings set razorpay_order_id = $2 where id = $1`, [bookingId, razorpayOrderId]);
  },

  async confirmBooking(bookingId: number, paymentId: string | null, meeting: { provider: string; meetingId: string; joinUrl: string; passcode: string | null }): Promise<void> {
    await query(
      `update mentor_bookings set status = 'confirmed', razorpay_payment_id = coalesce($2, razorpay_payment_id),
         provider = $3, meeting_id = $4, join_url = $5, passcode = $6
       where id = $1`,
      [bookingId, paymentId, meeting.provider, meeting.meetingId, meeting.joinUrl, meeting.passcode],
    );
  },

  async releaseSlotForBooking(bookingId: number): Promise<void> {
    await tx(async (client) => {
      const b = await client.query<{ slot_id: number }>(`update mentor_bookings set status = 'cancelled' where id = $1 returning slot_id`, [bookingId]);
      const slotId = b.rows[0]?.slot_id;
      if (slotId) await client.query(`update mentor_availability set status = 'open' where id = $1 and status = 'booked'`, [slotId]);
    });
  },

  async myBookings(studentUserId: number): Promise<unknown[]> {
    return query(
      `select b.id, b.status, b.price, b.currency, b.join_url as "joinUrl", b.created_at as "createdAt",
              s.starts_at as "startsAt", s.duration_minutes as "durationMinutes", s.topic,
              mu.full_name as "mentorName"
       from mentor_bookings b
       join mentor_availability s on s.id = b.slot_id
       join users mu on mu.id = b.mentor_user_id
       where b.student_user_id = $1
       order by s.starts_at desc`,
      [studentUserId],
    );
  },
};
