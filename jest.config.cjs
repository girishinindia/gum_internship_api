/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testPathIgnorePatterns: ['/integration/'],
  setupFiles: ['<rootDir>/tests/setupEnv.ts'],
  clearMocks: true,
};
