import { env } from '../../config/env';
import { AppError } from '../../core/appError';
import { ErrorCodes } from '../../core/errorCodes';
import { logger } from '../../core/logger';
import { estimateCostUsd, estimateTokens } from './pricing';

/**
 * Provider-agnostic AI client (R2-S3). No SDKs — plain fetch to provider HTTP
 * APIs. Chat goes to Anthropic Messages (falls back to OpenAI chat); embeddings
 * go to OpenAI. Every call reports token + cost usage so callers can ledger it.
 *
 * Degrades safely: when keys are 'unset' or AI_DRY_RUN=true, returns a clearly
 * labelled canned response / zero-vector instead of throwing, so the platform
 * runs end-to-end without paid keys.
 */

export interface ChatMessage { role: 'user' | 'assistant'; content: string }
export interface ChatResult {
  text: string;
  provider: 'anthropic' | 'openai' | 'dry-run';
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}
export interface EmbedResult {
  vectors: number[][];
  provider: 'openai' | 'dry-run';
  model: string;
  inputTokens: number;
  costUsd: number;
}

const anthropicReady = (): boolean => env.ANTHROPIC_API_KEY !== 'unset';
const openaiReady = (): boolean => env.OPENAI_API_KEY !== 'unset';

export const aiConfigured = { chat: (): boolean => anthropicReady() || openaiReady(), embed: openaiReady };

async function anthropicChat(system: string, messages: ChatMessage[], maxTokens: number): Promise<ChatResult> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: env.AI_CHAT_MODEL,
      max_tokens: maxTokens,
      system,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const body = (await res.json()) as {
    content: { type: string; text?: string }[];
    usage?: { input_tokens: number; output_tokens: number };
  };
  const text = body.content.filter((c) => c.type === 'text').map((c) => c.text ?? '').join('').trim();
  const inT = body.usage?.input_tokens ?? estimateTokens(system + JSON.stringify(messages));
  const outT = body.usage?.output_tokens ?? estimateTokens(text);
  return { text, provider: 'anthropic', model: env.AI_CHAT_MODEL, inputTokens: inT, outputTokens: outT, costUsd: estimateCostUsd(env.AI_CHAT_MODEL, inT, outT) };
}

async function openaiChat(system: string, messages: ChatMessage[], maxTokens: number): Promise<ChatResult> {
  const model = env.AI_CHAT_MODEL_FALLBACK;
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { authorization: `Bearer ${env.OPENAI_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [{ role: 'system', content: system }, ...messages],
    }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const body = (await res.json()) as {
    choices: { message: { content: string } }[];
    usage?: { prompt_tokens: number; completion_tokens: number };
  };
  const text = (body.choices[0]?.message?.content ?? '').trim();
  const inT = body.usage?.prompt_tokens ?? estimateTokens(system + JSON.stringify(messages));
  const outT = body.usage?.completion_tokens ?? estimateTokens(text);
  return { text, provider: 'openai', model, inputTokens: inT, outputTokens: outT, costUsd: estimateCostUsd(model, inT, outT) };
}

export const aiClient = {
  /** Single-turn (or multi-turn) chat with a system prompt. */
  async chat(system: string, messages: ChatMessage[], opts?: { maxTokens?: number }): Promise<ChatResult> {
    const maxTokens = opts?.maxTokens ?? env.AI_MAX_OUTPUT_TOKENS;
    if (env.AI_DRY_RUN || !aiConfigured.chat()) {
      const text = '[AI is not enabled in this environment, so this is a placeholder answer.] '
        + 'Based on the provided lesson context, focus on the key concepts highlighted above.';
      return { text, provider: 'dry-run', model: 'dry-run', inputTokens: 0, outputTokens: 0, costUsd: 0 };
    }
    try {
      if (anthropicReady()) return await anthropicChat(system, messages, maxTokens);
      return await openaiChat(system, messages, maxTokens);
    } catch (err) {
      logger.error({ err }, 'AI chat primary failed');
      if (anthropicReady() && openaiReady()) {
        try { return await openaiChat(system, messages, maxTokens); }
        catch (e2) { logger.error({ err: e2 }, 'AI chat fallback failed'); }
      }
      throw new AppError(ErrorCodes.AI_DISABLED, 'The AI service is temporarily unavailable. Please try again.');
    }
  },

  /** Embed one or more texts. Dry-run returns deterministic pseudo-vectors. */
  async embed(texts: string[]): Promise<EmbedResult> {
    if (env.AI_DRY_RUN || !openaiReady()) {
      return { vectors: texts.map((t) => pseudoVector(t, env.AI_EMBED_DIM)), provider: 'dry-run', model: 'dry-run', inputTokens: 0, costUsd: 0 };
    }
    const res = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: { authorization: `Bearer ${env.OPENAI_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: env.AI_EMBED_MODEL, input: texts }),
    });
    if (!res.ok) throw new AppError(ErrorCodes.AI_DISABLED, `Embedding failed (${res.status})`);
    const body = (await res.json()) as { data: { embedding: number[] }[]; usage?: { prompt_tokens: number } };
    const inT = body.usage?.prompt_tokens ?? texts.reduce((s, t) => s + estimateTokens(t), 0);
    return {
      vectors: body.data.map((d) => d.embedding),
      provider: 'openai', model: env.AI_EMBED_MODEL,
      inputTokens: inT, costUsd: estimateCostUsd(env.AI_EMBED_MODEL, inT, 0),
    };
  },
};

/** Deterministic unit-ish pseudo-vector for dry-run (stable per text). */
function pseudoVector(text: string, dim: number): number[] {
  let seed = 0;
  for (let i = 0; i < text.length; i++) seed = (seed * 31 + text.charCodeAt(i)) >>> 0;
  const out = new Array<number>(dim);
  for (let i = 0; i < dim; i++) {
    seed = (seed * 1103515245 + 12345) >>> 0;
    out[i] = (seed / 0xffffffff) * 2 - 1;
  }
  const norm = Math.sqrt(out.reduce((s, n) => s + n * n, 0)) || 1;
  return out.map((n) => n / norm);
}

export { pseudoVector };
