import { AppError } from '../../core/appError';
import { ErrorCodes } from '../../core/errorCodes';
import { query, queryOne, tx } from '../../db/pool';
import type { AuthUser } from '../../middlewares/auth';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

/** Quizzes (module 2.9): authoring + attempts with server-side scoring. */

async function assertOwnsQuiz(user: AuthUser, quizId: number): Promise<{ internship_id: number }> {
  const row = await queryOne<{ internship_id: number; owner: number }>(
    `select q.internship_id, ip.user_id as owner
     from quizzes q join internships i on i.id = q.internship_id
     join instructor_profiles ip on ip.id = i.instructor_profile_id where q.id = $1`,
    [quizId],
  );
  if (!row) throw AppError.notFound('Quiz');
  const ok = user.roles.includes('super_admin') || user.roles.includes('moderator') || row.owner === user.id;
  if (!ok) throw AppError.forbidden('Not your quiz');
  return row;
}

async function assertActiveEnrollment(userId: number, enrollmentId: number, internshipId: number): Promise<void> {
  const e = await queryOne<{ user_id: number; internship_id: number; status: string }>(
    `select user_id, internship_id, status from enrollments where id = $1`,
    [enrollmentId],
  );
  if (!e || e.user_id !== userId || e.internship_id !== internshipId || e.status !== 'active') {
    throw AppError.forbidden('Active enrollment required');
  }
}

interface QuestionRow {
  id: number;
  question_text: string;
  question_type: 'single_choice' | 'multiple_choice' | 'true_false';
  options: { id: string; text: string }[];
  correct_options: string[];
  explanation: string | null;
  marks: string;
}

