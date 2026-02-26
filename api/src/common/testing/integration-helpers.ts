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
import * as schema from '../../drizzle/schema';

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

/**
 * Truncate all application tables between test suites.
 * Preserves baseline seed data by re-seeding after truncation.
 * Dynamically discovers table names to avoid hardcoded list going stale.
 */
export async function truncateAllTables(
  db: PostgresJsDatabase<typeof schema>,
): Promise<SeededData> {
  // Discover all application tables (exclude Drizzle migration tracking)
  const tables: { tablename: string }[] = await db.execute(sql`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename NOT LIKE '__drizzle%'
  `);

  if (tables.length > 0) {
    const tableNames = tables.map((t) => t.tablename).join(', ');
    await db.execute(sql.raw(`TRUNCATE TABLE ${tableNames} CASCADE`));
  }

  // Re-seed baseline data
  return seedBaseline(db);
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

  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  return res.body.access_token as string;
}
