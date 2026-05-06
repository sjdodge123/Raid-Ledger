/**
 * Integration test helpers — DB seeding and cleanup utilities.
 *
 * These are SEPARATE from the unit-test drizzle-mock and factories.
 * They operate on a real PostgreSQL database via Drizzle ORM.
 */
import * as bcrypt from 'bcrypt';
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as supertest from 'supertest';
import type TestAgent from 'supertest/lib/agent';
import { Logger } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import * as schema from '../../drizzle/schema';
import { clearAuthUserCache } from '../../auth/auth-user-cache';
import { ALL_QUEUE_NAMES } from '../../queue/queue-registry';
import { SettingsService } from '../../settings/settings.service';
import { INSTANCE_KEY, type TestApp } from './test-app';

const obliterateLogger = new Logger('truncateAllTables.obliterate');

export interface SeededData {
  adminUser: typeof schema.users.$inferSelect;
  adminPassword: string;
  adminEmail: string;
  game: typeof schema.games.$inferSelect;
}

/**
 * Seed baseline data: an admin user with local credentials and a sample game.
 * Called once during TestApp setup.
 */
export async function seedBaseline(
  db: PostgresJsDatabase<typeof schema>,
): Promise<SeededData> {
  const adminEmail = 'admin@test.local';
  const adminPassword = 'TestPassword123!';
  const passwordHash = await bcrypt.hash(adminPassword, 4); // Low rounds for speed

  // Create admin user
  const [adminUser] = await db
    .insert(schema.users)
    .values({
      discordId: 'local:admin@test.local',
      username: 'admin',
      role: 'admin',
    })
    .returning();

  // Create local credentials for admin
  await db.insert(schema.localCredentials).values({
    email: adminEmail,
    passwordHash,
    userId: adminUser.id,
  });

  // Create a sample game
  const [game] = await db
    .insert(schema.games)
    .values({
      name: 'Test Game',
      slug: 'test-game',
      coverUrl: null,
      igdbId: null,
    })
    .returning();

  return { adminUser, adminPassword, adminEmail, game };
}

const DEADLOCK_MAX_RETRIES = 5;
const DEADLOCK_BASE_DELAY_MS = 200;

