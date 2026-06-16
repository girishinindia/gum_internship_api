import dayjs from 'dayjs';
import PDFDocument from 'pdfkit';
import { buildPagination } from '../../core/apiResponse';
import type { PaginationMeta } from '../../core/apiResponse';
import { AppError } from '../../core/appError';
import { query, queryOne, tx } from '../../db/pool';
import { storageService } from '../../services/storage';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

/**
 * Earnings & payouts (module 2.11).
 * MONEY NOTE: amounts live in Postgres numeric(10,2) rupees — never JS floats
 * end-to-end: pg returns numeric as STRING, every arithmetic step happens in
 * SQL (sum/round half-up to 2dp) or via round2 at boundaries; integers-in-
 * paise appear exactly once, at the Razorpay boundary. Settlement status maps
 * draft→initiated, approved→processing, paid→completed (0001 enum reused).
 */
const STATUS_MAP = { draft: 'initiated', approved: 'processing', paid: 'completed' } as const;
const STATUS_UNMAP: Record<string, string> = {
  initiated: 'draft', processing: 'approved', completed: 'paid', failed: 'failed',
};

async function profileIdFor(userId: number): Promise<number> {
  const p = await queryOne<{ id: number }>(`select id from instructor_profiles where user_id = $1`, [userId]);
  if (!p) throw AppError.forbidden('No instructor profile');
  return p.id;
}

/** pending earnings whose refund window elapsed are AVAILABLE (lazy maturity). */
const AVAILABLE = `(status = 'available' or (status = 'pending' and available_at <= now()))`;

