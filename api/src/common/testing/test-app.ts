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

/** Redis mock set with NX support. */
function mockRedisSet(store: Map<string, string>) {
  return (key: string, value: string, ...args: (string | number)[]) => {
    const hasNX = args.some(
      (a) => typeof a === 'string' && a.toUpperCase() === 'NX',
    );
    if (hasNX && store.has(key)) return Promise.resolve(null);
    store.set(key, value);
    return Promise.resolve('OK');
  };
}

/** Redis mock glob-style key search. */
function mockRedisKeys(store: Map<string, string>) {
  return (pattern: string) => {
    if (pattern === '*') return Promise.resolve([...store.keys()]);
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp('^' + escaped.replace(/\*/g, '.*') + '$');
    return Promise.resolve([...store.keys()].filter((k) => re.test(k)));
  };
}

/** Redis mock del helper. */
function mockRedisDel(store: Map<string, string>) {
  return (...keys: string[]) => {
    let count = 0;
    for (const k of keys) {
      if (store.delete(k)) count++;
    }
    return Promise.resolve(count);
  };
}

/** Redis mock incr helper. */
function mockRedisIncr(store: Map<string, string>) {
  return (key: string) => {
    const next = parseInt(store.get(key) ?? '0', 10) + 1;
    store.set(key, String(next));
    return Promise.resolve(next);
  };
}

/** In-memory Redis mock that satisfies the interface used by the app. */
function createRedisMock() {
  const store = new Map<string, string>();
  return {
    get: (key: string) => Promise.resolve(store.get(key) ?? null),
    set: mockRedisSet(store),
    setex: (key: string, _seconds: number, value: string) => {
      store.set(key, value);
      return Promise.resolve('OK');
    },
    del: mockRedisDel(store),
    incr: mockRedisIncr(store),
    expire: () => Promise.resolve(1),
    ttl: () => Promise.resolve(-1),
    exists: (...keys: string[]) =>
      Promise.resolve(keys.filter((k) => store.has(k)).length),
    keys: mockRedisKeys(store),
    ping: () => Promise.resolve('PONG'),
    quit: () => Promise.resolve('OK'),
    disconnect: () => undefined,
    status: 'ready',
    duplicate: () => createRedisMock(),
  };
}

export interface TestApp {
  app: INestApplication;
  request: TestAgent<supertest.Test>;
  db: PostgresJsDatabase<typeof schema>;
  seed: SeededData;
  /** Only set when running locally via Testcontainers; null in CI. */
  container: StartedPostgreSqlContainer | null;
}

/**
 * Store singleton on `process` so it survives Jest's per-file module
 * re-evaluation. Jest creates a separate VM context (and therefore a
 * separate `globalThis`) for each test file, even with --runInBand.
 * The `process` object IS shared across VM contexts in the same
 * Node.js process, making it a reliable cross-file singleton store.
 */
const INSTANCE_KEY = '__raid_ledger_test_app';

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
    .start();
  return { connectionString: container.getConnectionUri(), container };
}

/** Run migrations and return an app-level DB connection. */
async function setupDatabase(connectionString: string) {
  const migrationClient = postgres(connectionString, { max: 1 });
  const migrationDb = drizzle(migrationClient);
  await migrate(migrationDb, {
    migrationsFolder: path.join(__dirname, '../../drizzle/migrations'),
  });
  await migrationClient.end();
  const appClient = postgres(connectionString, { max: 10 });
  return drizzle(appClient, { schema });
}

/** Set env vars needed by the test NestJS app. */
function setTestEnvVars(connectionString: string): void {
  process.env.DATABASE_URL = connectionString;
  process.env.JWT_SECRET = 'integration-test-secret';
  process.env.CLIENT_URL = 'http://localhost:5173';
  process.env.CORS_ORIGIN = 'http://localhost:5173';
  process.env.THROTTLE_DEFAULT_LIMIT = '999999';
  process.env.THROTTLE_DISABLED = 'true';
}

export async function getTestApp(): Promise<TestApp> {
  const cached = getInstance();
  if (cached) return cached;
  const { connectionString, container } = await provisionDatabase();
  const db = await setupDatabase(connectionString);
  const seed = await truncateAllTables(db);
  setTestEnvVars(connectionString);
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DrizzleAsyncProvider)
    .useValue(db)
    .overrideProvider(REDIS_CLIENT)
    .useValue(createRedisMock())
    .compile();
  const app = moduleRef.createNestApplication();
  await app.init();
  const request = supertest.default(
    app.getHttpServer() as import('http').Server,
  );
  const testApp: TestApp = { app, request, db, seed, container };
  setInstance(testApp);
  return testApp;
}

/**
 * Shut down the TestApp singleton.
 * Called automatically by the global afterAll hook in integration-setup.ts.
 */
export async function closeTestApp(): Promise<void> {
  const instance = getInstance();
  if (!instance) return;

  await instance.app.close();
  if (instance.container) {
    await instance.container.stop();
  }
  setInstance(null);
}
