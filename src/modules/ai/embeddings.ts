import { createHash } from 'node:crypto';
import { logger } from '../../core/logger';
import { jobQueue } from '../../services/jobQueue';
import { aiClient } from '../../services/ai/client';
import { estimateTokens } from '../../services/ai/pricing';
import { recordUsage } from '../../services/ai/usage';
import { aiRepository as repo } from './repository';
import type { LessonChunk } from './repository';

/**
 * Embedding pipeline (R2-S2): split each lesson's text into ~overlapping
 * chunks, embed only chunks whose content changed (hash compare), store as
 * vectors. Idempotent — safe to re-run; unchanged chunks are skipped.
 */

const TARGET_CHARS = 1200; // ~300 tokens/chunk
const OVERLAP = 150;

export function chunkText(text: string): string[] {
  const clean = text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!clean) return [];
  if (clean.length <= TARGET_CHARS) return [clean];
  const chunks: string[] = [];
  let start = 0;
  while (start < clean.length) {
    let end = Math.min(start + TARGET_CHARS, clean.length);
    // prefer a paragraph/sentence boundary near the end
    if (end < clean.length) {
      const slice = clean.slice(start, end);
      const br = Math.max(slice.lastIndexOf('\n\n'), slice.lastIndexOf('. '));
      if (br > TARGET_CHARS * 0.5) end = start + br + 1;
    }
    chunks.push(clean.slice(start, end).trim());
    if (end >= clean.length) break;
    start = end - OVERLAP;
  }
  return chunks.filter(Boolean);
}

const hash = (s: string): string => createHash('sha256').update(s).digest('hex').slice(0, 32);

/** Re-index one internship's lessons. Returns counts for the caller/admin. */
export async function indexInternship(internshipId: number, actorUserId: number | null): Promise<{ lessons: number; chunks: number; embedded: number; skipped: number }> {
  const lessons = await repo.lessonsForInternship(internshipId);
  const existing = await repo.existingHashes(internshipId);
  let chunks = 0, embedded = 0, skipped = 0;

  for (const lesson of lessons) {
    const text = [lesson.title, lesson.content ?? ''].join('\n\n').trim();
    const parts = chunkText(text);
    await repo.pruneChunks(lesson.id, parts.length); // drop stale tail chunks
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i] as string;
      chunks++;
      const h = hash(part);
      if (existing.get(`${lesson.id}:${i}`) === h) { skipped++; continue; }
      const emb = await aiClient.embed([part]);
      const vector = emb.vectors[0];
      if (!vector) continue;
      const chunk: LessonChunk = {
        lessonId: lesson.id, internshipId, chunkIndex: i,
        content: part, tokenCount: estimateTokens(part), contentHash: h,
      };
      await repo.upsertChunk(chunk, vector);
      if (emb.costUsd > 0 && actorUserId) {
        await recordUsage({ userId: actorUserId, feature: 'embed', provider: 'openai', model: emb.model, inputTokens: emb.inputTokens, outputTokens: 0, costUsd: emb.costUsd });
      }
      embedded++;
    }
  }
  logger.info({ internshipId, lessons: lessons.length, chunks, embedded, skipped }, 'embedding index complete');
  return { lessons: lessons.length, chunks, embedded, skipped };
}

/** Fire-and-forget enqueue (used by admin trigger / content updates). */
export function queueIndexInternship(internshipId: number, actorUserId: number | null): void {
  jobQueue.enqueue(`ai:index:${internshipId}`, async () => {
    await indexInternship(internshipId, actorUserId);
  });
}
