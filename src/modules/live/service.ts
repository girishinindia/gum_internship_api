import dayjs from 'dayjs';
import { AppError } from '../../core/appError';
import { ErrorCodes } from '../../core/errorCodes';
import { logger } from '../../core/logger';
import { query, queryOne } from '../../db/pool';
import { liveProviders } from '../../services/liveProviders';
import { notifyService } from '../../services/notify';
import type { AuthUser } from '../../middlewares/auth';

const JOIN_EARLY_MINUTES = 15;

async function assertManagesBatch(user: AuthUser, batchId: number): Promise<{ internship_id: number }> {
  const row = await queryOne<{ internship_id: number; owner_id: number }>(
    `select b.internship_id, ip.user_id as owner_id
     from internship_batches b
     join internships i on i.id = b.internship_id
     join instructor_profiles ip on ip.id = i.instructor_profile_id
     where b.id = $1`,
    [batchId],
  );
  if (!row) throw AppError.notFound('Batch');
  const ok =
    user.roles.includes('super_admin') || user.roles.includes('moderator') || row.owner_id === user.id;
  if (!ok) throw AppError.forbidden('Not your batch');
  return row;
}

function dto(s: Record<string, unknown>): Record<string, unknown> {
  return {
    id: s.id,
    internshipId: s.internship_id,
    batchId: s.batch_id,
    provider: s.provider,
    title: s.title,
    scheduledStart: s.scheduled_start,
    scheduledEnd: s.scheduled_end,
    status: s.status,
    recordingLessonId: s.recording_lesson_id,
  };
}

