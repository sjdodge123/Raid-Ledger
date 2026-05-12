/**
 * ROK-1260 — `DiscordNotificationService.deactivateUser()` integration tests.
 *
 * These tests prove the behavior the dev must build: a single user-facing
 * `deactivateUser(userId)` method that
 *   1. flips `users.deactivated_at` from NULL to NOW() (idempotent — second
 *      call within the same NULL→NOT NULL transition is a no-op),
 *   2. cancels every upcoming-event signup for the user via the existing
 *      `cancelSignup()` pipeline (so embed sync / auto-alloc / role-gap
 *      alerts fire normally — past-event signups stay untouched),
 *   3. writes a single admin in-app notification per fresh transition,
 *   4. emits a SECOND admin notification if the user is manually
 *      reactivated and then deactivated again (re-notify on every fresh
 *      transition — operator decision in spec).
 *
 * Every assertion below MUST FAIL against current `origin/main` state
 * because none of the production code exists yet (`deactivatedAt` column,
 * `deactivateUser()` method, `cancelAllUpcomingSignupsForUser()` helper,
 * the admin notification helper, and the new `user_deactivated_discord`
 * notification type).
 */
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import { and, eq } from 'drizzle-orm';
import { DiscordNotificationService } from './discord-notification.service';

let testApp: TestApp;

async function setupAll(): Promise<void> {
  testApp = await getTestApp();
}

async function resetAfterEach(): Promise<void> {
  testApp.seed = await truncateAllTables(testApp.db);
}

beforeAll(() => setupAll());
afterEach(() => resetAfterEach());

// ── factories ───────────────────────────────────────────────────────────────

async function createMember(username: string) {
  const [user] = await testApp.db
    .insert(schema.users)
    .values({
      discordId: `local:${username}@test.local`,
      username,
      role: 'member',
    })
    .returning();
  return user;
}

/**
 * Create an event with an explicit start/end. Used to put signups in
 * "upcoming" vs "past" buckets relative to the user's deactivation.
 */
async function createEventAt(
  creatorId: number,
  title: string,
  startTimeMs: number,
  durationMs = 3 * 60 * 60 * 1000,
) {
  const start = new Date(startTimeMs);
  const end = new Date(startTimeMs + durationMs);
  const [event] = await testApp.db
    .insert(schema.events)
    .values({
      title,
      creatorId,
      duration: [start, end] as [Date, Date],
    })
    .returning();
  return event;
}

async function createSignup(eventId: number, userId: number) {
  const [signup] = await testApp.db
    .insert(schema.eventSignups)
    .values({ eventId, userId, status: 'going' })
    .returning();
  return signup;
}

async function countAdminDeactivationNotifications(
  adminUserId: number,
): Promise<number> {
  // Count admin notification rows with the deactivation type. The dev
  // must add `user_deactivated_discord` to the notification-type enum;
  // this raw count gives the integration test a stable measurement
  // regardless of the surrounding payload shape.
  const rows = await testApp.db
    .select({ id: schema.notifications.id })
    .from(schema.notifications)
    .where(
      and(
        eq(schema.notifications.userId, adminUserId),
        eq(
          schema.notifications.type,
          'user_deactivated_discord' as unknown as 'system',
        ),
      ),
    );
  return rows.length;
}

async function getDeactivatedAt(userId: number): Promise<Date | null> {
  // postgres-js's `unsafe` simple-query path (used by `db.execute(sql\`...\`)`)
  // returns TIMESTAMP columns as plain strings. Parse to Date so the
  // `toBeInstanceOf(Date)` assertions below match.
  const rows = await testApp.db.execute<{ deactivated_at: Date | string | null }>(
    /* sql */ `SELECT deactivated_at FROM users WHERE id = ${userId}`,
  );
  const raw = rows[0]?.deactivated_at ?? null;
  if (raw === null) return null;
  if (raw instanceof Date) return raw;
  return new Date(typeof raw === 'string' ? raw.replace(' ', 'T') + 'Z' : raw);
}

// ── helpers ─────────────────────────────────────────────────────────────────

function getService(): DiscordNotificationService {
  return testApp.app.get(DiscordNotificationService);
}

// ── tests ───────────────────────────────────────────────────────────────────

