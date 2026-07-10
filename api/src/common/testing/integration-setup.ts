/**
 * Integration test setup — loaded via setupFilesAfterEnv in jest.integration.config.js.
 *
 * Registers a global afterAll hook to close the TestApp singleton.
 * This runs in the worker process (where the singleton lives), unlike
 * globalTeardown which runs in the parent process and cannot access it.
 */

// Set env vars before any imports to disable rate-limiting in integration tests.
// Must be before the test-app import to take effect before modules are evaluated.
process.env.THROTTLE_DISABLED = 'true';
process.env.THROTTLE_DEFAULT_LIMIT = '999999';
// ROK-1232: stop every `@Cron`/plugin-host cron handler from firing inside
// the test window. `SchedulerRegistry` is still wired (plugins inject it),
// so individual jobs are stopped after `app.init()` in `getTestApp` rather
// than skipping `ScheduleModule.forRoot()` outright. Same shape as
// THROTTLE_DISABLED — explicit, not piggy-backed on NODE_ENV.
process.env.CRON_DISABLED = 'true';

import { closeTestApp, getTestApp } from './test-app';
import { truncateAllTables } from './integration-helpers';
import { dumpFailureSnapshot } from './dump-failure-snapshot';
import { listSocketHandles } from './socket-handle-audit';

// ROK-1250: empirical margin above the steady-state TCP-socket count after
// closeTestApp(). Set to 5 because the audit filters by `remotePort` set
// (excludes Jest stdio/IPC wrappers) — anything > 5 in that filtered list
// is a real leaked TCP connection. The spike snapshot showed 49 leaks
// pre-fix; ≤ 5 leaves comfortable margin for redis-mock + jest internals
// without missing genuine regressions.
const SOCKET_HANDLE_AUDIT_THRESHOLD = 5;

// ROK-1249 AC2: when RL_TEST_SOCKET_DEBUG=true, capture a state-bucket
// snapshot the moment a `socket hang up` / ECONNRESET surfaces from the
// rotating-suite flake. best-effort, fire-and-forget — the helper itself
// must not throw and crash the test runner mid-suite.
//
// Idempotency: this file is loaded once per Jest spec file. Without
// guarding, `process.on(...)` accumulates 77 listeners across the suite
// and `MaxListenersExceededWarning` fires after ~10 files. Pin a flag
// on the process via Symbol.for so subsequent file loads skip re-registration.
const SOCKET_DEBUG_INSTALLED = Symbol.for(
  'raid-ledger.test.socket-debug-installed',
);
type ProcessWithFlag = NodeJS.Process & { [SOCKET_DEBUG_INSTALLED]?: boolean };
if (
  process.env.RL_TEST_SOCKET_DEBUG === 'true' &&
  !(process as ProcessWithFlag)[SOCKET_DEBUG_INSTALLED]
) {
  const handler = (err: unknown): void => {
    const msg = String((err as { message?: unknown })?.message ?? err);
    if (msg.includes('socket hang up') || msg.includes('ECONNRESET')) {
      void dumpFailureSnapshot(msg).catch(() => {});
    }
  };
  process.on('uncaughtException', handler);
  process.on('unhandledRejection', handler);
  (process as ProcessWithFlag)[SOCKET_DEBUG_INSTALLED] = true;
}

// ConfigModule.forRoot() in AppModule reads api/.env during the import above,
// setting process.env.DATABASE_URL to the dev DB. Delete it so getTestApp()
// uses Testcontainers for a fresh database instead of hitting the dev DB.
// Strict check mirrors test-app.ts::provisionDatabase (`CI === 'true'`) so
// non-standard values like CI=1 behave identically in both files.
if (process.env.CI !== 'true') {
  delete process.env.DATABASE_URL;
}

// ROK-1058: defensive per-file reset. Boots the TestApp (no-op after first
// file's `closeTestApp`) then truncates rows + obliterates BullMQ queues so
// state from prior spec files cannot bleed into this one. Catches the specs
// that don't call `truncateAllTables` themselves (e.g. the BullMQ leak repro
// pair) without requiring per-spec edits across the integration suite.
beforeAll(async () => {
  const testApp = await getTestApp();
  testApp.seed = await truncateAllTables(testApp.db);
});

afterAll(async () => {
  await closeTestApp();
  // ROK-1250: opt-in audit gate. When `RL_TEST_SOCKET_HANDLE_AUDIT=true`,
  // throw if more than `SOCKET_HANDLE_AUDIT_THRESHOLD` connected TCP
  // sockets remain after closeTestApp(). Off by default in CI; flipped on
  // for the AC2 30-run validation loop to prove the timeout bump + fallback
  // destroy actually keeps the count low.
  if (process.env.RL_TEST_SOCKET_HANDLE_AUDIT === 'true') {
    // `socket.destroy()` in closeTestApp is async — the kernel-side close
    // settles on the next libuv tick, so a one-shot read of `_getActiveHandles`
    // can briefly see sockets that are queued for cleanup. Mirror the
    // 500ms deadline-bounded poll used by the audit unit-test before
    // failing the suite.
    const deadline = Date.now() + 500;
    let sockets = listSocketHandles();
    while (
      sockets.length > SOCKET_HANDLE_AUDIT_THRESHOLD &&
      Date.now() < deadline
    ) {
      await new Promise<void>((r) => setTimeout(r, 25));
      sockets = listSocketHandles();
    }
    if (sockets.length > SOCKET_HANDLE_AUDIT_THRESHOLD) {
      throw new Error(
        `[ROK-1250] socket handle audit failed after closeTestApp(): ` +
          `${sockets.length} > ${SOCKET_HANDLE_AUDIT_THRESHOLD} TCP sockets ` +
          `still tracked by libuv after 500ms drain wait ` +
          `(filter: constructor.name === 'Socket' && typeof remotePort === 'number')`,
      );
    }
  }
});
