/**
 * Moderation integration tests (ROK-313) — real DB via Testcontainers.
 *
 * Covers the api/users domain: kick / ban / unban endpoints + audit + refresh
 * revoke + the true data-wipe + delete-atomicity. Auth-time lockout (jwt.strategy
 * 401 on a banned/kicked token) is owned by the auth agent and lives in the auth
 * suite; here we assert the DB state + audit + endpoint contract that the auth
 * enforcement reads from.
 *
 * The wipe-completeness seed is a CURATED representative set (Phase-A RESTRICT +
 * cascade leaves + the player_co_play dual-column special case). Exhaustive
 * classification of every FK-to-users table is guaranteed by the schema-driven
 * drift guard in `users-delete.helpers.drift.spec.ts`; this test proves the
 * DELETE mechanism + special-case predicates actually clear rows against Postgres.
 */
import { randomUUID } from 'crypto';
import { and, eq, isNull, or } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../common/testing/integration-helpers';
import { createMemberAndLogin } from '../events/signups.integration.spec-helpers';
import * as schema from '../drizzle/schema';
import { deleteUserTransaction } from './users-delete.helpers';

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

async function seedWipeManifestRows(userId: number): Promise<number> {
  await seedActiveRefreshToken(userId);
  await testApp.db.insert(schema.userPreferences).values({
    userId,
    key: 'show_activity',
    value: true,
  });
  await testApp.db
    .insert(schema.feedback)
    .values({ userId, category: 'bug', message: 'x' });
  const start = new Date();
  const end = new Date(Date.now() + 3_600_000);
  await testApp.db.insert(schema.availability).values({
    userId,
    timeRange: [start, end] as [Date, Date],
    status: 'available',
  });
  await testApp.db.insert(schema.eventTemplates).values({
    userId,
    name: 'T',
    config: { title: 'T', durationMinutes: 60 },
  });
  // player_co_play (dual-column special): a co-play row with another user.
  const [other] = await testApp.db
    .insert(schema.users)
    .values({
      discordId: `local:coplay-${userId}`,
      username: `coplay-${userId}`,
    })
    .returning();
  const [lo, hi] = [userId, other.id].sort((a, b) => a - b);
  await testApp.db.insert(schema.playerCoPlay).values({
    userIdA: lo,
    userIdB: hi,
    sessionCount: 1,
    totalMinutes: 10,
    lastPlayedAt: new Date(),
    gamesPlayed: [1],
  });
  return other.id;
}

describe('ban with wipeData — true data wipe (§9.6)', () => {
  it('deletes user-owned rows, keeps the users row with banned_at', async () => {
    const { userId } = await seedMemberWithSignup('wipetarget');
    await seedWipeManifestRows(userId);

    await testApp.request
      .post(`/users/${userId}/ban`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'nuke', wipeData: true })
      .expect(201);

    const counts = await Promise.all([
      testApp.db
        .select()
        .from(schema.refreshTokens)
        .where(eq(schema.refreshTokens.userId, userId)),
      testApp.db
        .select()
        .from(schema.userPreferences)
        .where(eq(schema.userPreferences.userId, userId)),
      testApp.db
        .select()
        .from(schema.feedback)
        .where(eq(schema.feedback.userId, userId)),
      testApp.db
        .select()
        .from(schema.availability)
        .where(eq(schema.availability.userId, userId)),
      testApp.db
        .select()
        .from(schema.eventTemplates)
        .where(eq(schema.eventTemplates.userId, userId)),
      testApp.db
        .select()
        .from(schema.eventSignups)
        .where(eq(schema.eventSignups.userId, userId)),
      testApp.db
        .select()
        .from(schema.playerCoPlay)
        .where(
          or(
            eq(schema.playerCoPlay.userIdA, userId),
            eq(schema.playerCoPlay.userIdB, userId),
          ),
        ),
    ]);
    for (const rows of counts) expect(rows).toHaveLength(0);

    const user = await fetchUser(userId); // users row survives
    expect(user).toBeDefined();
    expect(user?.bannedAt).not.toBeNull();

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
