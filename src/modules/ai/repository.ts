import { query, queryOne } from '../../db/pool';

/** pgvector literal: JS number[] -> '[0.1,0.2,...]' for ::vector casts. */
export function toVectorLiteral(v: number[]): string {
  return `[${v.join(',')}]`;
}

export interface LessonChunk {
  lessonId: number;
  internshipId: number;
  chunkIndex: number;
  content: string;
  tokenCount: number;
  contentHash: string;
}

export interface RetrievedChunk {
  lesson_id: number;
  lesson_title: string;
  chunk_index: number;
  content: string;
  distance: number;
}

export const aiRepository = {
  // ---- Embeddings (RAG corpus) --------------------------------------------
  async existingHashes(internshipId: number): Promise<Map<string, string>> {
    const rows = await query<{ lesson_id: number; chunk_index: number; content_hash: string }>(
      `select lesson_id, chunk_index, content_hash from lesson_embeddings where internship_id = $1`,
      [internshipId],
    );
    const m = new Map<string, string>();
    for (const r of rows) m.set(`${r.lesson_id}:${r.chunk_index}`, r.content_hash);
    return m;
  },

  async upsertChunk(chunk: LessonChunk, embedding: number[]): Promise<void> {
    await query(
      `insert into lesson_embeddings
         (lesson_id, internship_id, chunk_index, content, token_count, embedding, content_hash)
       values ($1, $2, $3, $4, $5, $6::vector, $7)
       on conflict (lesson_id, chunk_index) do update set
         content = excluded.content, token_count = excluded.token_count,
         embedding = excluded.embedding, content_hash = excluded.content_hash,
         internship_id = excluded.internship_id`,
      [chunk.lessonId, chunk.internshipId, chunk.chunkIndex, chunk.content, chunk.tokenCount, toVectorLiteral(embedding), chunk.contentHash],
    );
  },

  /** Delete chunks for a lesson whose index is no longer present (content shrank). */
  async pruneChunks(lessonId: number, keepUpToIndex: number): Promise<void> {
    await query(`delete from lesson_embeddings where lesson_id = $1 and chunk_index >= $2`, [lessonId, keepUpToIndex]);
  },

  async lessonsForInternship(internshipId: number): Promise<{ id: number; title: string; content: string | null }[]> {
    return query<{ id: number; title: string; content: string | null }>(
      `select l.id, l.title, l.content
       from lessons l join curriculum_sections cs on cs.id = l.section_id
       where cs.internship_id = $1
       order by cs.display_order, l.display_order`,
      [internshipId],
    );
  },

  async countEmbeddings(internshipId: number): Promise<number> {
    const r = await queryOne<{ n: number }>(`select count(*)::int8 as n from lesson_embeddings where internship_id = $1`, [internshipId]);
    return Number(r?.n ?? 0);
  },

  /** Cosine-distance ANN retrieval, scoped to one internship. */
  async retrieve(internshipId: number, queryEmbedding: number[], k: number): Promise<RetrievedChunk[]> {
    return query<RetrievedChunk>(
      `select le.lesson_id, l.title as lesson_title, le.chunk_index, le.content,
              (le.embedding <=> $2::vector) as distance
       from lesson_embeddings le join lessons l on l.id = le.lesson_id
       where le.internship_id = $1
       order by le.embedding <=> $2::vector
       limit $3`,
      [internshipId, toVectorLiteral(queryEmbedding), k],
    );
  },

  // ---- Enrollment guard ----------------------------------------------------
  async isEnrolled(userId: number, internshipId: number): Promise<boolean> {
    const r = await queryOne<{ ok: boolean }>(
      `select exists(
         select 1 from enrollments where user_id = $1 and internship_id = $2
         and status in ('active','completed')) as ok`,
      [userId, internshipId],
    );
    return r?.ok ?? false;
  },

  // ---- Threads + messages --------------------------------------------------
  async createThread(userId: number, kind: 'study_buddy' | 'mock_interview', internshipId: number | null, title: string | null): Promise<number> {
    const r = await queryOne<{ id: number }>(
      `insert into ai_threads (user_id, kind, internship_id, title) values ($1, $2::ai_thread_kind, $3, $4) returning id`,
      [userId, kind, internshipId, title],
    );
    return Number(r?.id);
  },

  async threadOwnedBy(threadId: number, userId: number): Promise<{ id: number; kind: string; internship_id: number | null; metadata: Record<string, unknown> } | null> {
    return queryOne(`select id, kind, internship_id, metadata from ai_threads where id = $1 and user_id = $2`, [threadId, userId]);
  },

  async addMessage(threadId: number, role: 'user' | 'assistant' | 'system', content: string, citations: unknown[] = []): Promise<number> {
    const r = await queryOne<{ id: number }>(
      `insert into ai_messages (thread_id, role, content, citations) values ($1, $2::ai_message_role, $3, $4::jsonb) returning id`,
      [threadId, role, content, JSON.stringify(citations)],
    );
    await query(`update ai_threads set updated_at = now() where id = $1`, [threadId]);
    return Number(r?.id);
  },

  async recentMessages(threadId: number, limit: number): Promise<{ role: 'user' | 'assistant'; content: string }[]> {
    const rows = await query<{ role: 'user' | 'assistant' | 'system'; content: string }>(
      `select role, content from ai_messages where thread_id = $1 and role <> 'system'
       order by created_at desc limit $2`,
      [threadId, limit],
    );
    return rows.reverse().map((r) => ({ role: r.role === 'assistant' ? 'assistant' : 'user', content: r.content }));
  },

  async listThreads(userId: number, kind: 'study_buddy' | 'mock_interview'): Promise<unknown[]> {
    return query(
      `select t.id, t.title, t.internship_id as "internshipId", t.created_at as "createdAt",
              (select content from ai_messages m where m.thread_id = t.id order by created_at desc limit 1) as "lastMessage"
       from ai_threads t where t.user_id = $1 and t.kind = $2::ai_thread_kind
       order by t.updated_at desc limit 50`,
      [userId, kind],
    );
  },

  async threadMessages(threadId: number): Promise<unknown[]> {
    return query(
      `select role, content, citations, created_at as "createdAt" from ai_messages where thread_id = $1 order by created_at`,
      [threadId],
    );
  },

  // ---- Interview attempts --------------------------------------------------
  async createInterview(userId: number, threadId: number, track: string, internshipId: number | null): Promise<number> {
    const r = await queryOne<{ id: number }>(
      `insert into ai_interview_attempts (user_id, thread_id, track, internship_id) values ($1, $2, $3, $4) returning id`,
      [userId, threadId, track, internshipId],
    );
    return Number(r?.id);
  },

  async interviewOwnedBy(attemptId: number, userId: number): Promise<{ id: number; thread_id: number; track: string; status: string; question_count: number } | null> {
    return queryOne(`select id, thread_id, track, status, question_count from ai_interview_attempts where id = $1 and user_id = $2`, [attemptId, userId]);
  },

  async bumpInterviewCount(attemptId: number): Promise<void> {
    await query(`update ai_interview_attempts set question_count = question_count + 1 where id = $1`, [attemptId]);
  },

  async scoreInterview(attemptId: number, score: number, feedback: unknown): Promise<void> {
    await query(
      `update ai_interview_attempts set status = 'scored', overall_score = $2, feedback = $3::jsonb where id = $1`,
      [attemptId, score, JSON.stringify(feedback)],
    );
  },

  // ---- Translations --------------------------------------------------------
  async getTranslation(lessonId: number, language: string): Promise<{ title: string; content: string; source_hash: string; status: string } | null> {
    return queryOne(`select title, content, source_hash, status from lesson_translations where lesson_id = $1 and language = $2`, [lessonId, language]);
  },

  async upsertTranslation(lessonId: number, language: string, title: string, content: string, sourceHash: string): Promise<void> {
    await query(
      `insert into lesson_translations (lesson_id, language, title, content, source_hash)
       values ($1, $2, $3, $4, $5)
       on conflict (lesson_id, language) do update set
         title = excluded.title, content = excluded.content,
         source_hash = excluded.source_hash, status = 'machine'`,
      [lessonId, language, title, content, sourceHash],
    );
  },

  async lessonForTranslation(lessonId: number): Promise<{ id: number; title: string; content: string | null; internship_id: number; languages: string[] } | null> {
    return queryOne(
      `select l.id, l.title, l.content, cs.internship_id, i.languages
       from lessons l join curriculum_sections cs on cs.id = l.section_id
       join internships i on i.id = cs.internship_id
       where l.id = $1`,
      [lessonId],
    );
  },
};
