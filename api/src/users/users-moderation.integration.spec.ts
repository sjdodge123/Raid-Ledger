/**
 * Moderation integration tests (ROK-313) — real DB via Testcontainers.
 *
 * Covers the api/users domain: kick / ban / unban endpoints + audit + refresh
 * revoke + the true data-wipe + delete-atomicity. Auth-time lockout (jwt.strategy
 * 401 on a banned/kicked token) is owned by the auth agent and lives in the auth
 * suite; here we assert the DB state + audit + endpoint contract that the auth
 * enforcement reads from.
 *
 * The wipe-completeness test seeds ≥1 row per WIPE-manifest table for the target
 * (incl. the player_co_play dual-column and the community_lineups carry-over
 * RESTRICT scenario), bans+wipes, then asserts EVERY WIPE table is cleared for
 * the target (driven off WIPE_BY_COLUMN) while the users row survives. This is the
 * ordering/RESTRICT safety net — it regresses without the carried_over_from
 * null-out. A couple of exotic-type / deep-FK tables are assertion-only; see the
 * seed helper for the rationale.
 */
import { randomUUID } from 'crypto';
import { and, eq, isNull, or } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../common/testing/integration-helpers';
import { createMemberAndLogin } from '../events/signups.integration.spec-helpers';
import * as schema from '../drizzle/schema';
import { deleteUserTransaction, WIPE_BY_COLUMN } from './users-delete.helpers';

let testApp: TestApp;
let adminToken: string;

beforeAll(async () => {
  testApp = await getTestApp();
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
});

afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
});

// ─── seed helpers ────────────────────────────────────────────────────────────

async function seedActiveRefreshToken(userId: number): Promise<void> {
  await testApp.db.insert(schema.refreshTokens).values({
    userId,
    tokenHash: `hash-${userId}-${randomUUID()}`,
    familyId: randomUUID(),
    expiresAt: new Date(Date.now() + 86_400_000),
    authMethod: 'local',
  });
}

/** Seed a member with a claimed upcoming-event signup (to assert kick preserves,
 * ban cancels). Returns the member id + the event id. */
async function seedMemberWithSignup(
  username: string,
): Promise<{ userId: number; eventId: number }> {
  const { userId } = await createMemberAndLogin(
    testApp,
    username,
    `${username}@test.local`,
  );
  const start = new Date(Date.now() + 86_400_000);
  const end = new Date(start.getTime() + 3_600_000);
  const [evt] = await testApp.db
    .insert(schema.events)
    .values({
      title: 'Moderation Test Event',
      creatorId: testApp.seed.adminUser.id,
      duration: [start, end] as [Date, Date],
    })
    .returning();
  await testApp.db
    .insert(schema.eventSignups)
    .values({ eventId: evt.id, userId });
  return { userId, eventId: evt.id };
}

async function fetchUser(userId: number) {
  return testApp.db.query.users.findFirst({
    where: eq(schema.users.id, userId),
  });
}

async function fetchActions(targetId: number, action?: string) {
  const rows = await testApp.db
    .select()
    .from(schema.adminActions)
    .where(eq(schema.adminActions.targetId, targetId));
  return action ? rows.filter((r) => r.action === action) : rows;
}

// ─── kick ────────────────────────────────────────────────────────────────────

describe('POST /users/:id/kick', () => {
  it('sets kicked_at, revokes refresh families, audits, preserves data', async () => {
    const { userId } = await seedMemberWithSignup('kicktarget');
    await seedActiveRefreshToken(userId);

    const res = await testApp.request
      .post(`/users/${userId}/kick`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'spamming' })
      .expect(201);
    expect(res.body.success).toBe(true);

    const user = await fetchUser(userId);
    expect(user?.kickedAt).not.toBeNull();
    expect(user?.kickReason).toBe('spamming');
    expect(user?.deactivatedAt).toBeNull(); // AC2 — kick preserves

    const active = await testApp.db
      .select()
      .from(schema.refreshTokens)
      .where(
        and(
          eq(schema.refreshTokens.userId, userId),
          isNull(schema.refreshTokens.revokedAt),
        ),
      );
    expect(active).toHaveLength(0);

    const signups = await testApp.db
      .select()
      .from(schema.eventSignups)
      .where(eq(schema.eventSignups.userId, userId));
    expect(signups.length).toBeGreaterThan(0); // signups untouched by kick

    expect(await fetchActions(userId, 'kick')).toHaveLength(1);
  });
});

