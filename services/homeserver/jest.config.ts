import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  moduleNameMapper: {
    '^@frame/shared/(.*)$': '<rootDir>/../../shared/types/$1',
    '^@frame/shared$': '<rootDir>/../../shared/types/index',
  },
  setupFilesAfterSetup: [],
  clearMocks: true,
  collectCoverageFrom: ['src/**/*.ts', '!src/server.ts'],
};

export default config;
