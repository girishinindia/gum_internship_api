import { env } from '../config/env';
import { logger } from '../core/logger';

/**
 * Optional Redis for distributed rate-limiting and caching. Activates only when
 * REDIS_URL is set AND `ioredis` (+ `rate-limit-redis` for limiting) is installed
 * — otherwise everything falls back to in-process memory, so dev/test and any
 * single-node deploy are unaffected. To enable across multiple API replicas:
 *   npm i ioredis rate-limit-redis   and set REDIS_URL.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let client: any = null;
let attempted = false;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getRedis(): any {
  if (attempted) return client;
  attempted = true;
  if (!env.REDIS_URL) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-explicit-any
    const Redis = require('ioredis') as any;
    client = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 2 });
    client.on('error', (err: unknown) => logger.error({ err }, 'redis error'));
    logger.info('Redis connected (rate-limit + cache)');
  } catch {
    logger.warn('REDIS_URL is set but ioredis is not installed — run `npm i ioredis rate-limit-redis`');
  }
  return client;
}

/** A `rate-limit-redis` store when Redis is available, else undefined (memory). */
export function rateLimitStore(): unknown {
  const redis = getRedis();
  if (!redis) return undefined;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-explicit-any
    const RedisStore = require('rate-limit-redis').default as any;
    return new RedisStore({ sendCommand: (...args: string[]) => redis.call(...args) });
  } catch {
    logger.warn('REDIS_URL is set but rate-limit-redis is not installed — using in-memory limits');
    return undefined;
  }
}

/* --- Small cache helper (Redis if present, else in-process Map with TTL) --- */
const mem = new Map<string, { v: string; exp: number }>();

export async function cacheGet(key: string): Promise<string | null> {
  const redis = getRedis();
  if (redis) return redis.get(key);
  const e = mem.get(key);
  if (e && e.exp > Date.now()) return e.v;
  mem.delete(key);
  return null;
}

export async function cacheSet(key: string, value: string, ttlSeconds: number): Promise<void> {
  const redis = getRedis();
  if (redis) { await redis.set(key, value, 'EX', ttlSeconds); return; }
  mem.set(key, { v: value, exp: Date.now() + ttlSeconds * 1000 });
}
