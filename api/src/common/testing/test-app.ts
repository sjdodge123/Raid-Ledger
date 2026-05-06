/**
 * Integration test application helper.
 *
 * Boots a real NestJS app backed by a PostgreSQL database.
 * Singleton per test run — the DB connection and app are created once and
 * reused across all integration test suites for performance.
 *
 * Dual-mode:
 *   - Local dev: Testcontainers spins up a fresh PostgreSQL container.
 *   - CI: Detects DATABASE_URL env var and connects to the existing
 *     CI postgres service (no Docker-in-Docker needed).
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
import { REDIS_CLIENT } from '../../redis/redis.module';
import { truncateAllTables, type SeededData } from './integration-helpers';
import { createRedisMock, type RedisMockHandle } from './redis-mock';

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
  if (process.env.DATABASE_URL) {
    return { connectionString: process.env.DATABASE_URL, container: null };
  }
  const container = await new PostgreSqlContainer('pgvector/pgvector:pg16')
    .withDatabase('raid_ledger_test')
    .withUsername('test')
    .withPassword('test')
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
  const request = supertest.default(
    app.getHttpServer() as import('http').Server,
  );
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
 * Testcontainer. The 5s end timeout caps teardown latency on the last
 * spec — postgres-js default 30s reintroduces ROK-1104 symptoms.
 */
export async function closeTestApp(): Promise<void> {
  const instance = getInstance();
  if (!instance) return;

  await instance.app.close();
  if (instance._appClient) {
    await instance._appClient.end({ timeout: 5 });
  }
  if (instance.container) {
    await instance.container.stop();
  }
  setInstance(null);
}