describe('DiscordNotificationService.deactivateUser() — integration (ROK-1260)', () => {
  it('sets deactivated_at to a non-null timestamp', async () => {
    const member = await createMember('leavehq');
    const service = getService();

    expect(await getDeactivatedAt(member.id)).toBeNull();

    // The method does not exist yet — this call will compile-fail until
    // the dev adds it. Cast to a method-bearing shape so the spec file
    // compiles today and the assertion fails on the runtime call.
    await (
      service as unknown as { deactivateUser: (id: number) => Promise<void> }
    ).deactivateUser(member.id);

    const after = await getDeactivatedAt(member.id);
    expect(after).not.toBeNull();
    expect(after).toBeInstanceOf(Date);
  });

  it('is idempotent — second call within same transition writes ONE admin notification', async () => {
    const member = await createMember('idempotent');
    const service = getService();
    const adminId = testApp.seed.adminUser.id;

    expect(await countAdminDeactivationNotifications(adminId)).toBe(0);

    await (
      service as unknown as { deactivateUser: (id: number) => Promise<void> }
    ).deactivateUser(member.id);

    expect(await countAdminDeactivationNotifications(adminId)).toBe(1);

    // Second call MUST be a no-op for the admin notification — the
    // RETURNING guard on the UPDATE prevents a second insert.
    await (
      service as unknown as { deactivateUser: (id: number) => Promise<void> }
    ).deactivateUser(member.id);

    expect(await countAdminDeactivationNotifications(adminId)).toBe(1);
  });

  it('cancels every upcoming signup for the user (status flips off active)', async () => {
    const member = await createMember('cascade-upcoming');
    const admin = testApp.seed.adminUser;
    const future1Ms = Date.now() + 24 * 60 * 60 * 1000; // +1 day
    const future2Ms = Date.now() + 48 * 60 * 60 * 1000; // +2 days

    const ev1 = await createEventAt(admin.id, 'Upcoming Raid 1', future1Ms);
    const ev2 = await createEventAt(admin.id, 'Upcoming Raid 2', future2Ms);

    await createSignup(ev1.id, member.id);
    await createSignup(ev2.id, member.id);

    const service = getService();
    await (
      service as unknown as { deactivateUser: (id: number) => Promise<void> }
    ).deactivateUser(member.id);

    // After deactivation, no signup row should remain in an "active"
    // status (`going`/`maybe`/`bench`). `cancelSignup()` flips status to
    // either `declined` (>23h out) or `roached_out` (<=23h out).
    const remaining = await testApp.db
      .select({ status: schema.eventSignups.status })
      .from(schema.eventSignups)
      .where(eq(schema.eventSignups.userId, member.id));
    expect(remaining).toHaveLength(2);
    for (const row of remaining) {
      expect(['declined', 'roached_out']).toContain(row.status);
    }
  });

  it('leaves past-event signups untouched (history preserved)', async () => {
    const member = await createMember('history');
    const admin = testApp.seed.adminUser;
    const pastMs = Date.now() - 7 * 24 * 60 * 60 * 1000; // -7 days

    const pastEvent = await createEventAt(admin.id, 'Past Raid', pastMs);
    const pastSignup = await createSignup(pastEvent.id, member.id);

    const service = getService();
    await (
      service as unknown as { deactivateUser: (id: number) => Promise<void> }
    ).deactivateUser(member.id);

    const [row] = await testApp.db
      .select({ status: schema.eventSignups.status })
      .from(schema.eventSignups)
      .where(eq(schema.eventSignups.id, pastSignup.id))
      .limit(1);
    expect(row.status).toBe('going');
  });

  it('writes the admin notification targeted at usersService.findAdmin() (not at the deactivated user)', async () => {
    const member = await createMember('target-admin');
    const service = getService();
    const adminId = testApp.seed.adminUser.id;

    await (
      service as unknown as { deactivateUser: (id: number) => Promise<void> }
    ).deactivateUser(member.id);

    const adminRows = await testApp.db
      .select({ id: schema.notifications.id })
      .from(schema.notifications)
      .where(
        and(
          eq(schema.notifications.userId, adminId),
          eq(
            schema.notifications.type,
            'user_deactivated_discord' as unknown as 'system',
          ),
        ),
      );
    expect(adminRows).toHaveLength(1);

    // The deactivated user MUST NOT receive a notification themselves —
    // they've left the guild; pinging them is pointless and confusing.
    const selfRows = await testApp.db
      .select({ id: schema.notifications.id })
      .from(schema.notifications)
      .where(
        and(
          eq(schema.notifications.userId, member.id),
          eq(
            schema.notifications.type,
            'user_deactivated_discord' as unknown as 'system',
          ),
        ),
      );
    expect(selfRows).toHaveLength(0);
  });

  it('re-deactivation after manual reactivation writes a SECOND admin notification', async () => {
    const member = await createMember('redeact');
    const service = getService();
    const adminId = testApp.seed.adminUser.id;

    // First deactivation — admin notification #1.
    await (
      service as unknown as { deactivateUser: (id: number) => Promise<void> }
    ).deactivateUser(member.id);
    expect(await countAdminDeactivationNotifications(adminId)).toBe(1);

    // Simulate operator-driven reactivation by clearing the column
    // directly. We do this via raw SQL so the test does not depend on
    // the dev's reactivate endpoint shape.
    await testApp.db.execute(
      /* sql */ `UPDATE users SET deactivated_at = NULL WHERE id = ${member.id}`,
    );
    expect(await getDeactivatedAt(member.id)).toBeNull();

    // Second deactivation — must produce admin notification #2.
    await (
      service as unknown as { deactivateUser: (id: number) => Promise<void> }
    ).deactivateUser(member.id);
    expect(await countAdminDeactivationNotifications(adminId)).toBe(2);
  });
});
