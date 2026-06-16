import { randomBytes } from 'node:crypto';
import { env } from '../../config/env';
import { AppError } from '../../core/appError';
import { ErrorCodes } from '../../core/errorCodes';
import { query, queryOne, tx } from '../../db/pool';
import { eventBus } from '../../services/eventBus';
import { bunnyStreamService } from '../../services/bunnyStream';
import { storageService } from '../../services/storage';
import type { StorageZone } from '../../services/storage';
import type { AuthUser } from '../../middlewares/auth';

/**
 * Media module (2.6). Folder conventions and who may write there:
 *   /resumes      students (public zone? NO — private)        → private
 *   /submissions  students                                     → private
 *   /assets       instructors/moderators (thumbnails, docs)    → public
 *   /certificates,/invoices,/offer-letters — SYSTEM ONLY (jobs), API rejects
 */
const FOLDERS: Record<string, { zone: StorageZone; roles: AuthUser['roles'] }> = {
  resumes: { zone: 'private', roles: ['student'] },
  submissions: { zone: 'private', roles: ['student'] },
  assets: { zone: 'public', roles: ['instructor', 'moderator'] },
};
const MAX_BYTES = 50 * 1024 * 1024;
const BLOCKED_MIME = /(x-msdownload|x-sh|x-executable|javascript)/i;

