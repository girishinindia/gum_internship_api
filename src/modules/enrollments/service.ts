import dayjs from 'dayjs';
import { buildPagination } from '../../core/apiResponse';
import type { PaginationMeta } from '../../core/apiResponse';
import { AppError } from '../../core/appError';
import { ErrorCodes } from '../../core/errorCodes';
import { logger } from '../../core/logger';
import { env } from '../../config/env';
import { query, queryOne, tx } from '../../db/pool';
import { jobQueue } from '../../services/jobQueue';
import { isDurable, publishJob, registerJob } from '../../services/durableQueue';
import { notifyService } from '../../services/notify';
import { generateOfferLetterPdf } from '../../services/pdf';
import { quizGate } from '../../services/quizGate';
import { storageService } from '../../services/storage';
import { authRepository } from '../auth/repository';
import type { BatchLite, EnrollmentRow, InternshipLite } from './repository';
import { enrollmentsRepository as repo } from './repository';
import type { EnrollInput, MyEnrollmentsInput, TransferInput } from './schemas';

function assertBatchJoinable(batch: BatchLite, internship: InternshipLite): void {
  if (batch.internship_id !== internship.id) {
    throw AppError.validation('Batch does not belong to this internship');
  }
  if (!['scheduled', 'enrolling'].includes(batch.status)) {
    throw new AppError(ErrorCodes.ENROLLMENT_CLOSED, 'This batch is not accepting enrollments');
  }
  if (batch.enrollment_deadline && new Date(batch.enrollment_deadline).getTime() < Date.now()) {
    throw new AppError(ErrorCodes.ENROLLMENT_CLOSED, 'Enrollment deadline has passed');
  }
}

function toDto(e: EnrollmentRow): Record<string, unknown> {
  return {
    id: e.id,
    internshipId: e.internship_id,
    batchId: e.batch_id,
    orderId: e.order_id,
    status: e.status,
    progressPercent: Number(e.progress_percent),
    waitlistPosition: e.waitlist_position,
    offerLetterNo: e.offer_letter_no,
    offerLetterUrl: e.offer_letter_url,
    enrolledAt: e.enrolled_at,
  };
}

