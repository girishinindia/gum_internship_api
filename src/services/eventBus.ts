import { logger } from '../core/logger';

/**
 * Tiny typed in-process event bus (module 2.8). Subscribers (notifications
 * 2.10) register at boot; emit never throws into business flows.
 */
export interface DomainEvents {
  'submission.received': { submissionId: number; taskId: number; enrollmentId: number; studentUserId: number; instructorUserId: number; taskTitle: string; version: number };
  'review.completed': { submissionId: number; enrollmentId: number; studentUserId: number; decision: 'approved' | 'resubmit'; taskTitle: string; totalScore: number | null; resubmitDueOn: string | null };
  'certificate.issued': { certificateId: number; userId: number; certificateNo: string; internshipTitle: string };
  'lesson.completed': { userId: number; lessonId: number; enrollmentId: number; internshipId: number };
}

type Handler<K extends keyof DomainEvents> = (payload: DomainEvents[K]) => Promise<void> | void;

const handlers: { [K in keyof DomainEvents]?: Handler<K>[] } = {};

export const eventBus = {
  on<K extends keyof DomainEvents>(event: K, handler: Handler<K>): void {
    const list = (handlers[event] ?? (handlers[event] = [])) as Handler<K>[];
    list.push(handler);
  },

  emit<K extends keyof DomainEvents>(event: K, payload: DomainEvents[K]): void {
    for (const h of handlers[event] ?? []) {
      Promise.resolve()
        .then(() => h(payload))
        .catch((err) => logger.error({ err, event }, 'event handler failed'));
    }
    logger.debug({ event }, 'event emitted');
  },
};