export const liveService = {
  async schedule(
    user: AuthUser,
    batchId: number,
    input: { title: string; startsAt: string; durationMinutes: number; provider: 'zoom' | 'google_meet'; manualJoinUrl?: string },
  ): Promise<Record<string, unknown>> {
    const batch = await assertManagesBatch(user, batchId);
    const startsAt = new Date(input.startsAt);
    if (startsAt.getTime() < Date.now()) throw AppError.validation('startsAt must be in the future');

    let meeting;
    try {
      meeting = await liveProviders[input.provider].createMeeting({
        title: input.title,
        startsAt,
        durationMinutes: input.durationMinutes,
        manualJoinUrl: input.manualJoinUrl,
      });
    } catch (err) {
      if (err instanceof Error && err.message === 'MEET_MANUAL_LINK_REQUIRED') {
        throw AppError.validation('Google Meet (v1): provide manualJoinUrl — auto-creation is P2');
      }
      throw err;
    }

    const row = await queryOne<Record<string, unknown>>(
      `insert into live_sessions
         (internship_id, batch_id, provider, title, meeting_id, join_url, passcode,
          scheduled_start, scheduled_end, status, created_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $8::timestamptz + ($9 || ' minutes')::interval, 'scheduled', $10)
       returning *`,
      [
        batch.internship_id, batchId, input.provider, input.title,
        meeting.meetingId, meeting.joinUrl, meeting.passcode,
        startsAt.toISOString(), input.durationMinutes, user.id,
      ],
    );
    return dto(row as Record<string, unknown>);
  },

  async listForBatch(user: AuthUser, batchId: number): Promise<unknown[]> {
    const isStaffOrOwner = await (async () => {
      try { await assertManagesBatch(user, batchId); return true; } catch { return false; }
    })();
    if (!isStaffOrOwner) {
      const enrolled = await queryOne(
        `select 1 from enrollments where user_id = $1 and batch_id = $2 and status in ('active', 'completed')`,
        [user.id, batchId],
      );
      if (!enrolled) throw AppError.forbidden('Enroll in this batch to view its sessions');
    }
    const rows = await query<Record<string, unknown>>(
      `select * from live_sessions where batch_id = $1 order by scheduled_start`,
      [batchId],
    );
    return rows.map(dto);
  },

  /** Join inside [start−15m, end]: returns URL and upserts attendance. */
  async join(userId: number, sessionId: number, enrollmentId: number): Promise<Record<string, unknown>> {
    const s = await queryOne<Record<string, unknown>>(
      `select ls.*, e.user_id as e_user, e.batch_id as e_batch, e.status as e_status
       from live_sessions ls left join enrollments e on e.id = $2
       where ls.id = $1`,
      [sessionId, enrollmentId],
    );
    if (!s) throw AppError.notFound('Live session');
    if (s.e_user !== userId || s.e_batch !== s.batch_id || s.e_status !== 'active') {
      throw AppError.forbidden('Active enrollment in this batch required');
    }
    const now = Date.now();
    const start = new Date(s.scheduled_start as string).getTime();
    const end = new Date(s.scheduled_end as string).getTime();
    if (now < start - JOIN_EARLY_MINUTES * 60_000) {
      throw new AppError(ErrorCodes.TOO_EARLY, `Joins open ${JOIN_EARLY_MINUTES} minutes before start`);
    }
    if (now > end || s.status === 'cancelled') {
      throw new AppError(ErrorCodes.SESSION_ENDED, 'This session has ended');
    }
    await query(
      `insert into attendance_records (live_session_id, enrollment_id, status, joined_at)
       values ($1, $2, 'present', now())
       on conflict (live_session_id, enrollment_id) do update set
         joined_at = coalesce(attendance_records.joined_at, now()), status = 'present'`,
      [sessionId, enrollmentId],
    );
    return { joinUrl: s.join_url, passcode: s.passcode ?? null };
  },

  /** Instructor manual/bulk attendance override. */
  async markAttendance(
    user: AuthUser,
    sessionId: number,
    records: { enrollmentId: number; status: 'present' | 'late' | 'absent' }[],
  ): Promise<{ updated: number }> {
    const s = await queryOne<{ batch_id: number }>(`select batch_id from live_sessions where id = $1`, [sessionId]);
    if (!s) throw AppError.notFound('Live session');
    await assertManagesBatch(user, s.batch_id);
    for (const r of records) {
      await query(
        `insert into attendance_records (live_session_id, enrollment_id, status, marked_by)
         values ($1, $2, $3, $4)
         on conflict (live_session_id, enrollment_id) do update set status = $3, marked_by = $4`,
        [sessionId, r.enrollmentId, r.status, user.id],
      );
    }
    return { updated: records.length };
  },

  /** Attendance % for an enrollment = present/late over ENDED sessions of its batch. */
  async attendancePercent(enrollmentId: number): Promise<number> {
    const row = await queryOne<{ pct: string }>(
      `select coalesce(round(
         100.0 * count(*) filter (where a.status in ('present', 'late'))
         / nullif(count(*), 0), 2), 0) as pct
       from live_sessions ls
       join enrollments e on e.id = $1 and e.batch_id = ls.batch_id
       left join attendance_records a on a.live_session_id = ls.id and a.enrollment_id = $1
       where ls.status <> 'cancelled' and ls.scheduled_end < now()`,
      [enrollmentId],
    );
    return Number(row?.pct ?? 0);
  },

  /** Instructor attaches a Bunny recording → becomes a lesson in "Session Recordings". */
  async attachRecording(user: AuthUser, sessionId: number, bunnyVideoId: string): Promise<Record<string, unknown>> {
    const s = await queryOne<{ id: number; batch_id: number; internship_id: number; title: string }>(
      `select id, batch_id, internship_id, title from live_sessions where id = $1`,
      [sessionId],
    );
    if (!s) throw AppError.notFound('Live session');
    await assertManagesBatch(user, s.batch_id);

    let section = await queryOne<{ id: number }>(
      `select id from curriculum_sections where internship_id = $1 and title = 'Session Recordings'`,
      [s.internship_id],
    );
    if (!section) {
      section = await queryOne<{ id: number }>(
        `insert into curriculum_sections (internship_id, title, display_order)
         values ($1, 'Session Recordings', 99) returning id`,
        [s.internship_id],
      );
    }
    const lesson = await queryOne<{ id: number }>(
      `insert into lessons (section_id, title, type, display_order, bunny_video_id, video_status, is_mandatory)
       values ($1, $2, 'video', (select coalesce(max(display_order), 0) + 1 from lessons where section_id = $1),
               $3, 'ready', false)
       returning id`,
      [section?.id, `Recording: ${s.title}`, bunnyVideoId],
    );
    await query(`update live_sessions set recording_lesson_id = $2, status = 'completed' where id = $1`, [
      sessionId,
      lesson?.id,
    ]);
    return { recordingLessonId: lesson?.id, sectionId: section?.id };
  },

  /**
   * Reminder sweep (T-24h and T-1h windows). Called by an interval in
   * server.ts; uses sent-markers so each fires once. Email now; SMS/push go
   * through the notifications module (2.10) which subscribes to the same data.
   */
  async runDueReminders(): Promise<{ sent24h: number; sent1h: number }> {
    const due = await query<{
      id: number; title: string; scheduled_start: Date; batch_id: number;
      kind: string; email: string | null; full_name: string;
    }>(
      `with windows as (
         select ls.id, ls.title, ls.scheduled_start, ls.batch_id,
                case
                  when ls.reminder_1h_sent_at is null
                   and ls.scheduled_start between now() and now() + interval '1 hour' then '1h'
                  when ls.reminder_24h_sent_at is null
                   and ls.scheduled_start between now() + interval '1 hour' and now() + interval '24 hours' then '24h'
                end as kind
         from live_sessions ls
         where ls.status = 'scheduled'
       )
       select w.id, w.title, w.scheduled_start, w.batch_id, w.kind, u.email, u.full_name
       from windows w
       join enrollments e on e.batch_id = w.batch_id and e.status = 'active'
       join users u on u.id = e.user_id
       where w.kind is not null`,
    );
    let sent24h = 0;
    let sent1h = 0;
    const touched = new Map<number, string>();
    for (const r of due) {
      const when = dayjs(r.scheduled_start).format('DD MMM, hh:mm A');
      await notifyService.sendEmail(
        r.email ?? '',
        r.full_name,
        `Reminder: "${r.title}" ${r.kind === '1h' ? 'starts in 1 hour' : 'is tomorrow'}`,
        `<p>Hi ${r.full_name}, your live session <strong>${r.title}</strong> starts at ${when} IST. Join from your dashboard.</p>`,
      );
      touched.set(r.id, r.kind);
      if (r.kind === '1h') sent1h += 1;
      else sent24h += 1;
    }
    for (const [id, kind] of touched) {
      await query(
        kind === '1h'
          ? `update live_sessions set reminder_1h_sent_at = now() where id = $1`
          : `update live_sessions set reminder_24h_sent_at = now() where id = $1`,
        [id],
      );
    }
    if (due.length) logger.info({ sent24h, sent1h }, 'live reminders dispatched');
    return { sent24h, sent1h };
  },
};
