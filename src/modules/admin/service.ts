import type { Response } from 'express';
import { AppError } from '../../core/appError';
import { query, queryOne } from '../../db/pool';
import { notificationsService } from '../notifications/service';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

/** Admin module (2.12): moderation, ops, stats, CSV streams, CMS, tickets, audit. */

export async function audit(input: {
  actorId: number; action: string; entityType: string; entityId: number | null;
  before?: unknown; after?: unknown; ip?: string | null;
}): Promise<void> {
  await query(
    `insert into audit_logs (actor_id, action, entity_type, entity_id, before_data, after_data, ip_address)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [input.actorId, input.action, input.entityType, input.entityId,
     input.before === undefined ? null : JSON.stringify(input.before),
     input.after === undefined ? null : JSON.stringify(input.after),
     input.ip ?? null],
  );
}

export const adminService = {
  /** Instructor KYC decision: approve grants instructor role + share %. */
  async kycDecision(actorId: number, profileId: number, decision: 'approved' | 'rejected', reason?: string, revenueSharePercent?: number): Promise<Row> {
    const p = await queryOne<Row>(`select * from instructor_profiles where id = $1`, [profileId]);
    if (!p) throw AppError.notFound('Instructor profile');
    if (p.kyc_status !== 'submitted') throw AppError.conflict(`Application is ${p.kyc_status}, not submitted`);
    if (decision === 'rejected' && !reason) throw AppError.validation('reason required when rejecting');

    if (decision === 'approved') {
      await query(
        `update instructor_profiles set kyc_status = 'approved', approved_by = $2, approved_at = now(),
           agreement_status = 'sent', revenue_share_percent = coalesce($3, revenue_share_percent),
           rejection_reason = null
         where id = $1`,
        [profileId, actorId, revenueSharePercent ?? null],
      );
      await query(
        `insert into user_roles (user_id, role_id, granted_by)
         select $1, id, $2 from roles where name = 'instructor'
         on conflict (user_id, role_id) do nothing`,
        [p.user_id, actorId],
      );
    } else {
      await query(
        `update instructor_profiles set kyc_status = 'rejected', rejection_reason = $2 where id = $1`,
        [profileId, reason],
      );
    }
    await audit({ actorId, action: `kyc.${decision}`, entityType: 'instructor_profile', entityId: profileId,
      before: { kycStatus: 'submitted' }, after: { kycStatus: decision, reason, revenueSharePercent } });
    return { profileId, decision };
  },

  /** Internship moderation queue + decision (pending_review → published|rejected). */
  async internshipDecision(actorId: number, internshipId: number, decision: 'published' | 'rejected', reason?: string): Promise<Row> {
    const i = await queryOne<Row>(`select id, status, title from internships where id = $1`, [internshipId]);
    if (!i) throw AppError.notFound('Internship');
    if (i.status !== 'pending_review') throw AppError.conflict(`Internship is ${i.status}, not pending_review`);
    if (decision === 'rejected' && !reason) throw AppError.validation('reason required when rejecting');
    await query(
      `update internships set status = $2::internship_status,
         rejection_reason = $3,
         published_at = case when $2 = 'published' then now() else published_at end
       where id = $1`,
      [internshipId, decision, decision === 'rejected' ? reason : null],
    );
    await audit({ actorId, action: `internship.${decision === 'published' ? 'approve' : 'reject'}`,
      entityType: 'internship', entityId: internshipId, before: { status: 'pending_review' }, after: { status: decision, reason } });
    return { internshipId, decision };
  },

  async setUserStatus(actorId: number, userId: number, status: 'active' | 'suspended', reason?: string): Promise<void> {
    const u = await queryOne<Row>(`select id, status from users where id = $1`, [userId]);
    if (!u) throw AppError.notFound('User');
    await query(`update users set status = $2::user_status where id = $1`, [userId, status]);
    if (status === 'suspended') {
      await query(`update user_sessions set revoked_at = now() where user_id = $1 and revoked_at is null`, [userId]);
    }
    await audit({ actorId, action: `user.${status === 'suspended' ? 'suspend' : 'restore'}`,
      entityType: 'user', entityId: userId, before: { status: u.status }, after: { status, reason } });
  },

  async setRole(actorId: number, userId: number, role: string, grant: boolean): Promise<void> {
    if (grant) {
      await query(
        `insert into user_roles (user_id, role_id, granted_by)
         select $1, id, $2 from roles where name = $3::role_name
         on conflict (user_id, role_id) do nothing`,
        [userId, actorId, role],
      );
    } else {
      await query(
        `delete from user_roles where user_id = $1 and role_id = (select id from roles where name = $2::role_name)`,
        [userId, role],
      );
    }
    await audit({ actorId, action: grant ? 'role.grant' : 'role.revoke', entityType: 'user', entityId: userId, after: { role } });
  },

  /** Manual enrollment (support ops): free-style activate into a batch. */
  async manualEnroll(actorId: number, userId: number, internshipId: number, batchId: number | null): Promise<Row> {
    const { enrollmentsService } = await import('../enrollments/service');
    const internship = await queryOne<Row>(`select pricing_type from internships where id = $1`, [internshipId]);
    if (!internship) throw AppError.notFound('Internship');
    const dto = await enrollmentsService.enrollFree(userId, { internshipId, batchId: batchId ?? undefined } as never).catch(async (err) => {
      if (err instanceof AppError && err.message.includes('paid')) {
        // Paid internship comp: force-activate without an order (recorded in audit).
        const e = await queryOne<Row>(
          `insert into enrollments (user_id, internship_id, batch_id, status) values ($1, $2, $3, 'active') returning id, status`,
          [userId, internshipId, batchId],
        );
        return { id: e?.id, status: e?.status, comped: true };
      }
      throw err;
    });
    await audit({ actorId, action: 'enrollment.manual', entityType: 'enrollment', entityId: Number((dto as Row).id), after: { userId, internshipId, batchId } });
    return dto as Row;
  },

  /**
   * R1-S5: issue a scholarship — a single-student coupon (kind='scholarship',
   * assigned_user_id) on the existing coupon engine. Generates a unique code,
   * notifies the student by email, and writes an audit row.
   */
  async issueScholarship(
    actorId: number,
    input: {
      userId: number;
      discountType: 'percent' | 'flat';
      discountValue: number;
      internshipId?: number | null;
      maxDiscountAmount?: number | null;
      validUntil?: string | null;
      eligibilityNote?: string | null;
    },
  ): Promise<Row> {
    const student = await queryOne<{ id: number; email: string | null; full_name: string }>(
      `select id, email, full_name from users where id = $1`,
      [input.userId],
    );
    if (!student) throw AppError.notFound('User');
    if (input.internshipId) {
      const i = await queryOne<Row>(`select id from internships where id = $1`, [input.internshipId]);
      if (!i) throw AppError.notFound('Internship');
    }
    if (input.discountType === 'percent' && input.discountValue > 100) {
      throw AppError.validation('Percent discount cannot exceed 100');
    }

    // Unique, human-readable scholarship code: SCH-<userId>-<rand>
    const code = `SCH-${input.userId}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
    const coupon = await queryOne<Row>(
      `insert into coupons
         (code, description, discount_type, discount_value, max_discount_amount,
          internship_id, valid_until, per_user_limit, max_redemptions,
          is_active, created_by, kind, assigned_user_id, eligibility_note)
       values ($1, $2, $3::discount_type, $4, $5, $6, $7, 1, 1, true, $8,
               'scholarship', $9, $10)
       returning id, code, discount_type, discount_value, max_discount_amount,
                 internship_id, valid_until, kind, assigned_user_id, eligibility_note`,
      [
        code,
        `Scholarship for ${student.full_name}`,
        input.discountType,
        input.discountValue,
        input.maxDiscountAmount ?? null,
        input.internshipId ?? null,
        input.validUntil ?? null,
        actorId,
        input.userId,
        input.eligibilityNote ?? null,
      ],
    );

    await audit({
      actorId, action: 'scholarship.issue', entityType: 'coupon',
      entityId: Number(coupon?.id), after: { userId: input.userId, code },
    });

    if (student.email) {
      const offer =
        input.discountType === 'percent'
          ? `${input.discountValue}% off`
          : `₹${input.discountValue} off`;
      const { notifyService } = await import('../../services/notify');
      await notifyService.sendEmail(
        student.email, student.full_name,
        'You have been awarded a GI Internship scholarship 🎓',
        `<p>Hi ${student.full_name},</p>
         <p>You have been awarded a scholarship: <strong>${offer}</strong>.</p>
         <p>Apply this code at checkout: <strong style="font-size:18px">${code}</strong></p>
         ${input.eligibilityNote ? `<p>${input.eligibilityNote}</p>` : ''}
         <p>This code is reserved for your account and can be used once.</p>`,
      ).catch(() => undefined);
    }

    return coupon as Row;
  },

  async dashboard(): Promise<Row> {
    const row = await queryOne<Row>(
      `select
        (select count(*) from users where created_at > now() - interval '1 day')::int8 as signups_today,
        (select count(*) from users where created_at > now() - interval '7 days')::int8 as signups_7d,
        (select count(*) from users where created_at > now() - interval '30 days')::int8 as signups_30d,
        (select count(*) from enrollments where enrolled_at > now() - interval '1 day')::int8 as enrollments_today,
        (select count(*) from enrollments where enrolled_at > now() - interval '7 days')::int8 as enrollments_7d,
        (select count(*) from enrollments where enrolled_at > now() - interval '30 days')::int8 as enrollments_30d,
        (select coalesce(sum(total_amount), 0) from orders where status = 'paid' and created_at > now() - interval '1 day') as revenue_today,
        (select coalesce(sum(total_amount), 0) from orders where status = 'paid' and created_at > now() - interval '7 days') as revenue_7d,
        (select coalesce(sum(total_amount), 0) from orders where status = 'paid' and created_at > now() - interval '30 days') as revenue_30d,
        (select round(100.0 * count(*) filter (where status = 'completed') / nullif(count(*), 0), 2)
           from enrollments where status in ('active', 'completed')) as completion_rate,
        (select count(*) from submissions where status = 'submitted')::int8 as pending_reviews,
        (select count(*) from instructor_profiles where kyc_status = 'submitted')::int8 as pending_kyc,
        (select count(*) from internships where status = 'pending_review')::int8 as pending_moderation,
        (select count(*) from refunds where status = 'requested')::int8 as pending_refunds,
        (select count(*) from support_tickets where status in ('open', 'in_progress'))::int8 as open_tickets`,
    );
    const r = row as Row;
    return {
      signups: { today: r.signups_today, last7d: r.signups_7d, last30d: r.signups_30d },
      enrollments: { today: r.enrollments_today, last7d: r.enrollments_7d, last30d: r.enrollments_30d },
      revenue: { today: Number(r.revenue_today), last7d: Number(r.revenue_7d), last30d: Number(r.revenue_30d) },
      completionRatePercent: r.completion_rate === null ? null : Number(r.completion_rate),
      pending: { reviews: r.pending_reviews, kyc: r.pending_kyc, moderation: r.pending_moderation, refunds: r.pending_refunds, tickets: r.open_tickets },
    };
  },

  /** CSV export, STREAMED in keyset-paginated chunks (never buffers the table). */
  async streamCsv(res: Response, entity: 'users' | 'orders' | 'enrollments'): Promise<void> {
    const specs: Record<string, { header: string; sql: string; row: (r: Row) => string }> = {
      users: {
        header: 'id,full_name,email,phone,status,track,created_at',
        sql: `select id, full_name, email, phone, status, track, created_at from users where id > $1 order by id limit 500`,
        row: (r) => [r.id, csv(r.full_name), csv(r.email), csv(r.phone), r.status, r.track ?? '', iso(r.created_at)].join(','),
      },
      orders: {
        header: 'id,order_no,user_id,internship_id,status,subtotal,discount,taxable,gst,total,invoice_no,created_at',
        sql: `select id, order_no, user_id, internship_id, status, subtotal, discount_amount, taxable_amount, gst_amount, total_amount, invoice_no, created_at from orders where id > $1 order by id limit 500`,
        row: (r) => [r.id, r.order_no, r.user_id, r.internship_id, r.status, r.subtotal, r.discount_amount, r.taxable_amount, r.gst_amount, r.total_amount, r.invoice_no ?? '', iso(r.created_at)].join(','),
      },
      enrollments: {
        header: 'id,user_id,internship_id,batch_id,status,progress_percent,project_score,enrolled_at',
        sql: `select id, user_id, internship_id, batch_id, status, progress_percent, project_score, enrolled_at from enrollments where id > $1 order by id limit 500`,
        row: (r) => [r.id, r.user_id, r.internship_id, r.batch_id ?? '', r.status, r.progress_percent, r.project_score ?? '', iso(r.enrolled_at)].join(','),
      },
    };
    const spec = specs[entity];
    if (!spec) throw AppError.validation('entity must be users|orders|enrollments');
    res.setHeader('content-type', 'text/csv; charset=utf-8');
    res.setHeader('content-disposition', `attachment; filename="${entity}-${Date.now()}.csv"`);
    res.write(spec.header + '\n');
    let cursor = 0;
    for (;;) {
      const rows = await query<Row>(spec.sql, [cursor]);
      if (rows.length === 0) break;
      res.write(rows.map(spec.row).join('\n') + '\n');
      cursor = Number(rows[rows.length - 1]?.id);
      if (rows.length < 500) break;
    }
    res.end();
  },

  // ---- CMS ------------------------------------------------------------
  /** Product analytics: funnel + daily trends (live from source tables) + tracked events. */
  async analytics(days: number): Promise<Row> {
    const since = `now() - interval '${Math.trunc(days)} days'`; // days is a validated int
    const funnel = await queryOne<Row>(
      `select
         (select count(*) from users where created_at >= ${since} and status <> 'deleted')::int as signups,
         (select count(*) from enrollments where enrolled_at >= ${since})::int as enrollments,
         (select count(*) from orders where status='paid' and created_at >= ${since})::int as paid_orders,
         (select coalesce(sum(total_amount),0) from orders where status='paid' and created_at >= ${since})::float8 as revenue,
         (select count(*) from certificates where issued_at >= ${since})::int as certificates`,
    );
    const signupSeries = await query<Row>(
      `select date_trunc('day', created_at)::date as day, count(*)::int as n
       from users where created_at >= ${since} group by 1 order by 1`,
    );
    const enrollSeries = await query<Row>(
      `select date_trunc('day', enrolled_at)::date as day, count(*)::int as n
       from enrollments where enrolled_at >= ${since} group by 1 order by 1`,
    );
    const events = await query<Row>(
      `select name, count(*)::int as n from analytics_events where created_at >= ${since} group by name order by n desc`,
    );
    return {
      days,
      funnel: {
        signups: Number(funnel?.signups ?? 0),
        enrollments: Number(funnel?.enrollments ?? 0),
        paidOrders: Number(funnel?.paid_orders ?? 0),
        revenue: Number(funnel?.revenue ?? 0),
        certificates: Number(funnel?.certificates ?? 0),
      },
      signupSeries: signupSeries.map((r) => ({ day: r.day, count: r.n })),
      enrollSeries: enrollSeries.map((r) => ({ day: r.day, count: r.n })),
      events: events.map((r) => ({ name: r.name, count: r.n })),
    };
  },

  // --- Coupons ---
  async listCoupons(status: string | undefined): Promise<Row[]> {
    const rows = await query<Row>(
      `select c.id, c.code, c.description, c.discount_type as "discountType", c.discount_value::float8 as "discountValue",
              c.max_discount_amount::float8 as "maxDiscountAmount", c.internship_id as "internshipId", i.title as "internshipTitle",
              c.valid_from as "validFrom", c.valid_until as "validUntil", c.max_redemptions as "maxRedemptions",
              c.redemption_count as "redemptionCount", c.per_user_limit as "perUserLimit", c.min_order_amount::float8 as "minOrderAmount",
              c.is_active as "isActive",
              case
                when not c.is_active then 'inactive'
                when c.valid_until is not null and c.valid_until < now() then 'expired'
                when c.max_redemptions is not null and c.redemption_count >= c.max_redemptions then 'used_up'
                when c.valid_from is not null and c.valid_from > now() then 'scheduled'
                else 'active'
              end as status
       from coupons c left join internships i on i.id = c.internship_id
       order by c.created_at desc`,
    );
    return status && status !== 'all' ? rows.filter((r) => r.status === status) : rows;
  },

  async createCoupon(actorId: number, input: Row): Promise<Row> {
    const row = await queryOne<Row>(
      `insert into coupons (code, description, discount_type, discount_value, max_discount_amount, internship_id,
          valid_from, valid_until, max_redemptions, per_user_limit, min_order_amount, is_active, created_by)
       values (upper($1), $2, $3::discount_type, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       returning id, code`,
      [input.code, input.description ?? null, input.discountType, input.discountValue, input.maxDiscountAmount ?? null,
       input.internshipId ?? null, input.validFrom ?? null, input.validUntil ?? null, input.maxRedemptions ?? null,
       input.perUserLimit ?? 1, input.minOrderAmount ?? 0, input.isActive ?? true, actorId],
    );
    await audit({ actorId, action: 'coupon.create', entityType: 'coupon', entityId: Number(row?.id), after: { code: input.code } });
    return row as Row;
  },

  async updateCoupon(actorId: number, id: number, input: Row): Promise<Row> {
    const sets: string[] = [];
    const params: unknown[] = [];
    const push = (col: string, v: unknown): void => { params.push(v); sets.push(`${col} = $${params.length}`); };
    if (input.description !== undefined) push('description', input.description);
    if (input.validUntil !== undefined) push('valid_until', input.validUntil);
    if (input.maxRedemptions !== undefined) push('max_redemptions', input.maxRedemptions);
    if (input.minOrderAmount !== undefined) push('min_order_amount', input.minOrderAmount);
    if (input.isActive !== undefined) push('is_active', input.isActive);
    if (sets.length === 0) throw AppError.validation('Provide at least one field');
    params.push(id);
    await query(`update coupons set ${sets.join(', ')}, updated_at = now() where id = $${params.length}`, params);
    await audit({ actorId, action: 'coupon.update', entityType: 'coupon', entityId: id, after: input });
    return { id, ...input } as Row;
  },

  async cmsBanners(): Promise<Row[]> {
    return query<Row>(
      `select id, title, image_url as "imageUrl", link_url as "linkUrl", placement,
              display_order as "displayOrder", starts_at as "startsAt", ends_at as "endsAt", is_active as "isActive"
       from cms_banners order by placement, display_order, id`,
    );
  },

  async cmsPages(): Promise<Row[]> {
    return query<Row>(
      `select id, slug, title, content_md as "contentMd", meta_title as "metaTitle",
              meta_description as "metaDescription", is_published as "isPublished",
              published_at as "publishedAt", updated_at as "updatedAt"
       from cms_pages order by slug`,
    );
  },

  async upsertBanner(actorId: number, id: number | null, input: Row): Promise<Row> {
    const row = id
      ? await queryOne<Row>(
          `update cms_banners set title=$2, image_url=$3, link_url=$4, placement=$5::banner_placement,
             display_order=$6, starts_at=$7, ends_at=$8, is_active=$9 where id=$1 returning *`,
          [id, input.title, input.imageUrl, input.linkUrl ?? null, input.placement, input.displayOrder ?? 0,
           input.startsAt ?? null, input.endsAt ?? null, input.isActive ?? true],
        )
      : await queryOne<Row>(
          `insert into cms_banners (title, image_url, link_url, placement, display_order, starts_at, ends_at, is_active, created_by)
           values ($1, $2, $3, $4::banner_placement, $5, $6, $7, $8, $9) returning *`,
          [input.title, input.imageUrl, input.linkUrl ?? null, input.placement, input.displayOrder ?? 0,
           input.startsAt ?? null, input.endsAt ?? null, input.isActive ?? true, actorId],
        );
    await audit({ actorId, action: id ? 'cms.banner.update' : 'cms.banner.create', entityType: 'cms_banner', entityId: Number(row?.id), after: input });
    return row as Row;
  },

  async upsertPage(actorId: number, id: number | null, input: Row): Promise<Row> {
    const row = id
      ? await queryOne<Row>(
          `update cms_pages set title=$2, content_md=$3, meta_title=$4, meta_description=$5,
             is_published=$6, published_at=coalesce(published_at, case when $6 then now() end), updated_by=$7
           where id=$1 returning id, slug, title, is_published`,
          [id, input.title, input.contentMd, input.metaTitle ?? null, input.metaDescription ?? null, input.isPublished ?? false, actorId],
        )
      : await queryOne<Row>(
          `insert into cms_pages (slug, title, content_md, meta_title, meta_description, is_published, published_at, updated_by)
           values ($1, $2, $3, $4, $5, $6, case when $6 then now() end, $7) returning id, slug, title, is_published`,
          [input.slug, input.title, input.contentMd, input.metaTitle ?? null, input.metaDescription ?? null, input.isPublished ?? false, actorId],
        );
    await audit({ actorId, action: id ? 'cms.page.update' : 'cms.page.create', entityType: 'cms_page', entityId: Number(row?.id), after: { slug: row?.slug } });
    const p = row as Row;
    return { id: p.id, slug: p.slug, title: p.title, isPublished: p.is_published };
  },

  // ---- Tickets ----------------------------------------------------------
  async createTicket(userId: number, input: Row): Promise<Row> {
    const row = await queryOne<Row>(
      `insert into support_tickets (ticket_no, user_id, internship_id, category, subject, description, attachments)
       values ('TKT-' || extract(year from now())::int || '-' || lpad(nextval('seq_ticket_no')::text, 6, '0'),
               $1, $2, $3::ticket_category, $4, $5, $6)
       returning id, ticket_no, category, subject, status, priority, created_at`,
      [userId, input.internshipId ?? null, input.category, input.subject, input.description, JSON.stringify(input.attachments ?? [])],
    );
    const t = row as Row;
    return { id: t.id, ticketNo: t.ticket_no, category: t.category, subject: t.subject, status: t.status, priority: t.priority, createdAt: t.created_at };
  },

  async myTickets(userId: number): Promise<Row[]> {
    return query<Row>(
      `select id, ticket_no, category, subject, status, priority, created_at from support_tickets
       where user_id = $1 order by created_at desc limit 100`,
      [userId],
    );
  },

  async ticketThread(userId: number | null, ticketId: number): Promise<Row> {
    const t = await queryOne<Row>(`select * from support_tickets where id = $1`, [ticketId]);
    if (!t || (userId !== null && t.user_id !== userId)) throw AppError.notFound('Ticket');
    const replies = await query<Row>(
      `select r.id, r.body, r.created_at, u.full_name as author
       from ticket_replies r join users u on u.id = r.author_id
       where r.ticket_id = $1 order by r.created_at`,
      [ticketId],
    );
    return {
      id: t.id, ticketNo: t.ticket_no, category: t.category, subject: t.subject,
      description: t.description, status: t.status, priority: t.priority,
      resolutionNote: t.resolution_note, createdAt: t.created_at,
      replies: replies.map((r) => ({ id: r.id, author: r.author, body: r.body, createdAt: r.created_at })),
    };
  },

  async replyTicket(authorId: number, ticketId: number, body: string, isStaff: boolean): Promise<void> {
    const t = await queryOne<Row>(`select id, user_id, status from support_tickets where id = $1`, [ticketId]);
    if (!t) throw AppError.notFound('Ticket');
    if (!isStaff && t.user_id !== authorId) throw AppError.forbidden('Not your ticket');
    await query(`insert into ticket_replies (ticket_id, author_id, body) values ($1, $2, $3)`, [ticketId, authorId, body]);
    if (isStaff && t.status === 'open') {
      await query(`update support_tickets set status = 'in_progress' where id = $1`, [ticketId]);
    }
  },

  async updateTicket(actorId: number, ticketId: number, input: Row): Promise<void> {
    const t = await queryOne<Row>(`select * from support_tickets where id = $1`, [ticketId]);
    if (!t) throw AppError.notFound('Ticket');
    await query(
      `update support_tickets set
         status = coalesce($2::ticket_status, status),
         priority = coalesce($3::ticket_priority, priority),
         assigned_to = coalesce($4, assigned_to),
         resolution_note = coalesce($5, resolution_note),
         resolved_at = case when $2 = 'resolved' then now() else resolved_at end
       where id = $1`,
      [ticketId, input.status ?? null, input.priority ?? null, input.assignedTo ?? null, input.resolutionNote ?? null],
    );
    await audit({ actorId, action: 'ticket.update', entityType: 'support_ticket', entityId: ticketId, before: { status: t.status }, after: input });
    if (input.status && input.status !== t.status) {
      await notificationsService.send({
        userId: t.user_id, event: 'ticket.updated',
        payload: { ticketNo: t.ticket_no, status: input.status, note: input.resolutionNote ?? '' },
      });
    }
  },

  async adminTickets(status: string | undefined, page: number, limit: number): Promise<{ items: Row[]; total: number }> {
    const rows = await query<Row>(
      `select t.id, t.ticket_no, t.category, t.subject, t.status, t.priority, t.created_at,
              u.full_name as requester, a.full_name as assignee, count(*) over()::int8 as total_count
       from support_tickets t
       join users u on u.id = t.user_id
       left join users a on a.id = t.assigned_to
       where ($1::ticket_status is null or t.status = $1)
       order by t.created_at limit ${limit} offset ${(page - 1) * limit}`,
      [status ?? null],
    );
    return { items: rows, total: Number(rows[0]?.total_count ?? 0) };
  },

  async auditLogs(filters: Row, page: number, limit: number): Promise<{ items: Row[]; total: number }> {
    const params: unknown[] = [];
    const where: string[] = ['true'];
    const add = (sql: string, v: unknown): void => { params.push(v); where.push(sql.replace('$N', `$${params.length}`)); };
    if (filters.actorId) add('actor_id = $N', filters.actorId);
    if (filters.action) add('action ilike $N', `%${filters.action}%`);
    if (filters.entityType) add('entity_type = $N', filters.entityType);
    const rows = await query<Row>(
      `select a.*, u.full_name as actor_name, count(*) over()::int8 as total_count
       from audit_logs a left join users u on u.id = a.actor_id
       where ${where.join(' and ')}
       order by a.created_at desc limit ${limit} offset ${(page - 1) * limit}`,
      params,
    );
    return { items: rows, total: Number(rows[0]?.total_count ?? 0) };
  },
};

function csv(v: unknown): string {
  if (v === null || v === undefined) return '';
  let s = String(v);
  // SEC-07: neutralize spreadsheet formula injection (=, +, -, @ prefixes).
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}
function iso(v: unknown): string {
  return v instanceof Date ? v.toISOString() : String(v ?? '');
}
