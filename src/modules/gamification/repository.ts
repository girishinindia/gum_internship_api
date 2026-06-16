import { query, queryOne } from '../../db/pool';

export interface StreakRow {
  user_id: number;
  current_streak: number;
  longest_streak: number;
  last_active_on: string | null;
}

export const gamificationRepository = {
  /** Idempotent XP award (unique on user_id+source_key). Returns true if newly awarded. */
  async awardXp(userId: number, kind: string, points: number, sourceKey: string, metadata: Record<string, unknown> = {}): Promise<boolean> {
    const row = await queryOne<{ id: number }>(
      `insert into xp_events (user_id, kind, points, source_key, metadata)
       values ($1, $2, $3, $4, $5::jsonb)
       on conflict (user_id, source_key) do nothing
       returning id`,
      [userId, kind, points, sourceKey, JSON.stringify(metadata)],
    );
    return row !== null;
  },

  async totalXp(userId: number): Promise<number> {
    const r = await queryOne<{ total: number }>(`select coalesce(sum(points), 0)::int8 as total from xp_events where user_id = $1`, [userId]);
    return Number(r?.total ?? 0);
  },

  async recentXp(userId: number, limit: number): Promise<unknown[]> {
    return query(
      `select kind, points, created_at as "createdAt" from xp_events where user_id = $1 order by created_at desc limit $2`,
      [userId, limit],
    );
  },

  // ---- Badges --------------------------------------------------------------
  async awardBadgeByCode(userId: number, code: string): Promise<boolean> {
    const row = await queryOne<{ id: number }>(
      `insert into user_badges (user_id, badge_id)
       select $1, b.id from badges b where b.code = $2
       on conflict (user_id, badge_id) do nothing
       returning id`,
      [userId, code],
    );
    return row !== null;
  },

  async myBadges(userId: number): Promise<unknown[]> {
    return query(
      `select b.code, b.name, b.description, b.icon, b.tier, ub.awarded_at as "awardedAt"
       from user_badges ub join badges b on b.id = ub.badge_id
       where ub.user_id = $1 order by ub.awarded_at desc`,
      [userId],
    );
  },

  async allBadges(): Promise<unknown[]> {
    return query(`select code, name, description, icon, tier from badges order by id`);
  },

  // ---- Streaks -------------------------------------------------------------
  async getStreak(userId: number): Promise<StreakRow | null> {
    return queryOne<StreakRow>(`select user_id, current_streak, longest_streak, last_active_on::text from streaks where user_id = $1`, [userId]);
  },

  async upsertStreak(userId: number, current: number, longest: number): Promise<void> {
    await query(
      `insert into streaks (user_id, current_streak, longest_streak, last_active_on)
       values ($1, $2, $3, current_date)
       on conflict (user_id) do update set
         current_streak = excluded.current_streak,
         longest_streak = greatest(streaks.longest_streak, excluded.longest_streak),
         last_active_on = current_date`,
      [userId, current, longest],
    );
  },

  // ---- Leaderboard ---------------------------------------------------------
  async leaderboard(limit: number): Promise<unknown[]> {
    return query(
      `select u.id as "userId", u.full_name as "name", u.avatar_url as "avatarUrl",
              coalesce(sum(x.points), 0)::int8 as "xp",
              rank() over (order by coalesce(sum(x.points), 0) desc)::int as "rank"
       from xp_events x join users u on u.id = x.user_id
       group by u.id, u.full_name, u.avatar_url
       order by "xp" desc
       limit $1`,
      [limit],
    );
  },

  async rankFor(userId: number): Promise<number | null> {
    const r = await queryOne<{ rank: number }>(
      `with totals as (
         select user_id, sum(points) as xp from xp_events group by user_id
       ), ranked as (
         select user_id, rank() over (order by xp desc) as rank from totals
       )
       select rank::int from ranked where user_id = $1`,
      [userId],
    );
    return r ? Number(r.rank) : null;
  },

  async forumAnswerCount(userId: number): Promise<number> {
    const r = await queryOne<{ n: number }>(
      `select count(*)::int8 as n from forum_replies where user_id = $1 and not is_deleted`,
      [userId],
    );
    return Number(r?.n ?? 0);
  },
};
