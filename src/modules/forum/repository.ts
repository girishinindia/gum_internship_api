import { query, queryOne, tx } from '../../db/pool';

export const forumRepository = {
  async isEnrolled(userId: number, internshipId: number): Promise<boolean> {
    const r = await queryOne<{ ok: boolean }>(
      `select exists(select 1 from enrollments where user_id = $1 and internship_id = $2
        and status in ('active','completed')) as ok`,
      [userId, internshipId],
    );
    return r?.ok ?? false;
  },

  async createThread(internshipId: number, userId: number, title: string, body: string): Promise<Record<string, unknown>> {
    const r = await queryOne<Record<string, unknown>>(
      `insert into forum_threads (internship_id, user_id, title, body)
       values ($1, $2, $3, $4)
       returning id, internship_id as "internshipId", title, created_at as "createdAt"`,
      [internshipId, userId, title, body],
    );
    return r ?? {};
  },

  async listThreads(internshipId: number, page: number, limit: number): Promise<{ items: unknown[]; total: number }> {
    const offset = (page - 1) * limit;
    const items = await query(
      `select t.id, t.title, t.is_pinned as "isPinned", t.is_locked as "isLocked",
              t.is_resolved as "isResolved", t.reply_count as "replyCount",
              t.last_reply_at as "lastReplyAt", t.created_at as "createdAt",
              u.full_name as "author",
              count(*) over()::int8 as total_count
       from forum_threads t join users u on u.id = t.user_id
       where t.internship_id = $1 and not t.is_deleted
       order by t.is_pinned desc, t.last_reply_at desc nulls last, t.created_at desc
       limit ${limit} offset ${offset}`,
      [internshipId],
    );
    const total = Number((items[0] as { total_count?: number } | undefined)?.total_count ?? 0);
    return { items: items.map((r) => { const x = r as Record<string, unknown>; delete x.total_count; return x; }), total };
  },

  async thread(threadId: number): Promise<Record<string, unknown> | null> {
    return queryOne(
      `select t.id, t.internship_id as "internshipId", t.user_id as "userId", t.title, t.body,
              t.is_pinned as "isPinned", t.is_locked as "isLocked", t.is_resolved as "isResolved",
              t.is_deleted as "isDeleted", t.created_at as "createdAt", u.full_name as "author"
       from forum_threads t join users u on u.id = t.user_id
       where t.id = $1`,
      [threadId],
    );
  },

  async replies(threadId: number): Promise<unknown[]> {
    return query(
      `select r.id, r.user_id as "userId", r.body, r.is_instructor as "isInstructor",
              r.is_accepted as "isAccepted", r.created_at as "createdAt", u.full_name as "author"
       from forum_replies r join users u on u.id = r.user_id
       where r.thread_id = $1 and not r.is_deleted
       order by r.is_accepted desc, r.created_at asc`,
      [threadId],
    );
  },

  /** Insert a reply + bump the thread's counters atomically. */
  async addReply(threadId: number, userId: number, body: string, isInstructor: boolean): Promise<Record<string, unknown>> {
    return tx(async (client) => {
      const res = await client.query<Record<string, unknown>>(
        `insert into forum_replies (thread_id, user_id, body, is_instructor)
         values ($1, $2, $3, $4)
         returning id, body, is_instructor as "isInstructor", created_at as "createdAt"`,
        [threadId, userId, body, isInstructor],
      );
      await client.query(
        `update forum_threads set reply_count = reply_count + 1, last_reply_at = now() where id = $1`,
        [threadId],
      );
      return res.rows[0] ?? {};
    });
  },

  async acceptReply(threadId: number, replyId: number): Promise<void> {
    await tx(async (client) => {
      await client.query(`update forum_replies set is_accepted = false where thread_id = $1`, [threadId]);
      await client.query(`update forum_replies set is_accepted = true where id = $1 and thread_id = $2`, [replyId, threadId]);
      await client.query(`update forum_threads set is_resolved = true where id = $1`, [threadId]);
    });
  },

  // ---- Moderation ----------------------------------------------------------
  async setThreadFlags(threadId: number, flags: { isPinned?: boolean; isLocked?: boolean; isDeleted?: boolean }): Promise<void> {
    const sets: string[] = [];
    const params: unknown[] = [threadId];
    if (flags.isPinned !== undefined) { params.push(flags.isPinned); sets.push(`is_pinned = $${params.length}`); }
    if (flags.isLocked !== undefined) { params.push(flags.isLocked); sets.push(`is_locked = $${params.length}`); }
    if (flags.isDeleted !== undefined) { params.push(flags.isDeleted); sets.push(`is_deleted = $${params.length}`); }
    if (!sets.length) return;
    await query(`update forum_threads set ${sets.join(', ')} where id = $1`, params);
  },

  async softDeleteReply(replyId: number): Promise<void> {
    await query(`update forum_replies set is_deleted = true where id = $1`, [replyId]);
  },
};
