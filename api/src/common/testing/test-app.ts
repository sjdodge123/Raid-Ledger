/**
 * Integration test application helper.
 *
 * Boots a real NestJS app backed by a PostgreSQL database.
 * Singleton per test run — the DB connection and app are created once and
 * reused across all integration test suites for performance.
 *
 * Dual-mode:
 *   - Local dev: Testcontainers spins up a fresh `pgvector/pgvector:pg16`
 *     container (same image as prod / CI / `raid-ledger-db`). Ephemeral —
 *     dies with the suite, never touches the operator's live local DB.
 *   - CI: Honors `DATABASE_URL` only when `CI=true` (GitHub Actions sets
 *     this) so the service container is reused. Locally, `DATABASE_URL`
 *     pointing at the live `raid-ledger-db` is IGNORED — otherwise
 *     `truncateAllTables` would wipe operator-restored app_settings,
 *     local_credentials, etc. on every `npm run test:integration` run,
 *     breaking the clone-prod-to-local recovery flow. (Surfaced by the
 *     fix/batch-2026-05-14 post-clone audit.)
 *
 * Usage:
 *   const { app, request } = await getTestApp();
 *   const res = await request.get('/system/status');
 */
import { Test } from '@nestjs/testing';
import { type INestApplication } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { drizzle } from 'drizzle-orm/postgres-js';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as supertest from 'supertest';
import type TestAgent from 'supertest/lib/agent';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import * as path from 'path';
import * as schema from '../../drizzle/schema';
import { AppModule } from '../../app.module';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import { QueueHealthService } from '../../queue/queue-health.service';
import { REDIS_CLIENT } from '../../redis/redis.module';
import { truncateAllTables, type SeededData } from './integration-helpers';
import { createRedisMock, type RedisMockHandle } from './redis-mock';
import {
  destroySocketsOnPort,
  extractPortFromConnectionString,
} from './socket-handle-audit';
import { instrumentHttpServer, wrapAgentForSnapshot } from './socket-debug';
// ROK-1264: `supertest-persistent-agent` is intentionally NOT wired here.
// The helper + spec exist as ready-to-deploy machinery if a future targeted
// investigation needs single-socket pinning, but applying it globally
// deterministically breaks tests that use Promise.all to fan out parallel
// supertest calls (e.g. `events.integration.spec.ts › shape parity per slice`
// failed 10/10 with maxSockets:1). See `docs/spikes/rok-1250-residual-layer-5.md`.

export type { RedisMockHandle } from './redis-mock';

export interface TestApp {
  app: INestApplication;
  request: TestAgent<supertest.Test>;
  db: PostgresJsDatabase<typeof schema>;
  seed: SeededData;
  /** Only set when running locally via Testcontainers; null in CI. */
  container: StartedPostgreSqlContainer | null;
  /** Handle to the in-memory Redis mock. Exposed so truncateAllTables can
   * clear cross-suite state (e.g. jwt_block:* keys) without call-site changes. */
  redisMock: RedisMockHandle;
  /**
   * Internal: raw postgres-js client. Stored so `closeTestApp` can end the
   * pool — `app.close()` does NOT cascade to it (DrizzleModule has no
   * onModuleDestroy hook), and 49 spec files × max:10 sockets exhausts the
   * Postgres `max_connections` budget without explicit teardown. ROK-1104.
   */
  _appClient: ReturnType<typeof postgres>;
}

/**
 * Each Jest spec file (with `setupFilesAfterEnv`) gets its OWN VM context.
 * `process.env` and module-level state are NOT shared across files — every
 * `*.integration.spec.ts` evaluates this module afresh and gets its own
 * `process[INSTANCE_KEY]` slot. `closeTestApp` clears the slot in every
 * file's `afterAll`, so each file actually re-provisions a NestJS app +
 * pool. The per-file boundary is what gives us BullMQ prefix isolation
 * (each file's prefix is a fresh `test-<pid>-<ts>-`). ROK-1058.
 */
export const INSTANCE_KEY = '__raid_ledger_test_app';

function getInstance(): TestApp | null {
  return (
    (process as unknown as Record<string, TestApp | null>)[INSTANCE_KEY] ?? null
  );
}

/** Public alias used by `dump-failure-snapshot.ts` to read live app state
 * (DI container, postgres-js client, redis-mock store) at the moment a
 * `socket hang up` / ECONNRESET surfaces during the integration suite.
 * ROK-1249. */
export function getTestAppInstance(): TestApp | null {
  return getInstance();
}

function setInstance(app: TestApp | null): void {
  (process as unknown as Record<string, TestApp | null>)[INSTANCE_KEY] = app;
}

/**
 * Get or create the singleton TestApp.
 * First call provisions a PostgreSQL database (Testcontainers locally,
 * existing service in CI), runs migrations, and boots NestJS.
 * Subsequent calls return the cached instance.
 */
