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
  // ROK-1232: kept at 1 for the FIRST PR. The teardown hardening landed
  // here (SettingsService cache reset, dedup Redis sweep, cron jobs
  // stopped post-init) closes the three deterministic leak vectors the
  // TDD repros codified, but a residual `socket hang up` flake matching
  // ROK-1091 (embed-sync ECONNRESET) still bites at maxWorkers=2 in
  // ~25% of local runs. The dev brief explicitly defers that cascade
  // ("recommend the dev verify ROK-1091 still reproduces after the new
  // reset hook lands; if so, file a follow-up") — once that lands, this
  // can ratchet up to 2 (and CI sharding stays orthogonal).
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