// ─── ban ─────────────────────────────────────────────────────────────────────

describe('POST /users/:id/ban', () => {
  it('sets banned_at + deactivated_at, revokes, audits', async () => {
    const { userId } = await seedMemberWithSignup('bantarget');
    await seedActiveRefreshToken(userId);

    await testApp.request
      .post(`/users/${userId}/ban`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'abuse' })
      .expect(201);

    const user = await fetchUser(userId);
    expect(user?.bannedAt).not.toBeNull();
    expect(user?.banReason).toBe('abuse');
    expect(user?.deactivatedAt).not.toBeNull(); // ban deactivates

    const active = await testApp.db
      .select()
      .from(schema.refreshTokens)
      .where(
        and(
          eq(schema.refreshTokens.userId, userId),
          isNull(schema.refreshTokens.revokedAt),
        ),
      );
    expect(active).toHaveLength(0);
    expect(await fetchActions(userId, 'ban')).toHaveLength(1);
  });

  it('is idempotent — a repeat ban does not append a second audit row', async () => {
    const { userId } = await seedMemberWithSignup('doubleban');

    await testApp.request
      .post(`/users/${userId}/ban`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'first' })
      .expect(201);
    // Second attempt is rejected by the controller guard (already banned)…
    await testApp.request
      .post(`/users/${userId}/ban`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'second' })
      .expect(400);

    expect(await fetchActions(userId, 'ban')).toHaveLength(1);
  });
});

// ─── ban + wipe completeness ───────────────────────────────────────────────────

async function seedGame(tag: string): Promise<number> {
  const [g] = await testApp.db
    .insert(schema.games)
    .values({
      name: `Wipe ${tag}`,
      slug: `wipe-${tag}-${randomUUID().slice(0, 8)}`,
    })
    .returning();
  return g.id;
}

/** A community lineup created by `createdBy`, with one own entry. Returns its id. */
async function seedLineup(createdBy: number, gameId: number): Promise<number> {
  const [l] = await testApp.db
    .insert(schema.communityLineups)
    .values({
      title: 'L',
      status: 'building',
      visibility: 'private',
      createdBy,
      publicSlug: randomUUID().replace(/-/g, '').slice(0, 16),
    })
    .returning();
  await testApp.db
    .insert(schema.communityLineupEntries)
    .values({ lineupId: l.id, gameId, nominatedBy: createdBy });
  return l.id;
}

/**
 * Seed ≥1 row for the target across the WIPE manifest, INCLUDING the
 * community_lineups carry-over scenario (survivor lineup L2 whose entry was
 * carried over from the target's lineup L1) that regresses without the
 * carried_over_from null-out. Returns ids for the survivor assertions.
 *
 * `player_taste_vectors` / `player_intensity_snapshots` (pgvector + typed-jsonb)
 * and the deep community-lineup vote leaves are intentionally NOT seeded here:
 * they take the SAME uniform `DELETE ... WHERE <col> = userId` path as the seeded
 * by-column tables (asserted below) and cascade from the lineup delete; seeding
 * their exotic types / deep FK chains would add fragility, not coverage.
 */
