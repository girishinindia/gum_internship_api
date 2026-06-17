import dayjs from 'dayjs';
import { z } from 'zod';
import { buildPagination } from '../../core/apiResponse';
import type { PaginationMeta } from '../../core/apiResponse';
import { AppError } from '../../core/appError';
import { ErrorCodes } from '../../core/errorCodes';
import { query, queryOne, tx } from '../../db/pool';
import { eventBus } from '../../services/eventBus';
import type { AuthUser } from '../../middlewares/auth';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

/**
 * Project engine (module 2.8).
 *
 * RUBRIC JSONB SHAPE (stored on project_tasks.rubric):
 *   [{ "criterion": "Functionality", "weight": 0.4, "maxPoints": 40 },
 *    { "criterion": "Code quality",  "weight": 0.3, "maxPoints": 30 },
 *    { "criterion": "README & tests","weight": 0.3, "maxPoints": 30 }]
 * Review rubricScores must reference the SAME criterion names with
 * 0 ≤ points ≤ maxPoints; totalScore = Σ points (≤ task.max_score).
 *
 * Resubmission policy: decision 'resubmit' reopens with deadline +3 days,
 * max 2 resubmits → at most versions 1..3. 'resubmit' is stored as the
 * existing enum value 'changes_requested' (API speaks approved|resubmit).
 */

export const rubricSchema = z
  .array(
    z.object({
      criterion: z.string().min(2).max(80),
      weight: z.number().positive().max(1),
      maxPoints: z.number().positive().max(1000),
    }),
  )
  .min(1)
  .max(10);

const MAX_RESUBMITS = 2;
const RESUBMIT_EXTENSION_DAYS = 3;

async function assertOwnsInternship(user: AuthUser, internshipId: number): Promise<void> {
  if (user.roles.includes('super_admin') || user.roles.includes('moderator')) return;
  const row = await queryOne<{ user_id: number }>(
    `select ip.user_id from internships i join instructor_profiles ip on ip.id = i.instructor_profile_id where i.id = $1`,
    [internshipId],
  );
  if (!row) throw AppError.notFound('Internship');
  if (row.user_id !== user.id) throw AppError.forbidden('Not your internship');
}

function deadlineFor(batchStart: string | null, dueOffsetDays: number | null, resubmitDueOn: string | null): string | null {
  if (resubmitDueOn) return resubmitDueOn;
  if (!batchStart || dueOffsetDays === null) return null;
  return dayjs(batchStart).add(dueOffsetDays, 'day').format('YYYY-MM-DD');
}

/** When a weekly task opens: the start of its week (batch start + (week-1)×7d). */
function availableFromFor(batchStart: string | null, weekNumber: number | null): string | null {
  if (!batchStart || !weekNumber || weekNumber < 1) return null;
  return dayjs(batchStart).add((weekNumber - 1) * 7, 'day').format('YYYY-MM-DD');
}

