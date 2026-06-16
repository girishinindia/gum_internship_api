import { AppError } from '../../core/appError';
import { gamificationService } from '../gamification/service';
import { forumRepository as repo } from './repository';
import type { CreateThreadInput } from './schemas';

const STAFF_ROLES = ['instructor', 'moderator', 'support', 'super_admin'];

function isStaff(roles: string[]): boolean {
  return roles.some((r) => STAFF_ROLES.includes(r));
}

export const forumService = {
  async createThread(userId: number, roles: string[], input: CreateThreadInput): Promise<Record<string, unknown>> {
    // Students must be enrolled; staff can post anywhere (announcements, answers).
    if (!isStaff(roles) && !(await repo.isEnrolled(userId, input.internshipId))) {
      throw new AppError('FORBIDDEN', 'Enroll in this internship to post in its forum.');
    }
    return repo.createThread(input.internshipId, userId, input.title, input.body);
  },

  async listThreads(internshipId: number, page: number, limit: number): Promise<{ items: unknown[]; total: number }> {
    return repo.listThreads(internshipId, page, limit);
  },

  async getThread(threadId: number): Promise<Record<string, unknown>> {
    const thread = await repo.thread(threadId);
    if (!thread || thread.isDeleted) throw AppError.notFound('Thread');
    const replies = await repo.replies(threadId);
    return { ...thread, replies };
  },

  async reply(userId: number, roles: string[], threadId: number, body: string): Promise<Record<string, unknown>> {
    const thread = await repo.thread(threadId);
    if (!thread || thread.isDeleted) throw AppError.notFound('Thread');
    if (thread.isLocked && !isStaff(roles)) throw AppError.conflict('This thread is locked.');
    if (!isStaff(roles) && !(await repo.isEnrolled(userId, Number(thread.internshipId)))) {
      throw new AppError('FORBIDDEN', 'Enroll in this internship to reply.');
    }
    const reply = await repo.addReply(threadId, userId, body, isStaff(roles));
    // Award community XP / Helper badge (idempotent inside gamification).
    await gamificationService.onForumReply(userId, Number(reply.id));
    return reply;
  },

  /** Thread owner or staff may accept an answer. */
  async acceptAnswer(userId: number, roles: string[], threadId: number, replyId: number): Promise<void> {
    const thread = await repo.thread(threadId);
    if (!thread || thread.isDeleted) throw AppError.notFound('Thread');
    if (Number(thread.userId) !== userId && !isStaff(roles)) {
      throw new AppError('FORBIDDEN', 'Only the asker or staff can accept an answer.');
    }
    await repo.acceptReply(threadId, replyId);
  },

  // ---- Moderation (staff) --------------------------------------------------
  async moderateThread(threadId: number, flags: { isPinned?: boolean; isLocked?: boolean; isDeleted?: boolean }): Promise<void> {
    const thread = await repo.thread(threadId);
    if (!thread) throw AppError.notFound('Thread');
    await repo.setThreadFlags(threadId, flags);
  },

  async deleteReply(replyId: number): Promise<void> {
    await repo.softDeleteReply(replyId);
  },
};
