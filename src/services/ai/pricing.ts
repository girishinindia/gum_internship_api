/**
 * Approximate provider pricing (USD per 1M tokens) used ONLY for the per-user
 * cost cap and usage ledger — not for billing. Conservative/rounded; update as
 * provider prices change. Unknown models fall back to a safe high estimate so
 * the cap never under-counts.
 */
interface Price { input: number; output: number }

const PER_MILLION: Record<string, Price> = {
  // Anthropic
  'claude-3-5-haiku-20241022': { input: 0.8, output: 4 },
  'claude-3-5-sonnet-20241022': { input: 3, output: 15 },
  // OpenAI chat
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-4o': { input: 2.5, output: 10 },
  // OpenAI embeddings (output side unused)
  'text-embedding-3-small': { input: 0.02, output: 0 },
  'text-embedding-3-large': { input: 0.13, output: 0 },
};

const FALLBACK: Price = { input: 5, output: 20 };

export function estimateCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const p = PER_MILLION[model] ?? FALLBACK;
  const cost = (inputTokens / 1_000_000) * p.input + (outputTokens / 1_000_000) * p.output;
  return Math.round(cost * 1_000_000) / 1_000_000; // 6dp, matches numeric(10,6)
}

/** Cheap, dependency-free token estimate (~4 chars/token) for pre-flight caps. */
export function estimateTokens(text: string): number {
  return Math.ceil((text?.length ?? 0) / 4);
}
