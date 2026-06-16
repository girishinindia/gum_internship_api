/** Integration suite: REAL Postgres (DATABASE_URL_TEST), serial, slower. */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests/integration'],
  testMatch: ['**/*.int.test.ts'],
  globalSetup: '<rootDir>/tests/integration/globalSetup.cjs',
  setupFiles: ['<rootDir>/tests/setupEnv.ts', '<rootDir>/tests/integration/envOverride.ts'],
  testTimeout: 30000,
  maxWorkers: 1,
};
