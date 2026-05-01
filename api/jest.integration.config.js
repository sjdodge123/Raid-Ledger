/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.integration\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': [
      'ts-jest',
      {
        tsconfig: {
          module: 'commonjs',
          moduleResolution: 'node16',
          esModuleInterop: true,
          allowSyntheticDefaultImports: true,
          resolvePackageJsonExports: false,
        },
      },
    ],
  },
  moduleNameMapper: {
    '^@raid-ledger/contract$': '<rootDir>/../../packages/contract/src/index.ts',
    '^@raid-ledger/contract/(.*)$': '<rootDir>/../../packages/contract/src/$1',
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  testEnvironment: 'node',
  // Integration tests need more time due to container startup
  testTimeout: 120_000,
  // Run sequentially — tests share a single Testcontainers instance
  maxWorkers: 1,
  // ROK-1058 AC3: file-order randomization is opt-in via the CLI `--randomize`
  // flag (passed by the CI matrix). Local default stays deterministic so
  // bisecting a true cross-suite flake remains tractable. CI's `run: [1,2,3]`
  // matrix runs with `--randomize`, surfacing order-dependent leaks per PR.
  // Runs in the worker process (where the TestApp singleton lives) so
  // afterAll can actually close the app and Testcontainers instance.
  setupFilesAfterEnv: ['<rootDir>/common/testing/integration-setup.ts'],
  // Safety net for open handles (postgres-js connection pool)
  forceExit: true,
};
