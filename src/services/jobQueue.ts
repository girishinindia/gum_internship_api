import { logger } from '../core/logger';

/**
 * Minimal in-process serial job queue (module 2.4).
 * Deliberately the same surface as a real queue (enqueue + named jobs) so the
 * swap to BullMQ/pg-boss later is a one-file change: implement JobQueueLike,
 * replace the export. Jobs must be idempotent — they may re-run after a swap.
 */
export interface JobQueueLike {
  enqueue(name: string, run: () => Promise<void>): void;
  /** Resolves when everything enqueued so far has settled (used by tests). */
  drain(): Promise<void>;
}

class InProcessQueue implements JobQueueLike {
  private chain: Promise<void> = Promise.resolve();

  enqueue(name: string, run: () => Promise<void>): void {
    this.chain = this.chain
      .then(async () => {
        const start = Date.now();
        await run();
        logger.info({ job: name, ms: Date.now() - start }, 'job done');
      })
      .catch((err) => {
        // Never break the chain: log and move on (retries arrive with a real queue).
        logger.error({ err, job: name }, 'job failed');
      });
  }

  drain(): Promise<void> {
    return this.chain;
  }
}

export const jobQueue: JobQueueLike = new InProcessQueue();
