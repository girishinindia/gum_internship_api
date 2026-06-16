import { logger } from '../../core/logger';
import { eventBus } from '../../services/eventBus';
import { gamificationRepository as repo } from './repository';

/** XP values per action. */
export const XP = {
  lesson_completed: 10,
  task_approved: 25,
  certificate: 100,
  forum_answer: 15,
  streak_bonus: 5,
} as const;

/** Level curve: every 100 XP = 1 level (level 1 at 0 XP). */
export function levelFor(xp: number): { level: number; xpIntoLevel: number; xpForNext: number } {
  const level = Math.floor(xp / 100) + 1;
  return { level, xpIntoLevel: xp % 100, xpForNext: 100 };
}

/**
 * Update the daily streak. Returns the new current streak. Idempotent within a
 * day (same-day activity doesn't bump). Uses DB current_date semantics via the
 * stored last_active_on.
 */
async function touchStreak(userId: number): Promise<number> {
  const s = await repo.getStreak(userId);
  const today = new Date().toISOString().slice(0, 10);
  if (!s) {
    await repo.upsertStreak(userId, 1, 1);
    return 1;
  }
  if (s.last_active_on === today) return s.current_streak; // already counted today
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const current = s.last_active_on === yesterday ? s.current_streak + 1 : 1;
  const longest = Math.max(s.longest_streak, current);
  await repo.upsertStreak(userId, current, longest);
  // streak milestone badges
  if (current >= 7) await repo.awardBadgeByCode(userId, 'streak_7');
  if (current >= 30) await repo.awardBadgeByCode(userId, 'streak_30');
  return current;
}

export const gamificationService = {
  XP,

  async myStats(userId: number): Promise<Record<string, unknown>> {
    const [xp, badges, streak, rank, recent] = await Promise.all([
      repo.totalXp(userId),
      repo.myBadges(userId),
      repo.getStreak(userId),
      repo.rankFor(userId),
      repo.recentXp(userId, 10),
    ]);
    return {
      xp,
      ...levelFor(xp),
      rank,
      currentStreak: streak?.current_streak ?? 0,
      longestStreak: streak?.longest_streak ?? 0,
      badges,
      recent,
    };
  },

  async myBadges(userId: number): Promise<{ earned: unknown[]; all: unknown[] }> {
    const [earned, all] = await Promise.all([repo.myBadges(userId), repo.allBadges()]);
    return { earned, all };
  },

  async leaderboard(limit: number): Promise<unknown[]> {
    return repo.leaderboard(limit);
  },

  /** Called by the forum module after a reply is posted. */
  async onForumReply(userId: number, replyId: number): Promise<void> {
    const awarded = await repo.awardXp(userId, 'forum_answer', XP.forum_answer, `forum_reply:${replyId}`);
    if (awarded) {
      await touchStreak(userId);
      if ((await repo.forumAnswerCount(userId)) >= 5) await repo.awardBadgeByCode(userId, 'helper');
    }
  },
};

/** Register event-bus subscribers at boot (mirrors notifications). */
export function registerGamificationSubscribers(): void {
  eventBus.on('lesson.completed', async (p) => {
    const awarded = await repo.awardXp(p.userId, 'lesson_completed', XP.lesson_completed, `lesson:${p.lessonId}`, { internshipId: p.internshipId });
    if (awarded) await repo.awardBadgeByCode(p.userId, 'first_steps');
    await touchStreak(p.userId); // learning activity counts toward the streak
  });

  eventBus.on('review.completed', async (p) => {
    if (p.decision !== 'approved') return;
    const awarded = await repo.awardXp(p.studentUserId, 'task_approved', XP.task_approved, `submission:${p.submissionId}`);
    if (awarded) await repo.awardBadgeByCode(p.studentUserId, 'task_master');
    await touchStreak(p.studentUserId);
  });

  eventBus.on('certificate.issued', async (p) => {
    await repo.awardXp(p.userId, 'certificate', XP.certificate, `certificate:${p.certificateId}`, { certificateNo: p.certificateNo });
    await repo.awardBadgeByCode(p.userId, 'graduate');
  });

  logger.info('gamification subscribers registered');
}
