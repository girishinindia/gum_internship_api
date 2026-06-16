import { env } from '../../config/env';
import { AppError } from '../../core/appError';
import { ErrorCodes } from '../../core/errorCodes';
import { query, queryOne } from '../../db/pool';

export interface UsageRecord {
  userId: number;
  feature: 'ask' | 'interview' | 'embed' | 'translate';
  provider: 'anthropic' | 'openai' | 'google';
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  threadId?: number | null;
}

/** USD spent by a user in the rolling current calendar day (UTC). */
export async function dailySpendUsd(userId: number): Promise<number> {
  const row = await queryOne<{ total: string }>(
    `select coalesce(sum(cost_usd), 0)::numeric(12,6) as total
     from ai_usage
     where user_id = $1 and created_at >= date_trunc('day', now())`,
    [userId],
  );
  return Number(row?.total ?? 0);
}

/**
 * Pre-flight cap check. Throws AI_CAP_EXCEEDED when the user is already at/over
 * the daily ceiling. Cap of 0 disables the limit. Called before each AI action.
 */
export async function assertUnderDailyCap(userId: number): Promise<void> {
  const cap = env.AI_DAILY_COST_CAP_USD;
  if (cap <= 0) return;
  const spent = await dailySpendUsd(userId);
  if (spent >= cap) {
    throw new AppError(
      ErrorCodes.AI_CAP_EXCEEDED,
      "You've reached today's AI usage limit. Please try again tomorrow.",
    );
  }
}

export async function recordUsage(u: UsageRecord): Promise<void> {
  await query(
    `insert into ai_usage (user_id, feature, provider, model, input_tokens, output_tokens, cost_usd, thread_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [u.userId, u.feature, u.provider, u.model, u.inputTokens, u.outputTokens, u.costUsd, u.threadId ?? null],
  );
}
