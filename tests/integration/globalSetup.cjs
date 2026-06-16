/* Rebuilds the disposable test database from supabase/migrations before the
 * suite: drop schema public → migrations 0001..0007 → Supabase-like roles.
 * Plain CJS so jest can run it without ts-node. */
const { readFileSync, readdirSync } = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');

module.exports = async function globalSetup() {
  const url = process.env.DATABASE_URL_TEST;
  if (!url) throw new Error('DATABASE_URL_TEST is required');

  // Ensure the database exists (connect to the maintenance db first).
  const u = new URL(url);
  const dbName = u.pathname.slice(1);
  const admin = new Client({ connectionString: (() => { const a = new URL(url); a.pathname = '/postgres'; return a.toString(); })() });
  await admin.connect();
  const exists = await admin.query('select 1 from pg_database where datname = $1', [dbName]);
  if (exists.rowCount === 0) await admin.query(`create database "${dbName}"`);
  for (const role of ['anon nologin', 'authenticated nologin', 'service_role nologin bypassrls']) {
    await admin.query(`create role ${role}`).catch(() => undefined);
  }
  await admin.end();

  const db = new Client({ connectionString: url });
  await db.connect();
  await db.query('drop schema public cascade; create schema public;');
  const dir = path.join(__dirname, '..', '..', 'supabase', 'migrations');
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
    await db.query(readFileSync(path.join(dir, f), 'utf8'));
    // eslint-disable-next-line no-console
    console.log(`  migrated ${f}`);
  }
  await db.end();
};