export const enrollmentsService = {
  /** FREE internships only — paid go through POST /orders (module 2.5). */
  async enrollFree(userId: number, input: EnrollInput): Promise<Record<string, unknown>> {
    const internship = await repo.internshipLite(input.internshipId);
    if (!internship || internship.status !== 'published') throw AppError.notFound('Internship');
    if (internship.pricing_type === 'paid') {
      throw AppError.validation('This internship is paid — create an order instead');
    }
    if (await repo.findLiveEnrollment(userId, input.internshipId)) {
      throw AppError.conflict('You are already enrolled', ErrorCodes.ALREADY_ENROLLED);
    }
    if (internship.pace_type === 'batch' && !input.batchId) {
      throw AppError.validation('batchId is required for cohort internships');
    }

    const gate = await quizGate.checkEnrollmentEligibility(userId, input.internshipId);
    if (gate.required && !gate.eligible) {
      throw new AppError(ErrorCodes.NOT_ELIGIBLE, gate.reason ?? 'Eligibility quiz not passed');
    }

    const enrollment = await tx(async (client) => {
      let batchId: number | null = null;
      if (input.batchId) {
        const batch = await repo.batchForUpdate(client, input.batchId);
        if (!batch) throw AppError.notFound('Batch');
        assertBatchJoinable(batch, internship);
        batchId = batch.id;

        if (batch.seats_filled >= batch.seats_total) {
          if (!batch.waitlist_enabled) {
            throw new AppError(ErrorCodes.BATCH_FULL, 'Batch is full');
          }
          const position = await repo.nextWaitlistPosition(client, batch.id);
          if (batch.waitlist_limit && position > batch.waitlist_limit) {
            throw new AppError(ErrorCodes.BATCH_FULL, 'Batch and waitlist are both full');
          }
          return repo.insert(client, {
            userId,
            internshipId: internship.id,
            batchId,
            orderId: null,
            status: 'waitlisted',
            waitlistPosition: position,
          });
        }
        await repo.bumpSeats(client, batch.id, 1);
      }
      await repo.bumpEnrollmentCount(client, internship.id, 1);
      return repo.insert(client, {
        userId,
        internshipId: internship.id,
        batchId,
        orderId: null,
        status: 'active',
        waitlistPosition: null,
      });
    });

    if (enrollment.status === 'active') {
      this.queueOfferLetter(enrollment.id);
    }
    return toDto(enrollment);
  },

  /**
   * INTERFACE FOR PAYMENTS (module 2.5), designed here per prompt 2.4:
   * 1) reservePendingEnrollment — called inside order creation; validates seat
   *    availability but does NOT consume a seat (seat is taken on capture).
   * 2) activateEnrollmentByOrder — called by the webhook on payment.captured;
   *    IDEMPOTENT (already-active → no-op) because webhooks redeliver.
   */
  async reservePendingEnrollment(
    userId: number,
    internshipId: number,
    batchId: number | null,
    orderId: number,
  ): Promise<EnrollmentRow> {
    const internship = await repo.internshipLite(internshipId);
    if (!internship || internship.status !== 'published') throw AppError.notFound('Internship');
    const existing = await repo.findLiveEnrollment(userId, internshipId);
    if (existing) {
      if (existing.status === 'pending_payment') return existing; // retry same order flow
      throw AppError.conflict('You are already enrolled', ErrorCodes.ALREADY_ENROLLED);
    }
    return tx(async (client) => {
      if (batchId) {
        const batch = await repo.batchForUpdate(client, batchId);
        if (!batch) throw AppError.notFound('Batch');
        assertBatchJoinable(batch, internship);
        if (batch.seats_filled >= batch.seats_total) {
          throw new AppError(ErrorCodes.BATCH_FULL, 'Batch is full');
        }
      }
      return repo.insert(client, {
        userId,
        internshipId,
        batchId,
        orderId,
        status: 'pending_payment',
        waitlistPosition: null,
      });
    });
  },

  async activateEnrollmentByOrder(orderId: number): Promise<EnrollmentRow | null> {
    const enrollment = await repo.findByOrderId(orderId);
    if (!enrollment) return null;
    if (enrollment.status === 'active') return enrollment; // idempotent re-delivery

    await tx(async (client) => {
      if (enrollment.batch_id) {
        const batch = await repo.batchForUpdate(client, enrollment.batch_id);
        if (batch && batch.seats_filled < batch.seats_total) {
          await repo.bumpSeats(client, batch.id, 1);
        }
        // Seat hold expired & batch filled meanwhile: still activate (we took
        // the money) — support resolves oversubscription via batch transfer.
      }
      await repo.bumpEnrollmentCount(client, enrollment.internship_id, 1);
      await repo.setStatus(client, enrollment.id, 'active', { clearWaitlist: true });
    });
    this.queueOfferLetter(enrollment.id);
    return repo.findById(enrollment.id);
  },

  async suspendEnrollmentByOrder(orderId: number): Promise<void> {
    const enrollment = await repo.findByOrderId(orderId);
    if (!enrollment || enrollment.status !== 'active') return;
    await tx(async (client) => {
      if (enrollment.batch_id) await repo.bumpSeats(client, enrollment.batch_id, -1);
      await repo.bumpEnrollmentCount(client, enrollment.internship_id, -1);
      await repo.setStatus(client, enrollment.id, 'suspended');
    });
  },

  async myEnrollments(
    userId: number,
    input: MyEnrollmentsInput,
  ): Promise<{ items: unknown[]; pagination: PaginationMeta }> {
    const rows = await repo.myList(userId, input.status, input.limit, (input.page - 1) * input.limit);
    const total = rows[0]?.total_count ?? 0;
    return {
      items: rows.map((r) => ({
        ...toDto(r),
        internship: { title: r.title, slug: r.slug, thumbnailUrl: r.thumbnail_url },
        batch: r.batch_id ? { name: r.batch_name, startDate: r.start_date, endDate: r.end_date } : null,
      })),
      pagination: buildPagination(input.page, input.limit, total),
    };
  },

  async drop(userId: number, enrollmentId: number): Promise<void> {
    const enrollment = await repo.findById(enrollmentId);
    if (!enrollment || enrollment.user_id !== userId) throw AppError.notFound('Enrollment');
    if (!['active', 'waitlisted', 'pending_payment'].includes(enrollment.status)) {
      throw AppError.conflict('This enrollment cannot be dropped');
    }
    const wasActive = enrollment.status === 'active';

    await tx(async (client) => {
      await repo.setStatus(client, enrollment.id, 'dropped', { clearWaitlist: true });
      if (wasActive) {
        await repo.bumpEnrollmentCount(client, enrollment.internship_id, -1);
        if (enrollment.batch_id) {
          await repo.bumpSeats(client, enrollment.batch_id, -1);
          // Promote the first waitlisted learner. Free internships activate
          // instantly; paid promotion (payment invite + hold) is a P2 flow.
          const internship = await repo.internshipLite(enrollment.internship_id);
          const next = await repo.firstWaitlisted(client, enrollment.batch_id);
          if (next && internship?.pricing_type === 'free') {
            await repo.bumpSeats(client, enrollment.batch_id, 1);
            await repo.bumpEnrollmentCount(client, enrollment.internship_id, 1);
            await repo.setStatus(client, next.id, 'active', { clearWaitlist: true });
            this.queueOfferLetter(next.id);
          }
        }
      }
    });
  },

  /** Admin/support: move an enrollment between batches of the SAME internship. */
  async transfer(actorId: number, enrollmentId: number, input: TransferInput): Promise<unknown> {
    const enrollment = await repo.findById(enrollmentId);
    if (!enrollment) throw AppError.notFound('Enrollment');
    if (enrollment.batch_id === input.toBatchId) {
      throw AppError.validation('Enrollment is already in this batch');
    }

    const updated = await tx(async (client) => {
      const target = await repo.batchForUpdate(client, input.toBatchId);
      if (!target) throw AppError.notFound('Target batch');
      if (target.internship_id !== enrollment.internship_id) {
        throw AppError.validation('Target batch belongs to a different internship');
      }
      if (target.seats_filled >= target.seats_total) {
        throw new AppError(ErrorCodes.BATCH_FULL, 'Target batch is full');
      }
      if (enrollment.status === 'active') {
        if (enrollment.batch_id) await repo.bumpSeats(client, enrollment.batch_id, -1);
        await repo.bumpSeats(client, target.id, 1);
      }
      await repo.setStatus(client, enrollment.id, enrollment.status, { batchId: target.id });
      return target;
    });

    await repo.audit({
      actorId,
      action: 'enrollment.transfer',
      entityType: 'enrollment',
      entityId: enrollment.id,
      before: { batchId: enrollment.batch_id },
      after: { batchId: updated.id, reason: input.reason },
    });
    return repo.findById(enrollmentId).then((e) => (e ? toDto(e) : null));
  },

  /**
   * Classroom view (W1): the curriculum with per-lesson completion + lock state
   * for one of the caller's enrollments. Lock follows SEQUENTIAL_UNLOCK — a
   * lesson is locked if an earlier mandatory lesson isn't completed (previews
   * are never locked).
   */
  async classroom(userId: number, enrollmentId: number): Promise<Record<string, unknown>> {
    const e = await queryOne<{ id: number; user_id: number; internship_id: number; status: string; progress_percent: string; title: string; slug: string; languages: string[] }>(
      `select e.id, e.user_id, e.internship_id, e.status, e.progress_percent, i.title, i.slug, i.languages
       from enrollments e join internships i on i.id = e.internship_id where e.id = $1`,
      [enrollmentId],
    );
    if (!e || e.user_id !== userId) throw AppError.notFound('Enrollment');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = await query<any>(
      `select l.id, l.section_id, cs.title as section_title, cs.display_order as sec_order,
              l.title, l.type, l.duration_minutes, l.is_preview, l.is_mandatory, l.display_order,
              l.document_url, l.bunny_video_id, l.quiz_id,
              (lp.status = 'completed') as completed
       from lessons l
       join curriculum_sections cs on cs.id = l.section_id
       left join lesson_progress lp on lp.lesson_id = l.id and lp.enrollment_id = $1
       where cs.internship_id = $2
       order by cs.display_order, l.display_order`,
      [enrollmentId, e.internship_id],
    );

    const sequential = env.SEQUENTIAL_UNLOCK;
    let priorMandatoryIncomplete = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sections = new Map<number, { title: string; lessons: any[] }>();
    for (const r of rows) {
      const locked = sequential && !r.is_preview && priorMandatoryIncomplete;
      if (!sections.has(r.section_id)) sections.set(r.section_id, { title: r.section_title, lessons: [] });
      sections.get(r.section_id)!.lessons.push({
        id: r.id, title: r.title, type: r.type, durationMinutes: r.duration_minutes,
        isPreview: r.is_preview, isMandatory: r.is_mandatory, hasVideo: r.bunny_video_id !== null,
        documentUrl: r.document_url, quizId: r.quiz_id, completed: r.completed === true, locked,
      });
      if (r.is_mandatory && r.completed !== true) priorMandatoryIncomplete = true;
    }

    return {
      enrollmentId: e.id,
      internshipId: e.internship_id,
      internshipTitle: e.title,
      internshipSlug: e.slug,
      languages: e.languages ?? [],
      status: e.status,
      progressPercent: Number(e.progress_percent),
      sections: [...sections.values()],
    };
  },

  /** Upcoming live sessions across the caller's active enrollments (W1). */
  async myLiveSessions(userId: number): Promise<unknown[]> {
    return query(
      `select ls.id as "liveSessionId", ls.title, ls.provider, ls.scheduled_start as "scheduledStart",
              ls.scheduled_end as "scheduledEnd", ls.status, e.id as "enrollmentId",
              i.title as "internshipTitle"
       from live_sessions ls
       join enrollments e on e.internship_id = ls.internship_id and e.user_id = $1 and e.status = 'active'
       join internships i on i.id = ls.internship_id
       where ls.scheduled_start > now() - interval '1 hour' and ls.status in ('scheduled','live')
       order by ls.scheduled_start asc`,
      [userId],
    );
  },

  /** Admin ops: browse enrolments across users/internships. */
  async adminList(
    filters: { internshipId?: number; userId?: number; status?: string; q?: string },
    page: number,
    limit: number,
  ): Promise<{ items: unknown[]; pagination: PaginationMeta }> {
    const rows = await repo.adminList(filters, limit, (page - 1) * limit);
    const total = Number(rows[0]?.total_count ?? 0);
    return {
      items: rows.map((r) => ({
        id: r.id, status: r.status, progressPercent: Number(r.progress_percent),
        enrolledAt: r.enrolled_at, userId: r.user_id, userName: r.user_name, userEmail: r.user_email,
        internshipId: r.internship_id, internshipTitle: r.internship_title,
        batchId: r.batch_id, batchName: r.batch_name,
      })),
      pagination: buildPagination(page, limit, total),
    };
  },

  /** Lightweight enrolment check for the public detail-page CTA. */
  async myEnrollmentForInternship(
    userId: number,
    internshipId: number,
  ): Promise<{ enrollmentId: number; status: string } | null> {
    const e = await repo.findLiveEnrollment(userId, internshipId);
    return e ? { enrollmentId: e.id, status: e.status } : null;
  },

  /** Queue the offer-letter pipeline. Durable (Postgres) when JOB_QUEUE_DRIVER=pg,
   *  otherwise the original in-process queue. Same idempotent work either way. */
  queueOfferLetter(enrollmentId: number): void {
    if (isDurable()) {
      void publishJob('offer-letter', { enrollmentId }).catch((err) =>
        logger.error({ err, enrollmentId }, 'failed to enqueue offer-letter job'));
      return;
    }
    jobQueue.enqueue(`offer-letter:${enrollmentId}`, () => runOfferLetter(enrollmentId));
  },
};

