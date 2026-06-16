import { AppError } from '../../core/appError';
import { assessmentRepository as repo } from './repository';

/** Track → keyword used to match recommended internships by title/category. */
const TRACK_KEYWORD: Record<string, string> = {
  web: 'web',
  data: 'data',
  flutter: 'flutter',
  marketing: 'marketing',
};

function readiness(score: number): { band: string; message: string } {
  if (score >= 80) return { band: 'ready', message: 'You\'re ready — pick an advanced track and start building.' };
  if (score >= 50) return { band: 'developing', message: 'Solid foundation — a structured internship will close the gaps.' };
  return { band: 'foundational', message: 'Start with a beginner-friendly internship to build the basics.' };
}

export const assessmentService = {
  async listTracks(): Promise<{ tracks: string[] }> {
    return { tracks: await repo.tracks() };
  },

  /** Diagnostic questions WITHOUT the answer key. */
  async getDiagnostic(track: string): Promise<Record<string, unknown>> {
    const qs = await repo.questionsForTrack(track);
    if (qs.length === 0) throw AppError.notFound('Assessment track');
    return {
      track,
      questions: qs.map((q) => ({ id: q.id, question: q.question_text, options: q.options })),
    };
  },

  /**
   * Score answers server-side, derive a readiness band, and recommend
   * internships for the track. answers = [{ questionId, selectedIndex }].
   */
  async submit(userId: number, track: string, answers: { questionId: number; selectedIndex: number }[]): Promise<Record<string, unknown>> {
    const qs = await repo.questionsForTrack(track);
    if (qs.length === 0) throw AppError.notFound('Assessment track');

    const keyById = new Map(qs.map((q) => [q.id, q.correct_index]));
    const picked = new Map(answers.map((a) => [a.questionId, a.selectedIndex]));
    let correct = 0;
    const graded = qs.map((q) => {
      const sel = picked.get(q.id);
      const ok = sel === q.correct_index;
      if (ok) correct++;
      return { questionId: q.id, selectedIndex: sel ?? null, correct: ok };
    });
    void keyById;

    const score = Math.round((correct / qs.length) * 10000) / 100; // 0..100, 2dp
    const rec = readiness(score);
    const recommendations = await repo.recommendInternships(TRACK_KEYWORD[track] ?? track);

    const attemptId = await repo.saveAttempt({
      userId, track, score, correctCount: correct, questionCount: qs.length, recommendations, answers: graded,
    });

    return {
      attemptId, track, score, correctCount: correct, questionCount: qs.length,
      readiness: rec.band, message: rec.message, recommendations,
    };
  },

  async myAttempts(userId: number): Promise<unknown[]> {
    return repo.myAttempts(userId);
  },
};
