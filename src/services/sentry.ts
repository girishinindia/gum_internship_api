import { env } from '../config/env';
import { logger } from '../core/logger';

/**
 * Optional Sentry error tracking. Activates only when SENTRY_DSN is set AND
 * `@sentry/node` is installed — so dev, tests, and any deploy without a DSN are
 * completely unaffected (no dependency, no-op). To turn it on in production:
 *   1) `npm i @sentry/node`  2) set SENTRY_DSN (+ optional SENTRY_ENVIRONMENT,
 *   SENTRY_TRACES_SAMPLE_RATE).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let client: any = null;

export function initSentry(): void {
  if (!env.SENTRY_DSN) return;
  try {
    // Lazy, optional require so the package isn't a hard dependency.
    // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-explicit-any
    const Sentry = require('@sentry/node') as any;
    Sentry.init({
      dsn: env.SENTRY_DSN,
      environment: env.SENTRY_ENVIRONMENT ?? env.NODE_ENV,
      tracesSampleRate: env.SENTRY_TRACES_SAMPLE_RATE,
    });
    client = Sentry;
    logger.info({ environment: env.SENTRY_ENVIRONMENT ?? env.NODE_ENV }, 'Sentry initialised');
  } catch {
    logger.warn('SENTRY_DSN is set but @sentry/node is not installed — run `npm i @sentry/node` to enable error tracking');
  }
}

/** Report an exception to Sentry if active. Always safe to call. */
export function captureException(err: unknown, context?: Record<string, unknown>): void {
  if (!client) return;
  try {
    client.captureException(err, context ? { extra: context } : undefined);
  } catch {
    // Telemetry must never break a request.
  }
}

export function isSentryActive(): boolean {
  return client !== null;
}