/** The offer-letter work itself — shared by the in-process and durable queues.
 *  Idempotent: returns early if the enrolment isn't active or already has one. */
export async function runOfferLetter(enrollmentId: number): Promise<void> {
  const enrollment = await repo.findById(enrollmentId);
  if (!enrollment || enrollment.status !== 'active' || enrollment.offer_letter_no) return;
  const [user, internship] = await Promise.all([
    authRepository.findUserById(enrollment.user_id),
    repo.internshipLite(enrollment.internship_id),
  ]);
  if (!user || !internship) return;

  let batchName: string | null = null;
  let start: string | null = null;
  let end: string | null = null;
  if (enrollment.batch_id) {
    await tx(async (client) => {
      const b = await repo.batchForUpdate(client, enrollment.batch_id as number);
      if (b) {
        batchName = b.name;
        start = dayjs(b.start_date).format('DD MMM YYYY');
        end = dayjs(b.end_date).format('DD MMM YYYY');
      }
    });
  }

  const refNo = await repo.nextOfferLetterNo();
  const pdf = await generateOfferLetterPdf({
    refNo,
    studentName: user.full_name,
    internshipTitle: internship.title,
    instructorName: internship.instructor_name,
    batchName,
    startDate: start,
    endDate: end,
    durationWeeks: internship.duration_weeks,
    issuedOn: dayjs().format('DD MMM YYYY'),
  });
  const path = await storageService.upload('private', `offer-letters/${refNo}.pdf`, pdf, 'application/pdf');
  await repo.setOfferLetter(enrollment.id, refNo, path);
  await notifyService.sendEmail(
    user.email ?? '',
    user.full_name,
    `Your offer letter — ${internship.title}`,
    `<p>Hi ${user.full_name},</p><p>Welcome aboard! Your internship offer letter (ref <strong>${refNo}</strong>) is attached to your dashboard. Log in to download it.</p>`,
  );
  logger.info({ enrollmentId, refNo }, 'offer letter issued');
}

/** Register durable-queue handlers owned by the enrolments module. */
export function registerEnrollmentJobs(): void {
  registerJob('offer-letter', (p) => runOfferLetter(Number((p as { enrollmentId: number }).enrollmentId)));
}
