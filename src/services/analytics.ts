import { query } from '../db/pool';
import { logger } from '../core/logger';
import { eventBus } from './eventBus';

/**
 * First-party product analytics. `track` is fire-and-forget — it must never throw
 * into a business flow. Events land in analytics_events for funnels/trends; the
 * headline metrics are also computed live from source tables in the admin API.
 */
export function track(name: string, opts?: { userId?: number | null; props?: Record<string, unknown> }): void {
  void query(
    `insert into analytics_events (name, user_id, props) values ($1, $2, $3::jsonb)`,
    [name, opts?.userId ?? null, JSON.stringify(opts?.props ?? {})],
  ).catch((err) => logger.warn({ err, name }, 'analytics track failed (ignored)'));
}

/** Record the existing domain events as analytics events. Called once at boot. */
export function registerAnalyticsSubscribers(): void {
  eventBus.on('certificate.issued', (p) => track('certificate.issued', { userId: p.userId, props: { certificateNo: p.certificateNo } }));
  eventBus.on('lesson.completed', (p) => track('lesson.completed', { userId: p.userId, props: { internshipId: p.internshipId } }));
  eventBus.on('submission.received', (p) => track('submission.received', { userId: p.studentUserId, props: { taskId: p.taskId } }));
  eventBus.on('review.completed', (p) => track('review.completed', { userId: p.studentUserId, props: { decision: p.decision } }));
}
