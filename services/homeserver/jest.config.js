/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  moduleNameMapper: {
    '^@frame/shared/(.*)$': '<rootDir>/../../shared/dist/$1',
    '^@frame/shared$': '<rootDir>/../../shared/dist/index',
  },
  setupFiles: ['<rootDir>/tests/jest.setup.ts'],
  clearMocks: true,
  collectCoverageFrom: ['src/**/*.ts', '!src/server.ts'],
};