export const mediaService = {
  async upload(
    user: AuthUser,
    folder: string,
    file: { originalname: string; mimetype: string; size: number; buffer: Buffer },
  ): Promise<{ path: string; url: string | null; zone: StorageZone }> {
    const cfg = FOLDERS[folder];
    if (!cfg) throw AppError.validation(`folder must be one of: ${Object.keys(FOLDERS).join(', ')}`);
    const allowed =
      user.roles.includes('super_admin') || user.roles.some((r) => cfg.roles.includes(r));
    if (!allowed) throw AppError.forbidden(`Your role cannot upload to /${folder}`);
    if (file.size > MAX_BYTES) throw AppError.validation('File exceeds 50 MB');
    if (BLOCKED_MIME.test(file.mimetype)) throw AppError.validation('File type not allowed');

    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80);
    const path = `${folder}/u${user.id}/${Date.now()}-${randomBytes(4).toString('hex')}-${safeName}`;
    await storageService.upload(cfg.zone, path, file.buffer, file.mimetype);
    return {
      path,
      url: cfg.zone === 'public' ? storageService.publicUrl(path) : null, // private → signed URLs on read
      zone: cfg.zone,
    };
  },

  /** Instructor creates the Bunny video for a lesson; returns TUS upload creds. */
  async createLessonVideo(user: AuthUser, lessonId: number): Promise<Record<string, unknown>> {
    const lesson = await queryOne<{ id: number; title: string; type: string; owner_id: number }>(
      `select l.id, l.title, l.type, ip.user_id as owner_id
       from lessons l
       join curriculum_sections s on s.id = l.section_id
       join internships i on i.id = s.internship_id
       join instructor_profiles ip on ip.id = i.instructor_profile_id
       where l.id = $1`,
      [lessonId],
    );
    if (!lesson) throw AppError.notFound('Lesson');
    if (lesson.type !== 'video') throw AppError.validation('Lesson is not a video lesson');
    const canManage =
      user.roles.includes('super_admin') ||
      user.roles.includes('moderator') ||
      lesson.owner_id === user.id;
    if (!canManage) throw AppError.forbidden('Not your internship');

    const video = await bunnyStreamService.createVideo(lesson.title);
    await query(`update lessons set bunny_video_id = $2, video_status = 'uploading' where id = $1`, [
      lessonId,
      video.videoId,
    ]);
    return video;
  },

  async deleteLessonVideo(user: AuthUser, lessonId: number): Promise<void> {
    const lesson = await queryOne<{ bunny_video_id: string | null; owner_id: number }>(
      `select l.bunny_video_id, ip.user_id as owner_id
       from lessons l
       join curriculum_sections s on s.id = l.section_id
       join internships i on i.id = s.internship_id
       join instructor_profiles ip on ip.id = i.instructor_profile_id
       where l.id = $1`,
      [lessonId],
    );
    if (!lesson) throw AppError.notFound('Lesson');
    const canManage =
      user.roles.includes('super_admin') ||
      user.roles.includes('moderator') ||
      lesson.owner_id === user.id;
    if (!canManage) throw AppError.forbidden('Not your internship');
    if (lesson.bunny_video_id) await bunnyStreamService.deleteVideo(lesson.bunny_video_id);
    await query(
      `update lessons set bunny_video_id = null, video_status = null, duration_minutes = null where id = $1`,
      [lessonId],
    );
  },

  /** Bunny encode webhook: {VideoGuid, Status} — 3=finished, 5=failed. */
  async handleStreamWebhook(body: Record<string, unknown>): Promise<{ status: string }> {
    const videoId = String(body.VideoGuid ?? '');
    const status = Number(body.Status ?? -1);
    if (!videoId) return { status: 'ignored' };
    if (status === 3) {
      const seconds = Number(body.VideoDuration ?? 0); // present on finished events
      await query(
        `update lessons set video_status = 'ready',
           duration_minutes = coalesce(nullif(round($2::numeric / 60), 0), duration_minutes)
         where bunny_video_id = $1`,
        [videoId, seconds],
      );
      return { status: 'lesson-ready' };
    }
    if (status === 5) {
      await query(`update lessons set video_status = 'failed' where bunny_video_id = $1`, [videoId]);
      return { status: 'encode-failed' };
    }
    return { status: 'ignored' };
  },

  /**
   * Signed playback. Enforces: active enrollment owning the lesson's
   * internship (or isPreview), lesson ready, and the sequential-unlock rule —
   * every EARLIER mandatory lesson (section order, then lesson order) must be
   * completed first (env SEQUENTIAL_UNLOCK).
   */
  async play(userId: number, lessonId: number, enrollmentId: number, clientIp: string | null): Promise<Record<string, unknown>> {
    const row = await queryOne<{
      lesson_id: number; type: string; bunny_video_id: string | null; video_status: string | null;
      is_preview: boolean; internship_id: number; e_user: number | null; e_status: string | null;
      e_internship: number | null;
    }>(
      `select l.id as lesson_id, l.type, l.bunny_video_id, l.video_status, l.is_preview,
              s.internship_id, e.user_id as e_user, e.status as e_status, e.internship_id as e_internship
       from lessons l
       join curriculum_sections s on s.id = l.section_id
       left join enrollments e on e.id = $3
       where l.id = $1 and $2 = $2`,
      [lessonId, userId, enrollmentId],
    );
    if (!row) throw AppError.notFound('Lesson');
    if (row.type !== 'video') throw AppError.validation('Only video lessons have playback');

    if (!row.is_preview) {
      const owned = row.e_user === userId && row.e_internship === row.internship_id;
      if (!owned || row.e_status !== 'active') {
        throw AppError.forbidden('Active enrollment required to watch this lesson');
      }
      if (env.SEQUENTIAL_UNLOCK) {
        const blocker = await queryOne<{ id: number; title: string }>(
          `select l2.id, l2.title
           from lessons l2
           join curriculum_sections s2 on s2.id = l2.section_id
           join lessons l1 on l1.id = $1
           join curriculum_sections s1 on s1.id = l1.section_id
           where s2.internship_id = s1.internship_id
             and l2.is_mandatory
             and (s2.display_order, l2.display_order, l2.id) < (s1.display_order, l1.display_order, l1.id)
             and not exists (
               select 1 from lesson_progress p
               where p.enrollment_id = $2 and p.lesson_id = l2.id and p.status = 'completed'
             )
           order by s2.display_order, l2.display_order limit 1`,
          [lessonId, enrollmentId],
        );
        if (blocker) {
          throw new AppError(
            ErrorCodes.LESSON_LOCKED,
            `Complete "${blocker.title}" first`,
            { blockingLessonId: blocker.id },
          );
        }
      }
    }
    if (!row.bunny_video_id || row.video_status !== 'ready') {
      throw AppError.conflict('Video is still processing — try again shortly');
    }
    return bunnyStreamService.signedPlayback(row.bunny_video_id, clientIp);
  },

  /**
   * Lesson progress + enrollment % weighted by lesson duration:
   * progress = Σ(duration of completed mandatory lessons) ÷ Σ(duration of all
   * mandatory lessons). Lessons without duration weigh 5 minutes (floor 1).
   */
  async progress(
    userId: number,
    lessonId: number,
    enrollmentId: number,
    watchedSeconds: number | undefined,
    completed: boolean | undefined,
  ): Promise<Record<string, unknown>> {
    const enrollment = await queryOne<{ id: number; user_id: number; internship_id: number; status: string }>(
      `select id, user_id, internship_id, status from enrollments where id = $1`,
      [enrollmentId],
    );
    if (!enrollment || enrollment.user_id !== userId) throw AppError.notFound('Enrollment');
    if (enrollment.status !== 'active') throw AppError.conflict('Enrollment is not active');
    const lesson = await queryOne<{ internship_id: number }>(
      `select s.internship_id from lessons l join curriculum_sections s on s.id = l.section_id where l.id = $1`,
      [lessonId],
    );
    if (!lesson || lesson.internship_id !== enrollment.internship_id) throw AppError.notFound('Lesson');

    const percent = await tx(async (client) => {
      await client.query(
        `insert into lesson_progress (enrollment_id, lesson_id, status, watched_seconds, completed_at)
         values ($1, $2, case when $4 then 'completed' else 'in_progress' end::progress_status,
                 coalesce($3, 0), case when $4 then now() end)
         on conflict (enrollment_id, lesson_id) do update set
           watched_seconds = greatest(lesson_progress.watched_seconds, coalesce($3, lesson_progress.watched_seconds)),
           status = case when $4 or lesson_progress.status = 'completed' then 'completed' else 'in_progress' end::progress_status,
           completed_at = coalesce(lesson_progress.completed_at, case when $4 then now() end)`,
        [enrollmentId, lessonId, watchedSeconds ?? null, completed ?? false],
      );
      const res = await client.query<{ pct: string }>(
        `with mandatory as (
           select l.id, greatest(coalesce(l.duration_minutes, 5), 1) as w
           from lessons l join curriculum_sections s on s.id = l.section_id
           where s.internship_id = $2 and l.is_mandatory
         )
         select coalesce(round(
           100.0 * sum(m.w) filter (where p.status = 'completed') / nullif(sum(m.w), 0), 2), 0) as pct
         from mandatory m
         left join lesson_progress p on p.lesson_id = m.id and p.enrollment_id = $1`,
        [enrollmentId, enrollment.internship_id],
      );
      const pct = Number(res.rows[0]?.pct ?? 0);
      await client.query(`update enrollments set progress_percent = $2 where id = $1`, [
        enrollmentId,
        pct,
      ]);
      return pct;
    });
    if (completed) {
      // Engagement signal for gamification (R3); idempotent awards downstream.
      eventBus.emit('lesson.completed', { userId, lessonId, enrollmentId, internshipId: enrollment.internship_id });
    }
    return { lessonId, completed: completed ?? false, progressPercent: percent };
  },
};