/** Provision a PostgreSQL connection (Testcontainers locally, env var in CI). */
async function provisionDatabase(): Promise<{
  connectionString: string;
  container: StartedPostgreSqlContainer | null;
}> {
  // Honor DATABASE_URL ONLY in CI. Locally this env var points at the
  // operator's live `raid-ledger-db` and truncateAllTables would erase
  // app_settings / local_credentials / etc., breaking the clone-prod-to-local
  // recovery flow. See file-level comment + fix/batch-2026-05-14 audit.
  if (process.env.CI === 'true' && process.env.DATABASE_URL) {
    return { connectionString: process.env.DATABASE_URL, container: null };
  }
  // Preload pg_stat_statements so the ROK-1333 + ROK-1156 regression
  // specs can exercise the EXECUTE-grant path instead of self-skipping
  // via isPgStatStatementsAvailable. The extension is preloaded in prod
  // (Dockerfile.allinone:226) and the test container must mirror that
  // shape to be a true regression guard.
  const container = await new PostgreSqlContainer('pgvector/pgvector:pg16')
    .withDatabase('raid_ledger_test')
    .withUsername('test')
    .withPassword('test')
    .withCommand([
      'postgres',
      '-c',
      'shared_preload_libraries=pg_stat_statements',
      '-c',
      'pg_stat_statements.track=all',
    ])
    .withStartupTimeout(60_000)
    .start();
  return { connectionString: container.getConnectionUri(), container };
}

/** Run migrations and return an app-level DB connection plus the raw client. */
async function setupDatabase(connectionString: string): Promise<{
  db: PostgresJsDatabase<typeof schema>;
  appClient: ReturnType<typeof postgres>;
}> {
  const migrationClient = postgres(connectionString, { max: 1 });
  const migrationDb = drizzle(migrationClient);
  await migrate(migrationDb, {
    migrationsFolder: path.join(__dirname, '../../drizzle/migrations'),
  });
  await migrationClient.end();
  const appClient = postgres(connectionString, { max: 10 });
  return { db: drizzle(appClient, { schema }), appClient };
}

/** Set env vars needed by the test NestJS app. */
function setTestEnvVars(connectionString: string): void {
  process.env.DATABASE_URL = connectionString;
  process.env.JWT_SECRET = 'integration-test-secret';
  process.env.CLIENT_URL = 'http://localhost:5173';
  process.env.CORS_ORIGIN = 'http://localhost:5173';
  process.env.THROTTLE_DEFAULT_LIMIT = '999999';
  process.env.THROTTLE_DISABLED = 'true';
  // ROK-1058: namespace BullMQ keys under a per-process-PID prefix so test
  // queues never touch the shared `raid-ledger-redis` container's prod keys
  // (`bull:*`). Each Jest spec file evaluates this module in its own VM
  // context, so the env var resets to undefined per file — meaning every
  // file gets its own fresh prefix at first `getTestApp()`. The Date.now()
  // suffix guards against pid reuse across rapid CI matrix runs. MUST be
  // set BEFORE `Test.createTestingModule(...)` compiles AppModule so
  // BullModule.forRootAsync's factory captures the prefix at config time.
  if (!process.env.BULLMQ_KEY_PREFIX) {
    process.env.BULLMQ_KEY_PREFIX = `test-${process.pid}-${Date.now()}-`;
  }
}

async function buildNestApp(
  db: PostgresJsDatabase<typeof schema>,
  redisMock: RedisMockHandle,
): Promise<{ app: INestApplication; request: TestAgent<supertest.Test> }> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DrizzleAsyncProvider)
    .useValue(db)
    .overrideProvider(REDIS_CLIENT)
    .useValue(redisMock.client)
    .compile();
  const app = moduleRef.createNestApplication();
  await app.init();
  if (process.env.CRON_DISABLED === 'true') {
    stopAllCronJobs(app);
  }
  const httpServer = app.getHttpServer() as import('http').Server;
  // ROK-1264: bump server-side keepAliveTimeout WAY above any inter-test gap
  // so any future keep-alive pool (or supertest default if upgraded) does not
  // race the server's 5 s socket reaper. truncateAllTables + bcrypt + setup
  // helpers easily exceed 5 s between adjacent `it()`s. The patch is benign
  // because Jest force-exits the worker and `closeTestApp` destroys server
  // handles; never reaches the 10-minute lifetime in practice.
  // headersTimeout must be >= keepAliveTimeout (Node http docs).
  httpServer.keepAliveTimeout = 600_000;
  httpServer.headersTimeout = 610_000;
  if (process.env.RL_TEST_SOCKET_DEBUG === 'true') {
    instrumentHttpServer(httpServer);
  }
  let request = supertest.default(httpServer);
  if (process.env.RL_TEST_SOCKET_DEBUG === 'true') {
    request = wrapAgentForSnapshot(request);
  }
  return { app, request };
}

