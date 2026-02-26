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
import postgres from 'postgres';
import * as supertest from 'supertest';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import * as path from 'path';
import * as schema from '../../drizzle/schema';
import { AppModule } from '../../app.module';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import { REDIS_CLIENT } from '../../redis/redis.module';
import { seedBaseline, type SeededData } from './integration-helpers';

/** In-memory Redis mock that satisfies the minimal interface used by the app. */
function createRedisMock() {
  const store = new Map<string, string>();
  return {
    get: (key: string) => Promise.resolve(store.get(key) ?? null),
    set: (key: string, value: string) => {
      store.set(key, value);
      return Promise.resolve('OK');
    },
    del: (...keys: string[]) => {
      let count = 0;
      for (const k of keys) {
        if (store.delete(k)) count++;
      }
      return Promise.resolve(count);
    },
    expire: () => Promise.resolve(1),
    ttl: () => Promise.resolve(-1),
    exists: (...keys: string[]) =>
      Promise.resolve(keys.filter((k) => store.has(k)).length),
    quit: () => Promise.resolve('OK'),
    disconnect: () => undefined,
    status: 'ready',
    duplicate: () => createRedisMock(),
  };
}

export interface TestApp {
  app: INestApplication;
  request: ReturnType<typeof supertest.default>;
  db: ReturnType<typeof drizzle>;
  seed: SeededData;
  /** Only set when running locally via Testcontainers; null in CI. */
  container: StartedPostgreSqlContainer | null;
}

let instance: TestApp | null = null;

/**
 * Get or create the singleton TestApp.
 * First call provisions a PostgreSQL database (Testcontainers locally,
 * existing service in CI), runs migrations, and boots NestJS.
 * Subsequent calls return the cached instance.
 */
export async function getTestApp(): Promise<TestApp> {
  if (instance) return instance;

  let connectionString: string;
  let container: StartedPostgreSqlContainer | null = null;

  if (process.env.DATABASE_URL) {
    // CI mode — use the pre-existing postgres service
    connectionString = process.env.DATABASE_URL;
  } else {
    // Local mode — spin up a Testcontainers PostgreSQL instance
    container = await new PostgreSqlContainer('postgres:15-alpine')
      .withDatabase('raid_ledger_test')
      .withUsername('test')
      .withPassword('test')
      .start();
    connectionString = container.getConnectionUri();
  }

  // 2. Run Drizzle migrations
  const migrationClient = postgres(connectionString, { max: 1 });
  const migrationDb = drizzle(migrationClient);
  await migrate(migrationDb, {
    migrationsFolder: path.join(__dirname, '../../drizzle/migrations'),
  });
  await migrationClient.end();

  // 3. Create the app-level DB connection
  const appClient = postgres(connectionString, { max: 10 });
  const db = drizzle(appClient, { schema });

  // 4. Seed baseline data
  const seed = await seedBaseline(db);

  // 5. Boot NestJS with real DB, mock Redis, and test env vars
  process.env.DATABASE_URL = connectionString;
  process.env.JWT_SECRET = 'integration-test-secret';
  process.env.CLIENT_URL = 'http://localhost:5173';
  process.env.CORS_ORIGIN = 'http://localhost:5173';

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(DrizzleAsyncProvider)
    .useValue(db)
    .overrideProvider(REDIS_CLIENT)
    .useValue(createRedisMock())
    .compile();

  const app = moduleRef.createNestApplication();
  await app.init();

  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
  const request = supertest.default(app.getHttpServer());

  instance = { app, request, db, seed, container };
  return instance;
}

/**
 * Shut down the TestApp singleton.
 * Call this in globalTeardown or afterAll of the last suite.
 */
export async function closeTestApp(): Promise<void> {
  if (!instance) return;

  await instance.app.close();
  if (instance.container) {
    await instance.container.stop();
  }
  instance = null;
}
