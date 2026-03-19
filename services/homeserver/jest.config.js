/** @type {import('jest').Config} */
const config = {
  preset: "ts-jest",
  testEnvironment: "node",
  rootDir: ".",
  testTimeout: 15000,

  transform: {
    "^.+\\.tsx?$": ["ts-jest", {
      tsconfig: "tsconfig.json",
      diagnostics: { warnOnly: false },
    }],
  },

  moduleNameMapper: {
    "^@frame/shared/(.*)$": "<rootDir>/../../shared/dist/$1",
    "^@frame/shared$": "<rootDir>/../../shared/dist/index",
  },

  testMatch: [
    "<rootDir>/tests/**/*.test.ts",
    "<rootDir>/tests/**/*.spec.ts",
  ],

  testPathIgnorePatterns: [
    "/node_modules/",
    "/dist/",
    // Integration & security tests require real Postgres + Redis (CI service containers)
    "/tests/integration/",
    "/tests/security/",
  ],

  setupFiles: ["<rootDir>/tests/jest.setup.ts"],

  collectCoverage: true,
  coverageDirectory: "coverage",
  coverageReporters: ["text", "lcov", "html", "json-summary"],

  collectCoverageFrom: [
    "src/**/*.ts",
    "!src/**/__tests__/**",
    "!src/**/*.test.ts",
    "!src/**/*.spec.ts",
    "!src/server.ts",
  ],

  // Global coverage thresholds (relaxed for iterative development)
  coverageThreshold: {
    global: {
      branches: 15,
      functions: 20,
      lines: 30,
      statements: 30,
    },
  },

  clearMocks: true,
  resetMocks: true,
  restoreMocks: true,
  verbose: process.env.CI === "true",
};

module.exports = config;
