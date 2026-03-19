/** @type {import('jest').Config} */
const config = {
  preset: "ts-jest",
  testEnvironment: "node",
  rootDir: ".",
  testTimeout: 30000,

  transform: {
    "^.+\\.tsx?$": ["ts-jest", {
      tsconfig: "tsconfig.json",
      diagnostics: { warnOnly: true },
    }],
  },

  moduleNameMapper: {
    "^@frame/shared/(.*)$": "<rootDir>/../../shared/dist/$1",
    "^@frame/shared$": "<rootDir>/../../shared/dist/index",
  },

  testMatch: [
    "<rootDir>/tests/security/**/*.test.ts",
  ],

  testPathIgnorePatterns: [
    "/node_modules/",
    "/dist/",
    // The original attack-simulations test requires a real database
    "attack-simulations",
  ],

  setupFiles: [
    "<rootDir>/tests/security/jest.security-setup.ts",
    "<rootDir>/tests/jest.setup.ts",
  ],

  // No coverage thresholds for security tests — they test behaviour, not coverage
  collectCoverage: false,

  clearMocks: false,   // Security tests manage their own mock lifecycle
  resetMocks: false,
  restoreMocks: false,
  verbose: true,
};

module.exports = config;
