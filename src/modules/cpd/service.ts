import { logger } from '../../core/logger';
import { query, queryOne } from '../../db/pool';
import { eventBus } from '../../services/eventBus';

/** Certified hours credited per program week (CPD convention). */
const HOURS_PER_WEEK = 5;

export const cpdService = {
  /** Idempotent award from a certificate (1 ledger entry per enrollment). */
  async awardForCertificate(certificateId: number): Promise<void> {
    const c = await queryOne<{ user_id: number; enrollment_id: number; internship_id: number; title: string; duration_weeks: number | null }>(
      `select cert.user_id, cert.enrollment_id, cert.internship_id, i.title, i.duration_weeks
       from certificates cert join internships i on i.id = cert.internship_id
       where cert.id = $1`,
      [certificateId],
    );
    if (!c) return;
    const weeks = c.duration_weeks ?? 4;
    const hours = weeks * HOURS_PER_WEEK;
    await query(
      `insert into cpd_entries (user_id, enrollment_id, internship_id, hours, note)
       values ($1, $2, $3, $4, $5)
       on conflict (enrollment_id) do nothing`,
      [c.user_id, c.enrollment_id, c.internship_id, hours, `Completed ${c.title} (${weeks} weeks)`],
    );
  },

  async myCpd(userId: number): Promise<Record<string, unknown>> {
    const entries = await query<Record<string, unknown>>(
      `select e.id, e.hours, e.note, e.created_at as "createdAt", i.title as "internshipTitle"
       from cpd_entries e join internships i on i.id = e.internship_id
       where e.user_id = $1 order by e.created_at desc`,
      [userId],
    );
    const total = await queryOne<{ total: string }>(
      `select coalesce(sum(hours), 0)::numeric(10,2) as total from cpd_entries where user_id = $1`,
      [userId],
    );
    return { totalHours: Number(total?.total ?? 0), entries };
  },
};

export function registerCpdSubscribers(): void {
  eventBus.on('certificate.issued', async (p) => {
    await cpdService.awardForCertificate(p.certificateId);
  });
  logger.info('cpd subscribers registered');
}