export const earningsService = {
  async summary(userId: number): Promise<Record<string, unknown>> {
    const pid = await profileIdFor(userId);
    const row = await queryOne<Row>(
      `select
         coalesce(sum(amount) filter (where status = 'pending' and available_at > now()), 0) as pending,
         coalesce(sum(amount) filter (where ${AVAILABLE}), 0) as available,
         coalesce(sum(amount) filter (where status = 'settled'), 0) as settled,
         coalesce(sum(amount) filter (where status = 'reversed'), 0) as reversed,
         coalesce(sum(amount) filter (where status <> 'reversed'), 0) as lifetime
       from instructor_earnings where instructor_profile_id = $1`,
      [pid],
    );
    const monthly = await query<Row>(
      `select to_char(date_trunc('month', created_at), 'YYYY-MM') as month,
              round(sum(amount) filter (where status <> 'reversed'), 2) as earned,
              count(*)::int8 as entries
       from instructor_earnings where instructor_profile_id = $1
       group by 1 order by 1 desc limit 12`,
      [pid],
    );
    return {
      pending: Number(row?.pending ?? 0),
      available: Number(row?.available ?? 0),
      settled: Number(row?.settled ?? 0),
      reversed: Number(row?.reversed ?? 0),
      lifetime: Number(row?.lifetime ?? 0),
      monthly: monthly.map((m) => ({ month: m.month, earned: Number(m.earned ?? 0), entries: m.entries })),
    };
  },

  async ledger(userId: number, page: number, limit: number): Promise<{ items: unknown[]; pagination: PaginationMeta }> {
    const pid = await profileIdFor(userId);
    const rows = await query<Row>(
      `select e.id, e.gross_amount, e.revenue_share_percent, e.amount, e.status, e.available_at,
              e.reversal_reason, e.created_at, o.order_no, i.title as internship_title,
              s.settlement_no, count(*) over()::int8 as total_count
       from instructor_earnings e
       join orders o on o.id = e.order_id
       join internships i on i.id = e.internship_id
       left join payout_settlements s on s.id = e.settlement_id
       where e.instructor_profile_id = $1
       order by e.created_at desc limit ${limit} offset ${(page - 1) * limit}`,
      [pid],
    );
    return {
      items: rows.map((r) => ({
        id: r.id, orderNo: r.order_no, internshipTitle: r.internship_title,
        grossAmount: Number(r.gross_amount), sharePercent: Number(r.revenue_share_percent),
        amount: r.status === 'reversed' ? -Number(r.amount) : Number(r.amount), // clawback shows negative
        status: r.status, availableAt: r.available_at, reversalReason: r.reversal_reason,
        settlementNo: r.settlement_no, createdAt: r.created_at,
      })),
      pagination: buildPagination(page, limit, Number(rows[0]?.total_count ?? 0)),
    };
  },

  /** Admin: all settlements across instructors (status is the API-level value). */
  async adminSettlements(status: string | undefined, page: number, limit: number): Promise<{ items: unknown[]; pagination: PaginationMeta }> {
    const dbStatus = status
      ? status === 'failed' ? 'failed' : (STATUS_MAP as Record<string, string>)[status] ?? null
      : null;
    const rows = await query<Row>(
      `select s.*, u.full_name as instructor_name, count(*) over()::int8 as total_count
       from payout_settlements s
       join instructor_profiles ip on ip.id = s.instructor_profile_id
       join users u on u.id = ip.user_id
       where ($1::settlement_status is null or s.status = $1::settlement_status)
       order by s.created_at desc limit ${limit} offset ${(page - 1) * limit}`,
      [dbStatus],
    );
    return {
      items: rows.map((r) => this.dto(r)),
      pagination: buildPagination(page, limit, Number(rows[0]?.total_count ?? 0)),
    };
  },

  /** Admin: settle every available earning of an instructor in a period (status draft). */
  async createSettlement(
    actorId: number,
    input: { instructorProfileId: number; periodStart: string; periodEnd: string; tdsPercent: number; notes?: string },
  ): Promise<Record<string, unknown>> {
    return tx(async (client) => {
      const sumRow = await client.query<Row>(
        `select coalesce(round(sum(amount), 2), 0) as gross, count(*)::int8 as n
         from instructor_earnings
         where instructor_profile_id = $1 and ${AVAILABLE}
           and created_at >= $2 and created_at < ($3::date + 1)`,
        [input.instructorProfileId, input.periodStart, input.periodEnd],
      );
      const gross = Number(sumRow.rows[0]?.gross ?? 0);
      if (gross <= 0) throw AppError.conflict('No available earnings in this period');
      const tds = Math.round(gross * input.tdsPercent) / 100;
      const payable = Math.round((gross - tds) * 100) / 100;
      const s = await client.query<Row>(
        `insert into payout_settlements
           (instructor_profile_id, settlement_no, period_start, period_end, gross_amount,
            tds_amount, payable_amount, status, initiated_by, notes)
         values ($1, 'SET-' || extract(year from now())::int || '-' || lpad(nextval('seq_settlement_no')::text, 6, '0'),
                 $2, $3, $4, $5, $6, 'initiated', $7, $8)
         returning *`,
        [input.instructorProfileId, input.periodStart, input.periodEnd, gross, tds, payable, actorId, input.notes ?? null],
      );
      const settlement = s.rows[0] as Row;
      await client.query(
        `update instructor_earnings set status = 'settled', settlement_id = $1
         where instructor_profile_id = $2 and ${AVAILABLE}
           and created_at >= $3 and created_at < ($4::date + 1)`,
        [settlement.id, input.instructorProfileId, input.periodStart, input.periodEnd],
      );
      await client.query(
        `insert into audit_logs (actor_id, action, entity_type, entity_id, after_data)
         values ($1, 'settlement.create', 'payout_settlement', $2, $3)`,
        [actorId, settlement.id, JSON.stringify({ gross, tds, payable, entries: Number(sumRow.rows[0]?.n) })],
      );
      return this.dto(settlement);
    });
  },

  /** draft→approved→paid (paid requires UTR). */
  async updateSettlementStatus(
    actorId: number,
    settlementId: number,
    status: 'approved' | 'paid',
    utrNumber?: string,
  ): Promise<Record<string, unknown>> {
    const s = await queryOne<Row>(`select * from payout_settlements where id = $1`, [settlementId]);
    if (!s) throw AppError.notFound('Settlement');
    const current = STATUS_UNMAP[s.status as string];
    const validNext = (current === 'draft' && status === 'approved') || (current === 'approved' && status === 'paid');
    if (!validNext) throw AppError.conflict(`Cannot move ${current} → ${status}`);
    if (status === 'paid' && !utrNumber) throw AppError.validation('utrNumber is required to mark paid');
    const updated = await queryOne<Row>(
      `update payout_settlements set status = $2::settlement_status,
         utr_number = coalesce($3, utr_number),
         paid_at = case when $2 = 'completed' then now() else paid_at end
       where id = $1 returning *`,
      [settlementId, STATUS_MAP[status], utrNumber ?? null],
    );
    await query(
      `insert into audit_logs (actor_id, action, entity_type, entity_id, before_data, after_data)
       values ($1, 'settlement.' || $2, 'payout_settlement', $3, $4, $5)`,
      [actorId, status, settlementId, JSON.stringify({ status: current }), JSON.stringify({ status, utrNumber })],
    );
    return this.dto(updated as Row);
  },

  async listSettlements(userId: number | null, page: number, limit: number): Promise<{ items: unknown[]; pagination: PaginationMeta }> {
    const pid = userId === null ? null : await profileIdFor(userId);
    const rows = await query<Row>(
      `select s.*, u.full_name as instructor_name, count(*) over()::int8 as total_count
       from payout_settlements s
       join instructor_profiles ip on ip.id = s.instructor_profile_id
       join users u on u.id = ip.user_id
       where ($1::int8 is null or s.instructor_profile_id = $1)
       order by s.created_at desc limit ${limit} offset ${(page - 1) * limit}`,
      [pid],
    );
    return {
      items: rows.map((r) => this.dto(r)),
      pagination: buildPagination(page, limit, Number(rows[0]?.total_count ?? 0)),
    };
  },

  /** Instructor payout statement PDF (per settlement) → private zone signed URL. */
  async statement(userId: number, settlementId: number): Promise<Record<string, unknown>> {
    const pid = await profileIdFor(userId);
    const s = await queryOne<Row>(
      `select s.*, u.full_name from payout_settlements s
       join instructor_profiles ip on ip.id = s.instructor_profile_id
       join users u on u.id = ip.user_id
       where s.id = $1 and s.instructor_profile_id = $2`,
      [settlementId, pid],
    );
    if (!s) throw AppError.notFound('Settlement');
    const lines = await query<Row>(
      `select e.amount, e.gross_amount, e.revenue_share_percent, e.created_at, o.order_no, i.title
       from instructor_earnings e
       join orders o on o.id = e.order_id join internships i on i.id = e.internship_id
       where e.settlement_id = $1 order by e.created_at`,
      [settlementId],
    );

    const doc = new PDFDocument({ size: 'A4', margin: 56 });
    const chunks: Buffer[] = [];
    const done = new Promise<Buffer>((resolve) => {
      doc.on('data', (b: Buffer) => chunks.push(b));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
    });
    doc.rect(0, 0, doc.page.width, 8).fill('#1A73E8');
    doc.fillColor('#1A73E8').fontSize(18).font('Helvetica-Bold').text('GUM Internships — Payout Statement', 56, 40);
    doc.fillColor('#5F6368').fontSize(10).font('Helvetica');
    doc.text(`Settlement ${s.settlement_no} · ${s.full_name}`, 56, 70);
    doc.text(`Period ${dayjs(s.period_start).format('DD MMM YYYY')} – ${dayjs(s.period_end).format('DD MMM YYYY')} · Status ${STATUS_UNMAP[s.status as string]}${s.utr_number ? ` · UTR ${s.utr_number}` : ''}`, 56, 84);
    let y = 120;
    doc.fillColor('#202124').font('Helvetica-Bold').fontSize(9);
    doc.text('DATE', 56, y); doc.text('ORDER', 130, y); doc.text('PROGRAM', 220, y); doc.text('AMOUNT (₹)', 440, y, { width: 100, align: 'right' });
    y += 16;
    doc.font('Helvetica').fillColor('#5F6368');
    for (const l of lines) {
      doc.text(dayjs(l.created_at).format('DD/MM/YY'), 56, y);
      doc.text(String(l.order_no), 130, y);
      doc.text(String(l.title).slice(0, 38), 220, y, { width: 210 });
      doc.text(Number(l.amount).toFixed(2), 440, y, { width: 100, align: 'right' });
      y += 16;
      if (y > 740) { doc.addPage(); y = 56; }
    }
    y += 8;
    doc.fillColor('#202124').font('Helvetica-Bold');
    doc.text(`Gross ₹${Number(s.gross_amount).toFixed(2)}   TDS −₹${Number(s.tds_amount).toFixed(2)}   Payable ₹${Number(s.payable_amount).toFixed(2)}`, 56, y, { width: 484, align: 'right' });
    doc.end();
    const pdf = await done;
    const path = await storageService.upload('private', `settlements/${s.settlement_no}.pdf`, pdf, 'application/pdf');
    return { settlementNo: s.settlement_no, ...storageService.signedPrivateUrl(path) };
  },

  dto(r: Row): Record<string, unknown> {
    return {
      id: r.id, settlementNo: r.settlement_no, instructorName: r.instructor_name,
      periodStart: r.period_start, periodEnd: r.period_end,
      grossAmount: Number(r.gross_amount), tdsAmount: Number(r.tds_amount),
      payableAmount: Number(r.payable_amount),
      status: STATUS_UNMAP[r.status as string] ?? r.status,
      utrNumber: r.utr_number, paidAt: r.paid_at, createdAt: r.created_at,
    };
  },
};
