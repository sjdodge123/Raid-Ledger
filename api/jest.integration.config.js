// Run integration tests on a UTC clock, like GitHub CI and the prod container.
// The fleet runners set TZ=America/Denver, which shifted server-local week
// starts (resolveWeekStart) and made date-keyed specs disagree with CI (ROK-1595).
process.env.TZ = 'UTC';

// ROK-2206: worker count; 1 unless RL_INTEGRATION_WORKERS is an integer >= 2
// (mirrors integration-worker-dbs.ts::requestedWorkers).
const REQUESTED_WORKERS = Number(process.env.RL_INTEGRATION_WORKERS ?? '1');
const PER_WORKER_COUNT =
  Number.isInteger(REQUESTED_WORKERS) && REQUESTED_WORKERS > 1
    ? REQUESTED_WORKERS
    : 1;

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
          rootDir: '.',
          module: 'commonjs',
          moduleResolution: 'node16',
          esModuleInterop: true,
          allowSyntheticDefaultImports: true,
          resolvePackageJsonExports: false,
          ignoreDeprecations: '6.0',
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
  // ROK-1232 kept this at 1: one in-band jest process, one shared DB.
  // ROK-2206 (opt-in, off by default): RL_INTEGRATION_WORKERS=<n> (n >= 2)
  // runs n workers, each on its own DB cloned from a freshly migrated
  // `<base>_tpl` (common/testing/integration-worker-dbs.ts). Run it through
  // `npm run test:integration:workers` (no --runInBand; per-worker heap
  // from RL_INTEGRATION_HEAP_MB, default 2048). Flag on also sets
  // workerIdleMemoryLimit (RL_INTEGRATION_IDLE_MEMORY, default 1536MB) so a
  // worker whose heap grows past it is recycled between files (the
  // ROK-1250/1268 per-NestApp heap growth). Flag off sets neither: setting
  // workerIdleMemoryLimit at all disables jest's in-band shortcut.
  // Rollback: unset the var (CI: repo variable RL_INTEGRATION_WORKERS=1).
  maxWorkers: PER_WORKER_COUNT,
  ...(PER_WORKER_COUNT > 1
    ? {
        workerIdleMemoryLimit:
          process.env.RL_INTEGRATION_IDLE_MEMORY || '1536MB',
      }
    : {}),
  // ROK-1058 AC3: file-order randomization is opt-in via the CLI `--randomize`
  // flag (passed by the CI matrix). Local default stays deterministic so
  // bisecting a true cross-suite flake remains tractable. CI's `run: [1,2,3]`
  // matrix runs with `--randomize`, surfacing order-dependent leaks per PR.
  // Runs in the worker process (where the TestApp singleton lives) so
  // afterAll can actually close the app and Testcontainers instance.
  setupFilesAfterEnv: ['<rootDir>/common/testing/integration-setup.ts'],
  // ROK-1527: off-CI, start ONE Postgres Testcontainer per jest process in the
  // OUTER realm (a per-file container pinned every file's sandbox realm) and
  // stop it after the run. No-op on CI, which brings its own DATABASE_URL.
  globalSetup: '<rootDir>/common/testing/integration-global-setup.ts',
  globalTeardown: '<rootDir>/common/testing/integration-global-teardown.ts',
  // Safety net for open handles (postgres-js connection pool)
  forceExit: true,
  // ROK-1331 M11 — emit per-suite + per-shard perf events alongside jest's
  // default reporter. JEST_SHARD_ID + JEST_TOTAL_SHARDS env vars are set
  // by validate-ci's shard loop on the fleet runner; on a local run the
  // reporter still emits with shard_id=null (degraded AC2 still works).
  // Writes to /workspace/.rl-perf.log inside the runner or .rl-perf.log
  // in the worktree root locally.
  reporters: ['default', '<rootDir>/../jest.perf-reporter.js'],
};
