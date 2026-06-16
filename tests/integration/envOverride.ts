// Integration tests hit a REAL database: DATABASE_URL_TEST overrides the dummy
// from setupEnv.ts. Everything else stays dry-run (payments/storage/notify).
if (!process.env.DATABASE_URL_TEST) {
  throw new Error('Set DATABASE_URL_TEST (a disposable Postgres database) to run integration tests');
}
process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