async function seedFullWipeManifest(
  userId: number,
  eventId: number,
): Promise<{ otherId: number; l1Id: number; l2Id: number }> {
  const gameId = await seedGame(`${userId}`);
  const [other] = await testApp.db
    .insert(schema.users)
    .values({ discordId: `local:other-${userId}`, username: `other-${userId}` })
    .returning();
  const otherId = other.id;
  const now = new Date();

  await seedActiveRefreshToken(userId);
  await testApp.db.insert(schema.sessions).values({
    id: `sess-${userId}`,
    userId,
    expiresAt: new Date(Date.now() + 86_400_000),
  });
  await testApp.db.insert(schema.availability).values({
    userId,
    timeRange: [now, new Date(now.getTime() + 3_600_000)] as [Date, Date],
    status: 'available',
  });
  await testApp.db
    .insert(schema.eventTemplates)
    .values({ userId, name: 'T', config: { title: 'T', durationMinutes: 60 } });
  await testApp.db
    .insert(schema.characters)
    .values({ userId, gameId, name: 'Char' });
  await testApp.db
    .insert(schema.notifications)
    .values({ userId, type: 'new_event', title: 't', message: 'm' });
  await testApp.db
    .insert(schema.userNotificationPreferences)
    .values({ userId });
  await testApp.db
    .insert(schema.userPreferences)
    .values({ userId, key: 'show_activity', value: true });
  await testApp.db
    .insert(schema.gameTimeTemplates)
    .values({ userId, dayOfWeek: 0, startHour: 18 });
  await testApp.db
    .insert(schema.gameTimeOverrides)
    .values({ userId, date: '2026-07-01', hour: 18, status: 'available' });
  await testApp.db
    .insert(schema.gameTimeAbsences)
    .values({ userId, startDate: '2026-07-01', endDate: '2026-07-02' });
  await testApp.db
    .insert(schema.gameInterests)
    .values({ userId, gameId, source: 'manual' });
  await testApp.db
    .insert(schema.gameInterestSuppressions)
    .values({ userId, gameId });
  await testApp.db
    .insert(schema.feedback)
    .values({ userId, category: 'bug', message: 'x' });
  await testApp.db
    .insert(schema.wowClassicQuestProgress)
    .values({ eventId, userId, questId: 1 });
  await testApp.db.insert(schema.eventPlans).values({
    creatorId: userId,
    title: 'P',
    durationMinutes: 60,
    pollOptions: [],
    pollDurationHours: 24,
  });
  await testApp.db
    .insert(schema.eventRemindersSent)
    .values({ eventId, userId, reminderType: '24h' });
  await testApp.db
    .insert(schema.gameActivitySessions)
    .values({ userId, gameId, discordActivityName: 'X' });
  await testApp.db.insert(schema.gameActivityRollups).values({
    userId,
    gameId,
    period: 'week',
    periodStart: '2026-07-01',
    totalSeconds: 100,
  });

  const [lo, hi] = [userId, otherId].sort((a, b) => a - b);
  await testApp.db.insert(schema.playerCoPlay).values({
    userIdA: lo,
    userIdB: hi,
    sessionCount: 1,
    totalMinutes: 10,
    lastPlayedAt: now,
    gamesPlayed: [gameId],
  });

  // Carry-over RESTRICT scenario: L2 (survivor, owned by other) has an entry
  // carried over FROM the target's L1 — the back-ref that must be nulled first.
  // Distinct game so it doesn't collide with L2's own entry (uq lineup_id+game_id).
  const carryGameId = await seedGame(`carry-${userId}`);
  const l1Id = await seedLineup(userId, gameId);
  const l2Id = await seedLineup(otherId, gameId);
  await testApp.db.insert(schema.communityLineupEntries).values({
    lineupId: l2Id,
    gameId: carryGameId,
    nominatedBy: otherId,
    carriedOverFrom: l1Id,
  });

  return { otherId, l1Id, l2Id };
}

/** Assert every WIPE-manifest table has 0 rows for the target (manifest-driven). */
async function expectWipeManifestCleared(userId: number): Promise<void> {
  for (const { table, column } of WIPE_BY_COLUMN) {
    const rows = await testApp.db
      .select()
      .from(table)
      .where(eq(column, userId));
    expect({ table: getTableConfig(table).name, rows: rows.length }).toEqual({
      table: getTableConfig(table).name,
      rows: 0,
    });
  }
  const coplay = await testApp.db
    .select()
    .from(schema.playerCoPlay)
    .where(
      or(
        eq(schema.playerCoPlay.userIdA, userId),
        eq(schema.playerCoPlay.userIdB, userId),
      ),
    );
  expect(coplay).toHaveLength(0);
  const lineups = await testApp.db
    .select()
    .from(schema.communityLineups)
    .where(eq(schema.communityLineups.createdBy, userId));
  expect(lineups).toHaveLength(0);
}