/**
 * Stop every cron job registered against the SchedulerRegistry by either
 * `@Cron` decorators (mounted by `SchedulerOrchestrator.onApplicationBootstrap`)
 * or the plugin-host `CronManagerService`. Called immediately after
 * `app.init()` returns so handlers cannot fire inside the test window
 * (ROK-1223 / ROK-1232). Cron handlers run on real timers and can mutate
 * DB rows the test loop is also asserting against — e.g.
 * `StandalonePollReminderService_runReminders` writing `notification_dedup`
 * mid-spec. The `cron` library's `CronJob.stop()` flips `isActive` to false
 * and clears the internal interval, so jobs stay in the registry but are
 * inert for the lifetime of the test app.
 */
function stopAllCronJobs(app: INestApplication): void {
  const scheduler = app.get(SchedulerRegistry, { strict: false });
  if (!scheduler) return;
  for (const [, job] of scheduler.getCronJobs()) {
    job.stop();
  }
}

export async function getTestApp(): Promise<TestApp> {
  const cached = getInstance();
  if (cached) return cached;
  const { connectionString, container } = await provisionDatabase();
  const { db, appClient } = await setupDatabase(connectionString);
  const redisMock = createRedisMock();
  // Register the mock BEFORE seeding so truncateAllTables can reset it
  // via the process-level singleton during its first (pre-app-init) call.
  const preInstance: Partial<TestApp> = {
    db,
    redisMock,
    _appClient: appClient,
  };
  setInstance(preInstance as TestApp);
  const seed = await truncateAllTables(db);
  setTestEnvVars(connectionString);
  const { app, request } = await buildNestApp(db, redisMock);
  const testApp: TestApp = {
    app,
    request,
    db,
    seed,
    container,
    redisMock,
    _appClient: appClient,
  };
  setInstance(testApp);
  return testApp;
}

/**
 * Shut down the TestApp singleton.
 * Called automatically by the global afterAll hook in integration-setup.ts.
 *
 * Order matters: app.close() must run first so any in-flight queries drain
 * via DrizzleModule's provider; then end the postgres-js pool (DrizzleModule
 * has no onModuleDestroy, so app.close() does NOT cascade); then stop the
 * Testcontainer. ROK-1250 bumped the end timeout 5 -> 30 because at the cap
 * postgres-js calls `socket.end()` (graceful FIN), not `socket.destroy()`,
 * leaving the kernel-tracked TCP socket on `_getActiveHandles` until the
 * server FIN-ACKs. With the ROK-1248 drain barrier above, queries are not
 * in flight here, so the bump only matters when a residual write needs the
 * round-trip headroom.
 */
export async function closeTestApp(): Promise<void> {
  const instance = getInstance();
  if (!instance) return;

  // ROK-1248: drain BullMQ queues before tearing down the app so worker.close()
  // never has to await an in-flight job whose DB query would race the
  // _appClient.end timeout cap.
  try {
    const queueHealth = instance.app.get(QueueHealthService, { strict: false });
    if (queueHealth) {
      await queueHealth.awaitDrained(15_000);
    }
  } catch {
    // best-effort — fall through to app.close() regardless
  }

  // Capture the test container's port BEFORE _appClient.end() / container.stop()
  // so the fallback destroy can scope itself to ONLY our test-DB sockets.
  const connStr =
    instance.container?.getConnectionUri() ?? process.env.DATABASE_URL ?? '';
  const ourPort = extractPortFromConnectionString(connStr);

  await instance.app.close();
  if (instance._appClient) {
    await instance._appClient.end({ timeout: 30 });
  }

  // ROK-1250 fallback guard: if anything is still bound to the test
  // container's port AFTER the graceful end resolved, force-destroy it.
  // The `remotePort === ourPort` filter cannot collide with redis-mock,
  // supertest, or BullMQ sockets. On healthy runs this finds 0.
  if (ourPort !== null) {
    destroySocketsOnPort(ourPort);
  }

  destroyBullmqRedisSocketsIfDefault();

  if (instance.container) {
    await instance.container.stop();
  }
  setInstance(null);
}

/**
 * ROK-1250 layer 2 (post-empirical-debug): force-destroy ioredis sockets to
 * the local BullMQ Redis container on port 6379. Captured snapshot
 * 2026-05-10T17-30-40-570Z showed 40 of 47 active sockets at flake time were
 * ::1:6379 ioredis connections that survived `app.close()`'s Nest lifecycle
 * hooks. The drain barrier in `closeTestApp` ensures no jobs are in-flight,
 * so destroying these sockets is a no-op for application correctness — it
 * just frees the kernel-side resources before the next spec file boots its
 * own 13×3 BullMQ worker connections. Skip if REDIS_URL targets a non-default
 * port (e.g. CI sidecar container). Match `queue.module.ts` semantics:
 * `Number(parsed.port) || 6379` — empty `parsed.port` resolves to 6379.
 */
function destroyBullmqRedisSocketsIfDefault(): void {
  const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
  let redisPort: number | null = null;
  try {
    const parsed = new URL(redisUrl);
    redisPort = Number(parsed.port) || 6379;
  } catch {
    // Malformed URL — fall through with null; layer-2 cleanup skipped.
  }
  if (redisPort === 6379) {
    destroySocketsOnPort(6379);
  }
}
