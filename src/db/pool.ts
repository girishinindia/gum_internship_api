import { Pool, types } from 'pg';
import type { PoolClient, QueryResultRow } from 'pg';
import { env } from '../config/env';
import { logger } from '../core/logger';

// numeric (money) and int8 (bigint ids) arrive as strings by default.
// ids fit safely in JS numbers (identity bigint, far below 2^53) → parse.
// numeric stays string to avoid float money bugs; services convert explicitly.
types.setTypeParser(types.builtins.INT8, (v) => Number(v));

// Remote managed Postgres (Supabase pooler) terminates TLS with a chain Node
// doesn't bundle, so verify-full fails ("self-signed certificate in chain").
// A `sslmode=` in the connection string forces verify-full and overrides the
// `ssl` option, so for the hosted pooler we STRIP sslmode from the URL (the
// .env stays untouched) and pass TLS config explicitly with relaxed chain
// verification. Local/socket connections (tests, embedded PG) use no SSL.
// For stricter prod, supply the Supabase CA via ssl.ca instead.
const isRemote = /supabase\.(co|com)|pooler\./.test(env.DATABASE_URL) && !env.DATABASE_URL.includes('host=/');
const connectionString = isRemote
  ? env.DATABASE_URL.replace(/([?&])sslmode=[^&]*(&|$)/, (_m, p1: string, p2: string) => (p1 === '?' && p2 === '' ? '' : p1 === '?' ? '?' : p2))
  : env.DATABASE_URL;
export const pool = new Pool({
  connectionString,
  max: 10,
  ...(isRemote ? { ssl: { rejectUnauthorized: false } } : {}),
});

// All app objects live in the configured schema (intern). Pin search_path on
// every pooled connection so unqualified table names resolve there, with
// extensions (citext, pg_trgm) and public reachable for operator classes.
pool.on('connect', (client) => {
  client.query(`set search_path = ${env.DB_SCHEMA}, extensions, public`).catch((err) => {
    logger.error({ err }, 'failed to set search_path on new connection');
  });
});

pool.on('error', (err) => {
  logger.error({ err }, 'Unexpected idle Postgres client error');
});

/** Raw parameterized query helper — repositories use ONLY this (or tx below). */
export async function query<T extends QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const start = Date.now();
  const result = await pool.query<T>(text, params);
  logger.debug({ ms: Date.now() - start, rows: result.rowCount }, text.split('\n')[0]);
  return result.rows;
}

/** Single-row convenience: returns the row or null. */
export async function queryOne<T extends QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

/** Transaction helper: await tx(async (c) => { ... }) — commits, or rolls back on throw. */
export async function tx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  await pool.end();
}
