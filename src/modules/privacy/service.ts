import { AppError } from '../../core/appError';
import { ErrorCodes } from '../../core/errorCodes';
import { query, tx } from '../../db/pool';
import { verifyPassword } from '../../services/crypto';
import { authRepository } from '../auth/repository';
import { audit } from '../admin/service';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

/**
 * DPDP / GDPR data rights: a machine-readable export of a person's data, and
 * erasure (anonymise PII, keep legally-required financial/audit records
 * de-identified). Self-serve from the web app.
 */
export const privacyService = {
  async exportData(userId: number): Promise<Record<string, unknown>> {
    const q = (sql: string): Promise<Row[]> => query<Row>(sql, [userId]);
    const [
      profile, enrollments, orders, certificates, cpd, assessments,
      forumThreads, forumReplies, supportTickets, ticketReplies,
      portfolio, badges, jobApplications, mentorBookings,
    ] = await Promise.all([
      q(`select id, email, phone, full_name as "fullName", status, track,
                marketing_consent as "marketingConsent", created_at as "createdAt"
         from users where id=$1`),
      q(`select e.id, i.title as internship, e.status, e.progress_percent::float8 as "progressPercent",
                e.enrolled_at as "enrolledAt"
         from enrollments e join internships i on i.id=e.internship_id
         where e.user_id=$1 order by e.enrolled_at`),
      q(`select order_no as "orderNo", total_amount::float8 as "totalAmount", status,
                invoice_no as "invoiceNo", created_at as "createdAt"
         from orders where user_id=$1 order by created_at`),
      q(`select c.certificate_no as "certificateNo", i.title as internship, c.grade, c.issued_at as "issuedAt"
         from certificates c join internships i on i.id=c.internship_id
         where c.user_id=$1 order by c.issued_at`),
      q(`select c.hours, c.note, i.title as internship, c.created_at as "createdAt"
         from cpd_entries c join internships i on i.id=c.internship_id where c.user_id=$1`),
      q(`select track, score, correct_count as "correctCount", question_count as "questionCount",
                created_at as "createdAt" from assessment_attempts where user_id=$1`),
      q(`select id, title, body, created_at as "createdAt" from forum_threads where user_id=$1`),
      q(`select id, thread_id as "threadId", body, created_at as "createdAt" from forum_replies where user_id=$1`),
      q(`select ticket_no as "ticketNo", subject, description, status, created_at as "createdAt"
         from support_tickets where user_id=$1`),
      q(`select id, ticket_id as "ticketId", body, created_at as "createdAt" from ticket_replies where author_id=$1`),
      q(`select handle, headline, bio, location, links, updated_at as "updatedAt" from portfolios where user_id=$1`),
      q(`select b.code, b.name, ub.awarded_at as "awardedAt"
         from user_badges ub join badges b on b.id=ub.badge_id where ub.user_id=$1`),
      q(`select ja.id, j.title as job, ja.status, ja.created_at as "createdAt"
         from job_applications ja join jobs j on j.id=ja.job_id where ja.user_id=$1`),
      q(`select id, status, price::float8 as price, created_at as "createdAt"
         from mentor_bookings where student_user_id=$1`),
    ]);
    return {
      exportedAt: new Date().toISOString(),
      notice: 'Machine-readable copy of your personal data on the GUM Internships platform.',
      profile: profile[0] ?? null,
      enrollments,
      orders,
      certificates,
      cpdEntries: cpd,
      assessments,
      forumThreads,
      forumReplies,
      supportTickets,
      ticketReplies,
      portfolio: portfolio[0] ?? null,
      badges,
      jobApplications,
      mentorBookings,
    };
  },

  /** Right to erasure: anonymise the identity, revoke access, drop transient PII. */
  async deleteAccount(userId: number, password: string): Promise<void> {
    const user = await authRepository.findUserById(userId);
    if (!user) throw AppError.notFound('User');
    if (!user.password_hash || !(await verifyPassword(password, user.password_hash))) {
      throw new AppError(ErrorCodes.INVALID_CREDENTIALS, 'Incorrect password');
    }
    await tx(async (client) => {
      // A check constraint requires at least one contact field, so email becomes a
      // non-PII tombstone (unique per id) rather than null.
      await client.query(
        `update users set email = 'deleted-' || id::text || '@deleted.invalid', phone = null,
           full_name='Deleted user', avatar_url=null, password_hash=null, resume_url=null,
           marketing_consent=false, status='deleted', deleted_at=now(),
           totp_secret=null, totp_enabled=false, totp_backup_codes='{}'
         where id=$1`,
        [userId],
      );
      await client.query(`update user_sessions set revoked_at=now() where user_id=$1 and revoked_at is null`, [userId]);
      await client.query(`delete from device_tokens where user_id=$1`, [userId]);
      await client.query(`delete from otp_codes where user_id=$1`, [userId]);
      await client.query(`delete from notification_preferences where user_id=$1`, [userId]);
    });
    await audit({ actorId: userId, action: 'account.erased', entityType: 'user', entityId: userId, after: { status: 'deleted' } });
  },
};
