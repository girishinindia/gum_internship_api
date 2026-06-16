import { query, queryOne } from '../../db/pool';

export interface QuestionRow {
  id: number;
  question_text: string;
  options: string[];
  correct_index: number;
  display_order: number;
}

export const assessmentRepository = {
  async tracks(): Promise<string[]> {
    const rows = await query<{ track: string }>(`select distinct track from assessment_questions order by track`);
    return rows.map((r) => r.track);
  },

  async questionsForTrack(track: string): Promise<QuestionRow[]> {
    return query<QuestionRow>(
      `select id, question_text, options, correct_index, display_order
       from assessment_questions where track = $1 order by display_order, id`,
      [track],
    );
  },

  /** Published internships whose title or category matches a keyword. */
  async recommendInternships(keyword: string): Promise<unknown[]> {
    return query(
      `select i.id, i.title, i.slug, c.name as category, i.level, i.pricing_type as "pricingType"
       from internships i left join categories c on c.id = i.category_id
       where i.status = 'published'
         and (i.title ilike $1 or c.name ilike $1)
       order by i.enrollment_count desc nulls last
       limit 5`,
      [`%${keyword}%`],
    );
  },

  async saveAttempt(input: {
    userId: number; track: string; score: number; correctCount: number; questionCount: number;
    recommendations: unknown[]; answers: unknown[];
  }): Promise<number> {
    const r = await queryOne<{ id: number }>(
      `insert into assessment_attempts (user_id, track, score, correct_count, question_count, recommendations, answers)
       values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb) returning id`,
      [input.userId, input.track, input.score, input.correctCount, input.questionCount,
       JSON.stringify(input.recommendations), JSON.stringify(input.answers)],
    );
    return Number(r?.id);
  },

  async myAttempts(userId: number): Promise<unknown[]> {
    return query(
      `select id, track, score, correct_count as "correctCount", question_count as "questionCount",
              recommendations, created_at as "createdAt"
       from assessment_attempts where user_id = $1 order by created_at desc limit 20`,
      [userId],
    );
  },
};
