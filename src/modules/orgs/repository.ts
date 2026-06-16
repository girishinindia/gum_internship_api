import { query, queryOne, tx } from '../../db/pool';
import type { OrderAmounts } from '../payments/gst';

export interface OrgRow {
  id: number;
  owner_user_id: number;
  name: string;
  billing_state: string | null;
  seats_total: number;
}

export const orgsRepository = {
  async create(ownerUserId: number, input: Record<string, unknown>): Promise<Record<string, unknown>> {
    return tx(async (client) => {
      const o = await client.query<{ id: number }>(
        `insert into organizations (owner_user_id, name, gstin, billing_email, billing_state, about)
         values ($1, $2, $3, $4, $5, $6) returning id`,
        [ownerUserId, input.name, input.gstin ?? null, input.billingEmail ?? null, input.billingState ?? null, input.about ?? null],
      );
      const orgId = o.rows[0]?.id;
      // owner is also an admin member
      await client.query(
        `insert into org_members (org_id, user_id, role) values ($1, $2, 'admin') on conflict do nothing`,
        [orgId, ownerUserId],
      );
      return { id: orgId, name: input.name, seatsTotal: 0 };
    });
  },

  async byId(orgId: number): Promise<OrgRow | null> {
    return queryOne<OrgRow>(`select id, owner_user_id, name, billing_state, seats_total from organizations where id = $1`, [orgId]);
  },

  /** Org if the user owns it or is an admin member; else null. */
  async manageable(orgId: number, userId: number): Promise<OrgRow | null> {
    return queryOne<OrgRow>(
      `select o.id, o.owner_user_id, o.name, o.billing_state, o.seats_total
       from organizations o
       where o.id = $1 and (o.owner_user_id = $2 or exists (
         select 1 from org_members m where m.org_id = o.id and m.user_id = $2 and m.role = 'admin' and m.status = 'active'))`,
      [orgId, userId],
    );
  },

  async myOrgs(userId: number): Promise<unknown[]> {
    return query(
      `select o.id, o.name, o.seats_total as "seatsTotal",
              (select count(*) from org_seats s where s.org_id = o.id)::int8 as "seatsUsed",
              (select count(*) from org_members m where m.org_id = o.id and m.status = 'active')::int8 as "members"
       from organizations o
       where o.owner_user_id = $1 or exists (
         select 1 from org_members m where m.org_id = o.id and m.user_id = $1 and m.role = 'admin' and m.status = 'active')
       order by o.created_at desc`,
      [userId],
    );
  },

  async findUserByEmail(email: string): Promise<{ id: number } | null> {
    return queryOne<{ id: number }>(`select id from users where email = $1`, [email]);
  },

  async addMember(orgId: number, userId: number, role: string): Promise<void> {
    await query(
      `insert into org_members (org_id, user_id, role) values ($1, $2, $3)
       on conflict (org_id, user_id) do update set status = 'active', role = excluded.role`,
      [orgId, userId, role],
    );
  },

  async isMember(orgId: number, userId: number): Promise<boolean> {
    const r = await queryOne<{ ok: boolean }>(
      `select exists(select 1 from org_members where org_id = $1 and user_id = $2 and status = 'active') as ok`,
      [orgId, userId],
    );
    return r?.ok ?? false;
  },

  async seatsUsed(orgId: number): Promise<number> {
    const r = await queryOne<{ n: number }>(`select count(*)::int8 as n from org_seats where org_id = $1`, [orgId]);
    return Number(r?.n ?? 0);
  },

  async nextInvoiceSeq(): Promise<number> {
    const r = await queryOne<{ n: number }>(`select nextval('seq_invoice_no')::int8 as n`);
    return Number(r?.n ?? 0);
  },

  async recordSeatOrder(orgId: number, seats: number, unitPrice: number, a: OrderAmounts, invoiceNo: string, createdBy: number): Promise<Record<string, unknown>> {
    return tx(async (client) => {
      const r = await client.query<{ id: number }>(
        `insert into org_seat_orders (org_id, seats, unit_price, subtotal, taxable_amount, gst_rate, gst_amount, cgst_amount, sgst_amount, igst_amount, total_amount, invoice_no, created_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning id`,
        [orgId, seats, unitPrice, a.subtotal, a.taxableAmount, a.gstRate, a.gstAmount, a.cgstAmount, a.sgstAmount, a.igstAmount, a.totalAmount, invoiceNo, createdBy],
      );
      await client.query(`update organizations set seats_total = seats_total + $2 where id = $1`, [orgId, seats]);
      return { orderId: r.rows[0]?.id, invoiceNo, seats, totalAmount: a.totalAmount, gstAmount: a.gstAmount };
    });
  },

  /** Assign a seat: enroll the member in the internship + record seat use. */
  async assignSeat(orgId: number, memberUserId: number, internshipId: number, assignedBy: number): Promise<{ enrollmentId: number }> {
    return tx(async (client) => {
      // reuse existing enrollment if present, else create an active one
      const existing = await client.query<{ id: number }>(
        `select id from enrollments where user_id = $1 and internship_id = $2`, [memberUserId, internshipId],
      );
      let enrollmentId = existing.rows[0]?.id;
      if (!enrollmentId) {
        const e = await client.query<{ id: number }>(
          `insert into enrollments (user_id, internship_id, status, enrolled_at) values ($1, $2, 'active', now()) returning id`,
          [memberUserId, internshipId],
        );
        enrollmentId = e.rows[0]?.id;
      }
      await client.query(
        `insert into org_seats (org_id, member_user_id, internship_id, enrollment_id, assigned_by)
         values ($1, $2, $3, $4, $5)`,
        [orgId, memberUserId, internshipId, enrollmentId, assignedBy],
      );
      return { enrollmentId: enrollmentId as number };
    });
  },

  async memberHasSeat(orgId: number, memberUserId: number, internshipId: number): Promise<boolean> {
    const r = await queryOne<{ ok: boolean }>(
      `select exists(select 1 from org_seats where org_id = $1 and member_user_id = $2 and internship_id = $3) as ok`,
      [orgId, memberUserId, internshipId],
    );
    return r?.ok ?? false;
  },

  async teamDashboard(orgId: number): Promise<unknown[]> {
    return query(
      `select m.user_id as "userId", u.full_name as "name", u.email, m.role,
              coalesce(json_agg(json_build_object(
                'internshipId', s.internship_id, 'title', i.title,
                'progressPercent', e.progress_percent, 'status', e.status
              ) order by s.created_at) filter (where s.id is not null), '[]') as "assignments"
       from org_members m
       join users u on u.id = m.user_id
       left join org_seats s on s.org_id = m.org_id and s.member_user_id = m.user_id
       left join enrollments e on e.id = s.enrollment_id
       left join internships i on i.id = s.internship_id
       where m.org_id = $1 and m.status = 'active'
       group by m.user_id, u.full_name, u.email, m.role
       order by u.full_name`,
      [orgId],
    );
  },

  async seatOrders(orgId: number): Promise<unknown[]> {
    return query(
      `select id, seats, unit_price as "unitPrice", total_amount as "totalAmount",
              gst_amount as "gstAmount", invoice_no as "invoiceNo", created_at as "createdAt"
       from org_seat_orders where org_id = $1 order by created_at desc`,
      [orgId],
    );
  },

  // --- White-label branding ---
  getBranding(orgId: number): Promise<Record<string, unknown> | null> {
    return queryOne(
      `select id, name, brand_name as "brandName", logo_url as "logoUrl", primary_color as "primaryColor",
              support_email as "supportEmail", custom_domain as "customDomain"
       from organizations where id = $1`,
      [orgId],
    );
  },

  brandingByDomain(domain: string): Promise<Record<string, unknown> | null> {
    return queryOne(
      `select id, coalesce(brand_name, name) as "brandName", logo_url as "logoUrl",
              primary_color as "primaryColor", support_email as "supportEmail", custom_domain as "customDomain"
       from organizations where lower(custom_domain) = lower($1)`,
      [domain],
    );
  },

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async updateBranding(orgId: number, input: Record<string, any>): Promise<Record<string, unknown> | null> {
    const map: Record<string, string> = {
      brandName: 'brand_name', logoUrl: 'logo_url', primaryColor: 'primary_color',
      supportEmail: 'support_email', customDomain: 'custom_domain',
    };
    const sets: string[] = [];
    const params: unknown[] = [];
    for (const [k, col] of Object.entries(map)) {
      if (input[k] !== undefined) { params.push(input[k] === '' ? null : input[k]); sets.push(`${col} = $${params.length}`); }
    }
    if (sets.length === 0) return this.getBranding(orgId);
    params.push(orgId);
    await query(`update organizations set ${sets.join(', ')}, updated_at = now() where id = $${params.length}`, params);
    return this.getBranding(orgId);
  },
};
