/** @type {import('jest').Config} */
const config = {
  preset: "ts-jest",
  testEnvironment: "jsdom",
  rootDir: ".",
  testTimeout: 10000,

  transform: {
    "^.+\\.tsx?$": ["ts-jest", {
      tsconfig: "tsconfig.json",
      diagnostics: { warnOnly: false },
    }],
  },

  moduleNameMapper: {
    "^@frame/shared/(.*)$": "<rootDir>/../../shared/types/$1",
    "^@frame/shared$": "<rootDir>/../../shared/types/index",
    "\\.(css|less|scss|png|jpg|svg)$": "<rootDir>/src/__tests__/mocks/fileMock.ts",
  },

  testMatch: [
    "<rootDir>/src/__tests__/**/*.test.ts",
    "<rootDir>/src/__tests__/**/*.test.tsx",
  ],

  setupFiles: [
    "<rootDir>/src/__tests__/setup/frontend.setup.ts",
  ],

  collectCoverage: true,
  coverageDirectory: "coverage",
  coverageReporters: ["text", "lcov", "html"],

  collectCoverageFrom: [
    "src/**/*.ts",
    "src/**/*.tsx",
    "!src/**/__tests__/**",
    "!src/**/*.test.*",
    "!src/index.tsx",
    "!src/service-worker.ts",
  ],

  coverageThreshold: {
    global: {
      branches: 65,
      functions: 70,
      lines: 70,
      statements: 70,
    },
    // Crypto module — higher bar
    "./src/crypto/cryptoUtils.ts": {
      branches: 80,
      functions: 85,
      lines: 85,
      statements: 85,
    },
    "./src/storage/secureStorage.ts": {
      branches: 80,
      functions: 85,
      lines: 85,
      statements: 85,
    },
  },

  clearMocks: true,
  resetMocks: true,
  restoreMocks: true,
  verbose: process.env.CI === "true",
};

module.exports = config;
