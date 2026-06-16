import { query, tx } from '../db/pool';
import { env } from '../config/env';
import { logger } from '../core/logger';

/**
 * Durable, Postgres-backed job queue (opt-in via JOB_QUEUE_DRIVER=pg).
 *
 * Why: the default in-process queue loses any in-flight work on restart — a real
 * risk for money/cert side-effects (offer letters, invoices, emails). This queue
 * persists jobs in a table, claims them with `FOR UPDATE SKIP LOCKED` (safe with
 * many workers), retries with exponential backoff, and dead-letters after
 * `max_attempts`. Handlers are registered by name; payloads are JSON.
 *
 * Jobs MUST be idempotent (they can re-run after a crash/retry) — the existing
 * pipelines already guard on their output (e.g. "offer letter already issued").
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type JobHandler = (payload: any) => Promise<void>;
const handlers = new Map<string, JobHandler>();

let timer: NodeJS.Timeout | null = null;
let ticking = false;
let stopped = false;
let schemaReady = false;

export function registerJob(name: string, handler: JobHandler): void {
  handlers.set(name, handler);
}

export async function ensureSchema(): Promise<void> {
  if (schemaReady) return;
  await query(`
    create table if not exists job_queue (
      id            bigint generated always as identity primary key,
      name          text not null,
      payload       jsonb not null default '{}'::jsonb,
      status        text not null default 'pending',
      attempts      integer not null default 0,
      max_attempts  integer not null default 5,
      run_at        timestamptz not null default now(),
      last_error    text,
      created_at    timestamptz not null default now(),
      updated_at    timestamptz not null default now()
    )`);
  await query(`create index if not exists idx_job_queue_due on job_queue (run_at) where status = 'pending'`);
  schemaReady = true;
}

/** Enqueue a job for a registered handler. Safe to call from request handlers. */
export async function publishJob(
  name: string,
  payload: Record<string, unknown> = {},
  opts?: { maxAttempts?: number; runAt?: Date },
): Promise<void> {
  await ensureSchema();
  await query(
    `insert into job_queue (name, payload, max_attempts, run_at)
     values ($1, $2::jsonb, $3, coalesce($4, now()))`,
    [name, JSON.stringify(payload), opts?.maxAttempts ?? env.JOB_QUEUE_MAX_ATTEMPTS, opts?.runAt ?? null],
  );
}

/** Reclaim jobs stuck in 'active' (worker crashed mid-job) back to 'pending'. */
async function reclaimStale(): Promise<void> {
  await query(`update job_queue set status='pending', updated_at=now()
               where status='active' and updated_at < now() - interval '5 minutes'`);
}

/** Claim and run up to `batch` due jobs. Returns how many were processed. */
export async function processBatch(batch = 10): Promise<number> {
  let processed = 0;
  for (let i = 0; i < batch; i += 1) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const job = await tx(async (client): Promise<any> => {
      const r = await client.query(
        `update job_queue set status='active', attempts = attempts + 1, updated_at = now()
         where id = (
           select id from job_queue
           where status='pending' and run_at <= now()
           order by run_at
           for update skip locked
           limit 1
         )
         returning *`,
      );
      return r.rows[0] ?? null;
    });
    if (!job) break;

    const handler = handlers.get(job.name);
    try {
      if (!handler) throw new Error(`No handler registered for job "${job.name}"`);
      await handler(job.payload);
      await query(`update job_queue set status='completed', updated_at=now() where id=$1`, [job.id]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (job.attempts >= job.max_attempts) {
        await query(`update job_queue set status='failed', last_error=$2, updated_at=now() where id=$1`, [job.id, msg]);
        logger.error({ job: job.name, id: job.id, attempts: job.attempts, err: msg }, 'job dead-lettered');
      } else {
        const backoffSec = Math.min(2 ** job.attempts * 5, 600); // 10s, 20s, 40s … capped at 10m
        await query(
          `update job_queue set status='pending', run_at = now() + ($2 || ' seconds')::interval,
             last_error=$3, updated_at=now() where id=$1`,
          [job.id, String(backoffSec), msg],
        );
        logger.warn({ job: job.name, id: job.id, attempt: job.attempts, retryInSec: backoffSec, err: msg }, 'job failed — will retry');
      }
    }
    processed += 1;
  }
  return processed;
}

export function startWorker(): void {
  if (timer) return;
  stopped = false;
  const tick = async (): Promise<void> => {
    if (ticking || stopped) return;
    ticking = true;
    try {
      await ensureSchema();
      await reclaimStale();
      // Drain everything currently due, then wait for the next poll.
      while (!stopped && (await processBatch(10)) > 0) { /* keep draining */ }
    } catch (err) {
      logger.error({ err }, 'durable job worker tick failed');
    } finally {
      ticking = false;
    }
  };
  timer = setInterval(() => void tick(), env.JOB_QUEUE_POLL_MS);
  timer.unref();
  logger.info({ pollMs: env.JOB_QUEUE_POLL_MS }, 'durable job worker started');
}

export async function stopWorker(): Promise<void> {
  stopped = true;
  if (timer) { clearInterval(timer); timer = null; }
}

export function isDurable(): boolean {
  return env.JOB_QUEUE_DRIVER === 'pg';
}