export const quizzesService = {
  async addQuestion(user: AuthUser, quizId: number, input: Record<string, unknown>): Promise<unknown> {
    await assertOwnsQuiz(user, quizId);
    return queryOne(
      `insert into quiz_questions (quiz_id, question_text, question_type, options, correct_options, explanation, marks, display_order)
       values ($1, $2, $3, $4, $5, $6, $7, coalesce((select max(display_order) + 1 from quiz_questions where quiz_id = $1), 1))
       returning id`,
      [quizId, input.questionText, input.questionType, JSON.stringify(input.options),
       JSON.stringify(input.correctOptions), input.explanation ?? null, Number(input.marks ?? 1)],
    );
  },

  /** Student view — meta + attempts used (never the answers). */
  async quizForStudent(userId: number, quizId: number, enrollmentId: number): Promise<Record<string, unknown>> {
    const quiz = await queryOne<Row>(`select * from quizzes where id = $1 and is_published`, [quizId]);
    if (!quiz) throw AppError.notFound('Quiz');
    await assertActiveEnrollment(userId, enrollmentId, quiz.internship_id);
    const used = await queryOne<{ n: number }>(
      `select count(*)::int8 as n from quiz_attempts where quiz_id = $1 and enrollment_id = $2 and status <> 'in_progress'`,
      [quizId, enrollmentId],
    );
    const qCount = await queryOne<{ n: number }>(
      `select count(*)::int8 as n from quiz_questions where quiz_id = $1`, [quizId],
    );
    return {
      id: quiz.id, title: quiz.title, passPercent: Number(quiz.pass_percent),
      timeLimitMinutes: quiz.time_limit_minutes, maxAttempts: quiz.max_attempts,
      attemptsUsed: used?.n ?? 0, questionCount: qCount?.n ?? 0,
    };
  },

  /** Start attempt: enforces limit, expires stale in-progress, returns questions (no answers). */
  async startAttempt(userId: number, quizId: number, enrollmentId: number): Promise<Record<string, unknown>> {
    const quiz = await queryOne<Row>(`select * from quizzes where id = $1 and is_published`, [quizId]);
    if (!quiz) throw AppError.notFound('Quiz');
    await assertActiveEnrollment(userId, enrollmentId, quiz.internship_id);

    return tx(async (client) => {
      await client.query(
        `update quiz_attempts set status = 'expired'
         where quiz_id = $1 and enrollment_id = $2 and status = 'in_progress'`,
        [quizId, enrollmentId],
      );
      const used = await client.query<{ n: number }>(
        `select count(*)::int8 as n from quiz_attempts where quiz_id = $1 and enrollment_id = $2 and status <> 'in_progress'`,
        [quizId, enrollmentId],
      );
      if (Number(used.rows[0]?.n ?? 0) >= Number(quiz.max_attempts)) {
        throw new AppError(ErrorCodes.ATTEMPTS_EXHAUSTED, 'No attempts left for this quiz');
      }
      const attempt = await client.query<{ id: number; attempt_number: number; started_at: Date }>(
        `insert into quiz_attempts (quiz_id, enrollment_id, attempt_number, status)
         values ($1, $2, (select coalesce(max(attempt_number), 0) + 1 from quiz_attempts where quiz_id = $1 and enrollment_id = $2), 'in_progress')
         returning id, attempt_number, started_at`,
        [quizId, enrollmentId],
      );
      const questions = await client.query<QuestionRow>(
        `select id, question_text, question_type, options, marks from quiz_questions
         where quiz_id = $1
         order by case when $2 then random() end, display_order`,
        [quizId, quiz.shuffle_questions],
      );
      const row = attempt.rows[0];
      const expiresAt = quiz.time_limit_minutes
        ? new Date(new Date(row?.started_at as Date).getTime() + Number(quiz.time_limit_minutes) * 60_000).toISOString()
        : null;
      return {
        attemptId: row?.id, attemptNumber: row?.attempt_number, expiresAt,
        questions: questions.rows.map((q) => ({
          id: q.id, questionText: q.question_text, questionType: q.question_type,
          options: q.options, marks: Number(q.marks),
        })),
      };
    });
  },

  async saveAnswers(userId: number, attemptId: number, answers: Record<string, string[]>): Promise<void> {
    const a = await this.ownedAttempt(userId, attemptId);
    if (a.status !== 'in_progress') throw AppError.conflict('Attempt is no longer open');
    if (this.expired(a)) {
      await query(`update quiz_attempts set status = 'expired' where id = $1`, [attemptId]);
      throw new AppError(ErrorCodes.OTP_EXPIRED, 'Time limit reached — attempt expired');
    }
    await query(`update quiz_attempts set answers = $2 where id = $1`, [attemptId, JSON.stringify(answers)]);
  },

  /** Server-side scoring: multi-choice = exact set match. Best attempt feeds certificates. */
  async submitAttempt(userId: number, attemptId: number): Promise<Record<string, unknown>> {
    const a = await this.ownedAttempt(userId, attemptId);
    if (a.status === 'submitted') return this.result(userId, attemptId);
    const timedOut = this.expired(a);

    const questions = await query<QuestionRow>(
      `select id, question_text, question_type, options, correct_options, explanation, marks
       from quiz_questions where quiz_id = $1 order by display_order`,
      [a.quiz_id],
    );
    const answers = (a.answers ?? {}) as Record<string, string[]>;
    let score = 0;
    let maxScore = 0;
    const detail = questions.map((q) => {
      const marks = Number(q.marks);
      maxScore += marks;
      const selected = [...(answers[String(q.id)] ?? [])].sort();
      const correct = [...q.correct_options].sort();
      const isCorrect = selected.length === correct.length && selected.every((v, i) => v === correct[i]);
      if (isCorrect) score += marks;
      return { questionId: q.id, correct: isCorrect, selected, correctOptions: correct, explanation: q.explanation };
    });
    const percent = maxScore > 0 ? Math.round((10000 * score) / maxScore) / 100 : 0;
    const quiz = await queryOne<{ pass_percent: string }>(`select pass_percent from quizzes where id = $1`, [a.quiz_id]);
    const passed = percent >= Number(quiz?.pass_percent ?? 0);

    await query(
      `update quiz_attempts set status = $2::attempt_status, submitted_at = now(),
         score = $3, max_score = $4, percent = $5, passed = $6
       where id = $1`,
      [attemptId, timedOut ? 'expired' : 'submitted', score, maxScore, percent, passed],
    );
    return { attemptId, score, maxScore, percent, passed, timedOut, questions: detail };
  },

  async result(userId: number, attemptId: number): Promise<Record<string, unknown>> {
    const a = await this.ownedAttempt(userId, attemptId);
    if (a.status === 'in_progress') throw AppError.conflict('Attempt not submitted yet');
    return {
      attemptId: a.id, score: Number(a.score ?? 0), maxScore: Number(a.max_score ?? 0),
      percent: Number(a.percent ?? 0), passed: a.passed ?? false,
    };
  },

  async ownedAttempt(userId: number, attemptId: number): Promise<Row> {
    const a = await queryOne<Row>(
      `select qa.*, q.time_limit_minutes, e.user_id as owner
       from quiz_attempts qa
       join quizzes q on q.id = qa.quiz_id
       join enrollments e on e.id = qa.enrollment_id
       where qa.id = $1`,
      [attemptId],
    );
    if (!a || a.owner !== userId) throw AppError.notFound('Attempt');
    return a;
  },

  expired(a: Row): boolean {
    if (!a.time_limit_minutes) return false;
    return Date.now() > new Date(a.started_at).getTime() + Number(a.time_limit_minutes) * 60_000;
  },

  /** Best percent per published quiz of an internship (certificate input). */
  async bestPercents(enrollmentId: number, internshipId: number): Promise<{ quizId: number; best: number }[]> {
    const rows = await query<{ quiz_id: number; best: string | null }>(
      `select q.id as quiz_id, max(qa.percent) as best
       from quizzes q
       left join quiz_attempts qa on qa.quiz_id = q.id and qa.enrollment_id = $1 and qa.status = 'submitted'
       where q.internship_id = $2 and q.is_published
       group by q.id`,
      [enrollmentId, internshipId],
    );
    return rows.map((r) => ({ quizId: r.quiz_id, best: Number(r.best ?? 0) }));
  },
};