async function retryOnDeadlock(fn: () => Promise<unknown>): Promise<void> {
  for (let attempt = 1; attempt <= DEADLOCK_MAX_RETRIES; attempt++) {
    try {
      await fn();
      return;
    } catch (err: unknown) {
      const isDeadlock =
        err instanceof Error && 'code' in err && err.code === '40P01';
      if (!isDeadlock || attempt === DEADLOCK_MAX_RETRIES) throw err;
      const delay = DEADLOCK_BASE_DELAY_MS * 2 ** (attempt - 1);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

/**
 * Truncate all application tables between test suites.
 * Preserves baseline seed data by re-seeding after truncation.
 * Dynamically discovers table names to avoid hardcoded list going stale.
 */
export async function truncateAllTables(
  db: PostgresJsDatabase<typeof schema>,
): Promise<SeededData> {
  // Discover all application tables.
  // Exclude Drizzle migration tracking and cron infrastructure tables —
  // cron_jobs/cron_job_executions are seeded on app startup and must persist
  // across tests to avoid FK violations and deadlocks with active cron handlers.
  const tables = await db.execute<{ tablename: string }>(sql`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename NOT LIKE '__drizzle%'
      AND tablename NOT IN ('cron_jobs', 'cron_job_executions')
  `);

  if (tables.length > 0) {
    await retryOnDeadlock(() =>
      db.transaction(async (tx) => {
        // Disable FK trigger checks for the session so DELETE order doesn't matter.
        await tx.execute(sql`SET session_replication_role = 'replica'`);
        for (const t of tables) {
          await tx.execute(sql.raw(`DELETE FROM "${t.tablename}"`));
        }
        await tx.execute(sql`SET session_replication_role = 'origin'`);
      }),
    );
  }

  // Reset cross-suite in-memory state that can otherwise leak between files
  // during a full integration run (ROK-1059, ROK-1232). The mock Redis store,
  // the auth-user cache, and the SettingsService cache are module/instance-
  // level singletons held alive by the TestApp singleton on `process`.
  // Without clearing them here, a `jwt_block:<userId>` entry written by an
  // earlier suite can silently invalidate tokens issued to the freshly
  // re-seeded admin, a stale `community_name` (or any setting) read can
  // bias logic in the next spec, and a `lineup-*` dedup key can silence a
  // notification expected by spec B.
  clearAuthUserCache();
  clearMockRedisByPrefix(MOCK_REDIS_TEARDOWN_PREFIXES);
  clearSettingsServiceCache();
  await obliterateAllQueues();

  // Re-seed baseline data
  return seedBaseline(db);
}

/**
 * Obliterate every BullMQ queue registered in the test app's DI container.
 * No-op when the app isn't booted yet (the very first truncate runs BEFORE
 * `app.init()` — see test-app.ts:getTestApp). When the app is up, this is
 * the only thing that purges Redis-side queue state between suites: BullMQ
 * uses an out-of-Node `raid-ledger-redis` container, so neither
 * `app.close()` nor row-level DELETE reaches it.
 *
 * Safe blast radius: `BULLMQ_KEY_PREFIX` (set in setTestEnvVars) namespaces
 * the obliterate sweep under `test-<pid>-<ts>-:bull:*`, so this never
 * touches dev/prod `bull:*` keys in the shared Redis container. ROK-1058.
 */
async function obliterateAllQueues(): Promise<void> {
  const instance = (process as unknown as Record<string, TestApp | null>)[
    INSTANCE_KEY
  ];
  const app = instance?.app;
  if (!app) return;
  for (const name of ALL_QUEUE_NAMES) {
    try {
      const queue = app.get<Queue>(getQueueToken(name), { strict: false });
      if (!queue) continue;
      await queue.obliterate({ force: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      obliterateLogger.warn(`Failed to obliterate queue ${name}: ${msg}`);
    }
  }
}

/**
 * Prefixes purged from the mock Redis store on each truncate.
 *
 * `jwt_block:` blocks token reuse after revocation; the dedup prefixes mirror
 * the Playwright reset (`demo-test-reset.service.ts:flushDedupRedisCache`) so
 * a `lineup-reminder:1:99:24h` written by spec A cannot silence a matching
 * notification expected by spec B. ROK-1059 + ROK-1232.
 */
const MOCK_REDIS_TEARDOWN_PREFIXES: readonly string[] = [
  'jwt_block:',
  'lineup-',
  'event-',
  'tiebreaker-',
  'scheduling-',
  'standalone-poll-',
];

/**
 * Delete every key in the in-memory Redis mock that starts with one of the
 * given prefixes. No-op when no TestApp is registered yet (during the very
 * first truncate, before the mock is created).
 */
function clearMockRedisByPrefix(prefixes: readonly string[]): void {
  const instance = (process as unknown as Record<string, TestApp | null>)[
    INSTANCE_KEY
  ];
  const store = instance?.redisMock?.store;
  if (!store) return;
  for (const key of [...store.keys()]) {
    if (prefixes.some((p) => key.startsWith(p))) store.delete(key);
  }
}

/**
 * Drop the in-memory `SettingsService` cache so the next read after truncate
 * goes back to the (now-empty) DB. The service caches decrypted settings for
 * 30 minutes; without this reset, a `community_name` (or any setting) value
 * written by spec A still resolves in spec B even though its row was just
 * deleted. No-op until the NestJS app has been booted. ROK-1232.
 */
function clearSettingsServiceCache(): void {
  const instance = (process as unknown as Record<string, TestApp | null>)[
    INSTANCE_KEY
  ];
  const app = instance?.app;
  if (!app) return;
  try {
    const settings = app.get(SettingsService, { strict: false });
    settings?.invalidateCache(true);
  } catch {
    // Service not yet available (very first truncate before app.init()).
  }
}

/**
 * Poll an assertion function until it passes or the deadline expires.
 * Replaces fixed `setTimeout` waits for fire-and-forget async operations
 * (e.g., checkTentativeDisplacement) with a retry loop that fails fast.
 *
 * @param fn - Async function containing expect() assertions.
 * @param deadlineMs - Max time to retry (default 2000ms).
 * @param intervalMs - Polling interval (default 100ms).
 */
export async function waitFor(
  fn: () => Promise<void>,
  deadlineMs = 2000,
  intervalMs = 100,
): Promise<void> {
  const start = Date.now();
  let lastError: unknown;
  while (Date.now() - start < deadlineMs) {
    try {
      await fn();
      return;
    } catch (err) {
      lastError = err;
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }
  throw lastError;
}

/**
 * Login as the seeded admin user and return a JWT access token.
 * Convenience helper for tests that need authenticated requests.
 */
export async function loginAsAdmin(
  request: TestAgent<supertest.Test>,
  seed: SeededData,
): Promise<string> {
  const res = await request
    .post('/auth/local')
    .send({ email: seed.adminEmail, password: seed.adminPassword });

  if (res.status !== 200) {
    throw new Error(
      `loginAsAdmin failed: expected 200 but got ${res.status} — ${JSON.stringify(res.body)}`,
    );
  }

  const body = res.body as { access_token: string };
  return body.access_token;
}