describe('ban with wipeData — true data wipe (§9.6, §9.10 #2)', () => {
  it('clears every WIPE table for the target, keeps the users row + survivors', async () => {
    const { userId, eventId } = await seedMemberWithSignup('wipetarget');
    const { l2Id } = await seedFullWipeManifest(userId, eventId);

    await testApp.request
      .post(`/users/${userId}/ban`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'nuke', wipeData: true })
      .expect(201);

    await expectWipeManifestCleared(userId);

    const user = await fetchUser(userId); // users row survives
    expect(user).toBeDefined();
    expect(user?.bannedAt).not.toBeNull();

    // Survivor lineup L2 (owned by other) persists; its carried-over back-ref to
    // the target's deleted L1 was nulled (FIX: carried_over_from RESTRICT).
    const survivor = await testApp.db
      .select()
      .from(schema.communityLineups)
      .where(eq(schema.communityLineups.id, l2Id));
    expect(survivor).toHaveLength(1);
    const l2Entries = await testApp.db
      .select()
      .from(schema.communityLineupEntries)
      .where(eq(schema.communityLineupEntries.lineupId, l2Id));
    expect(l2Entries.length).toBeGreaterThan(0);
    expect(l2Entries.every((e) => e.carriedOverFrom === null)).toBe(true);

    const [banRow] = await fetchActions(userId, 'ban');
    expect(JSON.parse(banRow.metadata ?? '{}').dataWiped).toBe(true);
  });
});

// ─── admin protection ──────────────────────────────────────────────────────────

describe('moderation admin-protection guards', () => {
  it('rejects kicking yourself (400)', async () => {
    await testApp.request
      .post(`/users/${testApp.seed.adminUser.id}/kick`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({})
      .expect(400);
  });

  it('rejects banning another admin (403)', async () => {
    const { userId } = await createMemberAndLogin(
      testApp,
      'otheradmin',
      'oa@test.local',
    );
    await testApp.db
      .update(schema.users)
      .set({ role: 'admin' })
      .where(eq(schema.users.id, userId));
    await testApp.request
      .post(`/users/${userId}/ban`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({})
      .expect(403);
  });

  it('rejects moderating a missing user (404)', async () => {
    await testApp.request
      .post('/users/9999999/kick')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({})
      .expect(404);
  });
});

// ─── audit history pagination ────────────────────────────────────────────────

describe('GET /users/:id/admin-actions', () => {
  it('returns paginated audit history newest-first', async () => {
    const { userId } = await createMemberAndLogin(
      testApp,
      'audituser',
      'au@test.local',
    );
    // kick → unkick → kick → unkick → ban == 5 audit rows.
    const auth = { Authorization: `Bearer ${adminToken}` };
    await testApp.request
      .post(`/users/${userId}/kick`)
      .set(auth)
      .send({})
      .expect(201);
    await testApp.request
      .post(`/users/${userId}/unkick`)
      .set(auth)
      .send({})
      .expect(201);
    await testApp.request
      .post(`/users/${userId}/kick`)
      .set(auth)
      .send({})
      .expect(201);
    await testApp.request
      .post(`/users/${userId}/unkick`)
      .set(auth)
      .send({})
      .expect(201);
    await testApp.request
      .post(`/users/${userId}/ban`)
      .set(auth)
      .send({})
      .expect(201);

    const res = await testApp.request
      .get(`/users/${userId}/admin-actions?page=1&limit=2`)
      .set(auth)
      .expect(200);
    expect(res.body.meta.total).toBe(5);
    expect(res.body.meta.hasMore).toBe(true);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0].action).toBe('ban'); // newest first
    expect(res.body.data[0].targetUsername).toBe('audituser');
  });
});

// ─── AC12 delete-atomicity ─────────────────────────────────────────────────────

describe('deleteUserTransaction atomicity (AC12, §9.10 #1)', () => {
  it('rolls back the whole wipe when a later step fails', async () => {
    const { userId } = await createMemberAndLogin(
      testApp,
      'atomicuser',
      'atomic@test.local',
    );
    await seedActiveRefreshToken(userId);
    // A user-created event forces the events-reassign step to hit an FK violation
    // when we pass a non-existent reassign target — proving wipe ran INSIDE the tx.
    const start = new Date(Date.now() + 86_400_000);
    await testApp.db.insert(schema.events).values({
      title: 'Owned Event',
      creatorId: userId,
      duration: [start, new Date(start.getTime() + 3_600_000)] as [Date, Date],
    });

    await expect(
      deleteUserTransaction(testApp.db, userId, 9_999_999),
    ).rejects.toThrow();

    // Rollback: the user and their refresh token still exist.
    expect(await fetchUser(userId)).toBeDefined();
    const tokens = await testApp.db
      .select()
      .from(schema.refreshTokens)
      .where(eq(schema.refreshTokens.userId, userId));
    expect(tokens.length).toBeGreaterThan(0);
  });
});