export const projectsService = {
  /** Instructor: create/update a weekly task (rubric validated). */
  async upsertTask(user: AuthUser, projectId: number, taskId: number | null, input: Record<string, unknown>): Promise<unknown> {
    const project = await queryOne<{ internship_id: number }>(
      `select internship_id from projects where id = $1`, [projectId],
    );
    if (!project) throw AppError.notFound('Project');
    await assertOwnsInternship(user, project.internship_id);
    const rubric = rubricSchema.parse(input.rubric ?? []);
    const maxScore = Number(input.maxScore ?? rubric.reduce((s, r) => s + r.maxPoints, 0));

    if (taskId) {
      return queryOne(
        `update project_tasks set title = $2, instructions = $3, week_number = $4,
           allowed_submission_types = $5, max_score = $6, rubric = $7, due_offset_days = $8,
           weight = $9, is_mandatory = $10
         where id = $1 and project_id = ${projectId} returning id`,
        [taskId, input.title, input.instructions ?? null, input.weekNumber,
         (input.allowedSubmissionTypes as string[] | undefined) ?? ['file', 'github_url', 'live_url'],
         maxScore, JSON.stringify(rubric), input.dueOffsetDays ?? null,
         Number(input.weight ?? 1), input.isMandatory ?? true],
      );
    }
    return queryOne(
      `insert into project_tasks
         (project_id, week_number, title, instructions, allowed_submission_types, max_score, rubric,
          due_offset_days, weight, is_mandatory, display_order)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $2) returning id`,
      [projectId, input.weekNumber, input.title, input.instructions ?? null,
       (input.allowedSubmissionTypes as string[] | undefined) ?? ['file', 'github_url', 'live_url'],
       maxScore, JSON.stringify(rubric), input.dueOffsetDays ?? null,
       Number(input.weight ?? 1), input.isMandatory ?? true],
    );
  },

  /** Student: tasks with computed deadlines, latest submission state, resubmits left. */
  async tasksForEnrollment(userId: number, enrollmentId: number): Promise<unknown[]> {
    const e = await queryOne<{ id: number; user_id: number; internship_id: number; batch_start: string | null }>(
      `select e.id, e.user_id, e.internship_id, b.start_date::text as batch_start
       from enrollments e left join internship_batches b on b.id = e.batch_id where e.id = $1`,
      [enrollmentId],
    );
    if (!e || e.user_id !== userId) throw AppError.notFound('Enrollment');
    const rows = await query<Row>(
      `select t.id, t.week_number, t.title, t.instructions,
              t.allowed_submission_types::text[] as allowed_submission_types,
              t.max_score, t.rubric, t.due_offset_days, t.weight, t.is_mandatory,
              s.id as submission_id, s.version, s.status as submission_status,
              s.is_late, s.resubmit_due_on::text as resubmit_due_on, s.submitted_at,
              r.total_score, r.feedback, r.decision
       from project_tasks t
       join projects p on p.id = t.project_id and p.internship_id = $2
       left join lateral (
         select * from submissions where task_id = t.id and enrollment_id = $1
         order by version desc limit 1
       ) s on true
       left join submission_reviews r on r.submission_id = s.id
       order by t.week_number, t.display_order`,
      [enrollmentId, e.internship_id],
    );
    return rows.map((t: Record<string, unknown>) => ({
      taskId: t.id,
      weekNumber: t.week_number,
      title: t.title,
      instructions: t.instructions,
      allowedSubmissionTypes: t.allowed_submission_types,
      maxScore: Number(t.max_score),
      weight: Number(t.weight),
      isMandatory: t.is_mandatory,
      rubric: t.rubric,
      availableFrom: availableFromFor(e.batch_start, t.week_number as number | null),
      deadline: deadlineFor(e.batch_start, t.due_offset_days as number | null, t.resubmit_due_on as string | null),
      latestSubmission: t.submission_id
        ? {
            id: t.submission_id, version: t.version, status: t.submission_status,
            isLate: t.is_late, submittedAt: t.submitted_at,
            review: t.decision
              ? { decision: t.decision === 'changes_requested' ? 'resubmit' : t.decision, totalScore: t.total_score === null ? null : Number(t.total_score), feedback: t.feedback }
              : null,
          }
        : null,
      resubmitsLeft: Math.max(0, MAX_RESUBMITS - Math.max(Number(t.version ?? 1) - 1, 0)),
    }));
  },

  /** Student submits (versioned; late flag; max 2 resubmits). */
  async submit(
    userId: number,
    taskId: number,
    input: { enrollmentId: number; submissionType: string; fileUrl?: string; urlValue?: string; notes?: string },
  ): Promise<Record<string, unknown>> {
    const ctx = await queryOne<{
      e_user: number; e_status: string; internship_id: number; batch_start: string | null;
      t_internship: number; allowed: string[]; due_offset: number | null; t_title: string;
      instructor_user: number; last_version: number | null; last_status: string | null; last_resubmit_due: string | null;
    }>(
      `select e.user_id as e_user, e.status as e_status, e.internship_id, b.start_date::text as batch_start,
              p.internship_id as t_internship, t.allowed_submission_types::text[] as allowed,
              t.due_offset_days as due_offset, t.title as t_title, ip.user_id as instructor_user,
              s.version as last_version, s.status as last_status, s.resubmit_due_on::text as last_resubmit_due
       from project_tasks t
       join projects p on p.id = t.project_id
       join internships i on i.id = p.internship_id
       join instructor_profiles ip on ip.id = i.instructor_profile_id
       join enrollments e on e.id = $2
       left join internship_batches b on b.id = e.batch_id
       left join lateral (
         select * from submissions where task_id = $1 and enrollment_id = $2 order by version desc limit 1
       ) s on true
       where t.id = $1`,
      [taskId, input.enrollmentId],
    );
    if (!ctx || ctx.e_user !== userId) throw AppError.notFound('Task or enrollment');
    if (ctx.t_internship !== ctx.internship_id) throw AppError.validation('Task belongs to a different internship');
    if (ctx.e_status !== 'active') throw AppError.conflict('Enrollment is not active');
    if (!ctx.allowed.includes(input.submissionType)) {
      throw AppError.validation(`This task accepts: ${ctx.allowed.join(', ')}`);
    }
    if (ctx.last_status === 'submitted' || ctx.last_status === 'under_review') {
      throw AppError.conflict('Previous version is pending review', ErrorCodes.SUBMISSION_PENDING_REVIEW);
    }
    if (ctx.last_status === 'approved') throw AppError.conflict('Task already approved');
    const version = (ctx.last_version ?? 0) + 1;
    if (version > 1 + MAX_RESUBMITS) {
      throw new AppError(ErrorCodes.MAX_RESUBMITS, `Maximum ${MAX_RESUBMITS} resubmissions reached`);
    }
    const deadline = deadlineFor(ctx.batch_start, ctx.due_offset, ctx.last_resubmit_due);
    const isLate = deadline ? dayjs().isAfter(dayjs(deadline).endOf('day')) : false;

    const row = await queryOne<{ id: number }>(
      `insert into submissions (task_id, enrollment_id, version, submission_type, file_url, url_value, notes, status, is_late)
       values ($1, $2, $3, $4, $5, $6, $7, 'submitted', $8) returning id`,
      [taskId, input.enrollmentId, version, input.submissionType,
       input.fileUrl ?? null, input.urlValue ?? null, input.notes ?? null, isLate],
    );
    eventBus.emit('submission.received', {
      submissionId: row?.id as number, taskId, enrollmentId: input.enrollmentId,
      studentUserId: userId, instructorUserId: ctx.instructor_user, taskTitle: ctx.t_title, version,
    });
    return { id: row?.id, version, isLate, status: 'submitted' };
  },

  /** Mentor review queue: oldest first, own internships, filters. */
  async reviewQueue(
    user: AuthUser,
    filters: { internshipId?: number; batchId?: number; page: number; limit: number },
  ): Promise<{ items: unknown[]; pagination: PaginationMeta }> {
    const params: unknown[] = [user.id];
    const where: string[] = [
      `s.status = 'submitted'`,
      `(ip.user_id = $1 or $1 in (select ur.user_id from user_roles ur join roles ro on ro.id = ur.role_id where ro.name in ('moderator', 'super_admin') and ur.user_id = $1))`,
    ];
    if (filters.internshipId) {
      params.push(filters.internshipId);
      where.push(`p.internship_id = $${params.length}`);
    }
    if (filters.batchId) {
      params.push(filters.batchId);
      where.push(`e.batch_id = $${params.length}`);
    }
    const rows = await query<Row>(
      `select s.id, s.task_id, s.enrollment_id, s.version, s.submission_type, s.file_url,
              s.url_value, s.notes, s.is_late, s.submitted_at, t.title as task_title,
              t.rubric, t.max_score, u.full_name as student_name, i.title as internship_title,
              count(*) over()::int8 as total_count
       from submissions s
       join project_tasks t on t.id = s.task_id
       join projects p on p.id = t.project_id
       join internships i on i.id = p.internship_id
       join instructor_profiles ip on ip.id = i.instructor_profile_id
       join enrollments e on e.id = s.enrollment_id
       join users u on u.id = e.user_id
       where ${where.join(' and ')}
       order by s.submitted_at asc
       limit ${filters.limit} offset ${(filters.page - 1) * filters.limit}`,
      params,
    );
    const total = (rows[0] as { total_count?: number } | undefined)?.total_count ?? 0;
    return {
      items: rows.map((r: Record<string, unknown>) => ({
        submissionId: r.id, taskId: r.task_id, enrollmentId: r.enrollment_id, version: r.version,
        type: r.submission_type, fileUrl: r.file_url, urlValue: r.url_value, notes: r.notes,
        isLate: r.is_late, submittedAt: r.submitted_at, taskTitle: r.task_title,
        rubric: r.rubric, maxScore: Number(r.max_score), studentName: r.student_name,
        internshipTitle: r.internship_title,
      })),
      pagination: buildPagination(filters.page, filters.limit, total),
    };
  },

  /** Review with rubric validation; approved → recompute weighted project score. */
  async review(
    user: AuthUser,
    submissionId: number,
    input: { decision: 'approved' | 'resubmit'; rubricScores: { criterion: string; points: number }[]; feedback?: string },
  ): Promise<Record<string, unknown>> {
    const s = await queryOne<{
      id: number; status: string; enrollment_id: number; task_id: number; version: number;
      rubric: { criterion: string; maxPoints: number }[]; max_score: string; internship_id: number;
      owner: number; student: number; task_title: string;
    }>(
      `select s.id, s.status, s.enrollment_id, s.task_id, s.version, t.rubric, t.max_score,
              p.internship_id, ip.user_id as owner, e.user_id as student, t.title as task_title
       from submissions s
       join project_tasks t on t.id = s.task_id
       join projects p on p.id = t.project_id
       join internships i on i.id = p.internship_id
       join instructor_profiles ip on ip.id = i.instructor_profile_id
       join enrollments e on e.id = s.enrollment_id
       where s.id = $1`,
      [submissionId],
    );
    if (!s) throw AppError.notFound('Submission');
    const canReview =
      user.roles.includes('super_admin') || user.roles.includes('moderator') || s.owner === user.id;
    if (!canReview) throw AppError.forbidden('Not your internship');
    if (s.status !== 'submitted' && s.status !== 'under_review') {
      throw AppError.conflict('Submission already reviewed');
    }
    if (input.decision === 'resubmit' && !input.feedback) {
      throw AppError.validation('feedback is required when requesting a resubmit');
    }
    // Validate rubric scores against the task's rubric definition
    // (accept both maxPoints and max_points key styles — seeds use snake_case)
    const defs = new Map(
      (s.rubric as Row[]).map((r) => [r.criterion as string, Number(r.maxPoints ?? r.max_points)]),
    );
    if (input.rubricScores.length !== defs.size) {
      throw AppError.validation(`Score every criterion: ${[...defs.keys()].join(', ')}`);
    }
    let total = 0;
    for (const sc of input.rubricScores) {
      const max = defs.get(sc.criterion);
      if (max === undefined) throw AppError.validation(`Unknown criterion "${sc.criterion}"`);
      if (sc.points < 0 || sc.points > max) {
        throw AppError.validation(`"${sc.criterion}" must be between 0 and ${max}`);
      }
      total += sc.points;
    }
    total = Math.min(total, Number(s.max_score));

    const resubmitDueOn =
      input.decision === 'resubmit' ? dayjs().add(RESUBMIT_EXTENSION_DAYS, 'day').format('YYYY-MM-DD') : null;

    await tx(async (client) => {
      await client.query(
        `insert into submission_reviews (submission_id, reviewer_id, rubric_scores, total_score, decision, feedback)
         values ($1, $2, $3, $4, $5::review_decision, $6)`,
        [s.id, user.id, JSON.stringify(input.rubricScores), total,
         input.decision === 'approved' ? 'approved' : 'changes_requested', input.feedback ?? null],
      );
      await client.query(
        `update submissions set status = $2::submission_status, resubmit_due_on = $3 where id = $1`,
        [s.id, input.decision === 'approved' ? 'approved' : 'changes_requested', resubmitDueOn],
      );
      if (input.decision === 'approved') {
        // Weighted project score across mandatory tasks with an approved version
        await client.query(
          `update enrollments e set project_score = sub.score from (
             select round(sum(pct * weight) / nullif(sum(weight), 0), 2) as score
             from (
               select distinct on (t.id) t.weight,
                      100.0 * r.total_score / nullif(t.max_score, 0) as pct
               from project_tasks t
               join projects p on p.id = t.project_id and p.internship_id = $2
               join submissions sx on sx.task_id = t.id and sx.enrollment_id = $1 and sx.status = 'approved'
               join submission_reviews r on r.submission_id = sx.id
               where t.is_mandatory
               order by t.id, sx.version desc
             ) scored
           ) sub
           where e.id = $1`,
          [s.enrollment_id, s.internship_id],
        );
      }
    });

    eventBus.emit('review.completed', {
      submissionId: s.id, enrollmentId: s.enrollment_id, studentUserId: s.student,
      decision: input.decision, taskTitle: s.task_title, totalScore: total, resubmitDueOn,
    });
    return { submissionId: s.id, decision: input.decision, totalScore: total, resubmitDueOn };
  },
};
