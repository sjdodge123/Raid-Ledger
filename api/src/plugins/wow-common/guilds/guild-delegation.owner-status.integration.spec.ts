/**
 * ROK-2160 (Codex P1) — a deactivated owner's character stops holding its
 * roster row by GUID, so the row's Blizzard-id character wins it instead; on
 * reactivation the GUID holder wins it back. A ROK-1794 member grant must
 * never move to another user without a staff action, in either direction:
 *   1. deactivate A → B (Blizzard-id winner) does NOT inherit A's grant;
 *   2. ban A → same;
 *   3. mirror: staff grant B while A is away, A comes back → A does NOT
 *      inherit B's grant;
 *   4. control: A away and back with no grant meanwhile → A's own earlier
 *      grant still holds.
 *
 * Timestamps sit DAYS apart: `characters.created_at` / `deactivated_at` are
 * naive timestamps compared against timestamptz grants and audits.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import { waitFor } from '../../../common/testing/integration-helpers';
import { getTestApp, type TestApp } from '../../../common/testing/test-app';
import { nonEmpty } from '../../../common/testing/narrow';
import * as schema from '../../../drizzle/schema';
import { DiscordNotificationService } from '../../../notifications/discord-notification.service';
import { UsersService } from '../../../users/users.service';
import { UsersModerationService } from '../../../users/users-moderation.service';
import { reactivateOnGuildRejoin } from '../../../users/users-reactivate.helpers';
import { PluginRegistryService } from '../../plugin-host/plugin-registry.service';
import {
  auditOwnerReactivated,
  lockDeactivatedAt,
} from '../addon-import/external-id.owner-status';
import { hasConfirmedMemberGrant } from './guild-delegation.helpers';
import { findLinkedMemberRows } from './guild-membership.helpers';

const FOREVER_SLUG = 'world-of-warcraft-forever';
const DAY = 86_400_000;
const NOW = Date.now();
const T0 = new Date(NOW - 8 * DAY); // characters created
const T1 = new Date(NOW - 6 * DAY); // A's grant / A deactivated (mirror)
const T2 = new Date(NOW - 4 * DAY); // staff grant B while A is away
const SNAP = new Date(NOW - DAY);

let testApp: TestApp;
let foreverId: number;
let seq = 0;
const next = (): number => {
  seq += 1;
  return seq;
};

async function ensureGame(): Promise<number> {
  const [found] = await testApp.db
    .select({ id: schema.games.id })
    .from(schema.games)
    .where(eq(schema.games.slug, FOREVER_SLUG));
  if (found) return found.id;
  const [made] = nonEmpty(
    await testApp.db
      .insert(schema.games)
      .values({ name: 'World of Warcraft: Forever', slug: FOREVER_SLUG })
      .returning({ id: schema.games.id }),
    'game',
  );
  return made.id;
}

async function insertGuild(): Promise<number> {
  const name = `Owner Status 2160 ${next()}`;
  const [g] = nonEmpty(
    await testApp.db
      .insert(schema.guilds)
      .values({
        gameId: foreverId,
        region: 'us',
        name,
        nameKey: name.toLowerCase(),
        source: 'addon_import',
        lastSnapshotAt: SNAP,
      })
      .returning({ id: schema.guilds.id }),
    'guild',
  );
  return g.id;
}

async function insertUser(): Promise<number> {
  const n = next();
  const [u] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({
        discordId: `local:owner-status-2160-${n}@test`,
        username: `OwnerStatus2160_${n}`,
        role: 'member',
      })
      .returning({ id: schema.users.id }),
    'user',
  );
  return u.id;
}

async function insertChar(
  userId: number,
  o: { externalId?: string; addonGuid?: string },
): Promise<string> {
  const [c] = nonEmpty(
    await testApp.db
      .insert(schema.characters)
      .values({
        userId,
        gameId: foreverId,
        name: `OwnerChar${next()}`,
        role: 'dps',
        isMain: false,
        region: 'us',
        externalId: o.externalId ?? null,
        addonGuid: o.addonGuid ?? null,
        createdAt: T0,
      })
      .returning({ id: schema.characters.id }),
    'character',
  );
  return c.id;
}

async function insertRow(
  guildId: number,
  guid: string,
  blizzardId: number,
): Promise<number> {
  const [m] = nonEmpty(
    await testApp.db
      .insert(schema.guildMembers)
      .values({
        guildId,
        guid,
        blizzardCharacterId: blizzardId,
        characterName: `OwnerRow${next()}`,
        rankIndex: 3,
        rankName: 'Member',
        source: 'addon_import',
        lastSeenAt: SNAP,
      })
      .returning({ id: schema.guildMembers.id }),
    'member row',
  );
  return m.id;
}

async function grant(guildId: number, memberId: number, at: Date) {
  await testApp.db.insert(schema.guildEditors).values({
    guildId,
    kind: 'member',
    guildMemberId: memberId,
    createdAt: at,
  });
}

/**
 * Row R (GUID G + Blizzard id X): A's character holds G and wins R; B's
 * Armory character (external_id X, created before any grant) is suppressed.
 */
async function seed(grantAt: Date | null) {
  const guildId = await insertGuild();
  const id = 920_000_000 + next();
  const guid = `Player-2160-${next()}`;
  const memberId = await insertRow(guildId, guid, id);
  const ownerA = await insertUser();
  const charA = await insertChar(ownerA, { addonGuid: guid });
  const ownerB = await insertUser();
  const charB = await insertChar(ownerB, { externalId: String(id) });
  if (grantAt) await grant(guildId, memberId, grantAt);
  return { guildId, memberId, ownerA, charA, ownerB, charB };
}

type Seed = Awaited<ReturnType<typeof seed>>;

/** The user's link to R through `via`, failing loudly otherwise. */
async function linkVia(userId: number, s: Seed, via: 'guid' | 'blizzard') {
  const rows = await findLinkedMemberRows(testApp.db, userId, s.guildId);
  expect(rows.map((r) => [r.via, r.memberId])).toEqual([[via, s.memberId]]);
  return rows;
}

async function granted(userId: number, s: Seed, via: 'guid' | 'blizzard') {
  const rows = await linkVia(userId, s, via);
  return hasConfirmedMemberGrant(testApp.db, s.guildId, rows);
}

async function linkAudits(ownerId: number) {
  return testApp.db
    .select()
    .from(schema.activityLog)
    .where(
      and(
        eq(schema.activityLog.entityType, 'addon_guid'),
        inArray(schema.activityLog.action, [
          'addon_guid_claimed',
          'external_id_linked',
        ]),
        eq(schema.activityLog.entityId, ownerId),
      ),
    );
}

const deactivate = (userId: number) =>
  testApp.app.get(DiscordNotificationService).deactivateUser(userId, 'manual');
const ban = async (userId: number) => {
  const res = await testApp.app
    .get(UsersModerationService)
    .banUser(testApp.seed.adminUser.id, userId, {
      wipeData: false,
      kickFromDiscord: false,
    });
  expect(res.success).toBe(true);
};
const reactivate = (userId: number) =>
  testApp.app.get(UsersService).reactivateUser(userId);

/** B's grant-inheritance check after A stops holding R. */
async function expectBNotGranted(s: Seed): Promise<void> {
  expect(await granted(s.ownerB, s, 'blizzard')).toBe(false);
  const audits = await linkAudits(s.ownerB);
  expect(audits.map((a) => [a.action, a.metadata])).toEqual([
    [
      'external_id_linked',
      expect.objectContaining({ characterId: s.charB, via: 'guid_released' }),
    ],
  ]);
}

/**
 * A away since T1 (backdated, with B's release audit), then staff grant B
 * at T2 inside the away window — B holds the grant.
 */
async function awayWhileStaffGrantsB(s: Seed): Promise<void> {
  await deactivate(s.ownerA);
  // Move the away window into the past so the staff grant sits inside it.
  await testApp.db
    .update(schema.users)
    .set({ deactivatedAt: T1 })
    .where(eq(schema.users.id, s.ownerA));
  await testApp.db
    .update(schema.activityLog)
    .set({ createdAt: T1 })
    .where(
      and(
        eq(schema.activityLog.entityType, 'addon_guid'),
        eq(schema.activityLog.entityId, s.ownerB),
      ),
    );
  await grant(s.guildId, s.memberId, T2);
  expect(await granted(s.ownerB, s, 'blizzard')).toBe(true);
}

/** A won R back but not B's grant: one `owner_reactivated` audit. */
async function expectANotGranted(s: Seed): Promise<void> {
  expect(await granted(s.ownerA, s, 'guid')).toBe(false);
  const audits = await linkAudits(s.ownerA);
  expect(audits.map((a) => [a.action, a.metadata])).toEqual([
    [
      'addon_guid_claimed',
      expect.objectContaining({
        characterId: s.charA,
        via: 'owner_reactivated',
      }),
    ],
  ]);
}

beforeAll(async () => {
  testApp = await getTestApp();
  const registry = testApp.app.get(PluginRegistryService);
  await registry.ensureInstalled('blizzard');
  await registry.activate('blizzard');
  foreverId = await ensureGame();
});

// No truncate here: the shared integration setup closes the pool in its own
// afterAll, and the next spec truncates in beforeAll.

describe('ROK-2160 Codex P1: a member grant never changes hands without staff', () => {
  it('1. A is deactivated: B (now the Blizzard-id winner) does not inherit A grant', async () => {
    const s = await seed(T1);
    expect(await granted(s.ownerA, s, 'guid')).toBe(true);
    await deactivate(s.ownerA);
    await expectBNotGranted(s);
  });

  it('2. A is banned: B does not inherit A grant', async () => {
    const s = await seed(T1);
    expect(await granted(s.ownerA, s, 'guid')).toBe(true);
    await ban(s.ownerA);
    await expectBNotGranted(s);
  });

  it('3. mirror: A comes back after staff granted B; A does not inherit B grant', async () => {
    const s = await seed(null);
    await awayWhileStaffGrantsB(s);
    await reactivate(s.ownerA);
    await expectANotGranted(s);
  });

  it('4. control: A away and back with no grant meanwhile keeps A own grant', async () => {
    const s = await seed(T1);
    await deactivate(s.ownerA);
    await reactivate(s.ownerA);
    expect(await granted(s.ownerA, s, 'guid')).toBe(true);
    expect(await linkAudits(s.ownerA)).toEqual([]);
  });
});

async function discordIdOf(userId: number): Promise<string> {
  const [u] = nonEmpty(
    await testApp.db
      .select({ discordId: schema.users.discordId })
      .from(schema.users)
      .where(eq(schema.users.id, userId)),
    'user',
  );
  if (u.discordId === null) throw new Error(`user ${userId} has no discordId`);
  return u.discordId;
}

async function userState(userId: number) {
  const [u] = nonEmpty(
    await testApp.db
      .select({
        deactivatedAt: schema.users.deactivatedAt,
        bannedAt: schema.users.bannedAt,
      })
      .from(schema.users)
      .where(eq(schema.users.id, userId)),
    'user',
  );
  return u;
}

/** Backends of this database blocked on a row lock right now. */
async function lockWaiters(): Promise<number> {
  const rows = await testApp.db.execute<{ n: number }>(
    sql`select count(*)::int as n from pg_stat_activity
        where datname = current_database() and wait_event_type = 'Lock'`,
  );
  return Number(rows[0]?.n ?? 0);
}

const rejoin = async (userId: number) =>
  reactivateOnGuildRejoin(testApp.db, await discordIdOf(userId));

describe('ROK-2160 guild rejoin path (reactivateOnGuildRejoin)', () => {
  it('7. a banned rejoiner stays deactivated and wins nothing back', async () => {
    const s = await seed(T1);
    await ban(s.ownerA);
    expect(await rejoin(s.ownerA)).toBeUndefined();
    expect((await userState(s.ownerA)).deactivatedAt).not.toBeNull();
    expect(await linkAudits(s.ownerA)).toEqual([]);
    await expectBNotGranted(s);
  });

  it('8. rejoin after staff granted B: A does not inherit B grant', async () => {
    const s = await seed(null);
    await awayWhileStaffGrantsB(s);
    expect(await rejoin(s.ownerA)).toBeDefined();
    await expectANotGranted(s);
  });

  it('5. a ban that commits while rejoin waits on the row lock keeps the user deactivated', async () => {
    const s = await seed(T1);
    await deactivate(s.ownerA);
    const discordId = await discordIdOf(s.ownerA);
    let pending: ReturnType<typeof reactivateOnGuildRejoin> | undefined;
    await testApp.db.transaction(async (tx) => {
      await tx
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.id, s.ownerA))
        .for('update');
      pending = reactivateOnGuildRejoin(testApp.db, discordId);
      await waitFor(
        async () => expect(await lockWaiters()).toBeGreaterThan(0),
        5000,
      );
      await tx
        .update(schema.users)
        .set({ bannedAt: sql`NOW()` })
        .where(eq(schema.users.id, s.ownerA));
    });
    if (!pending) throw new Error('rejoin never started');
    expect(await pending).toBeUndefined();
    const after = await userState(s.ownerA);
    expect(after.bannedAt).not.toBeNull();
    expect(after.deactivatedAt).not.toBeNull();
  });
});

describe('ROK-2160 away window under a non-UTC session time zone', () => {
  it('6. a grant made 2h into the away window is caught when the session is UTC+14', async () => {
    const s = await seed(null);
    const grantAt = new Date(T1.getTime() + 2 * 3_600_000);
    const written = await testApp.db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL TIME ZONE 'Pacific/Kiritimati'`);
      // What NOW() writes in this session: the +14 wall clock, naive.
      await tx
        .update(schema.users)
        .set({
          deactivatedAt: sql`(${T1.toISOString()}::timestamptz)::timestamp`,
        })
        .where(eq(schema.users.id, s.ownerA));
      await tx.insert(schema.guildEditors).values({
        guildId: s.guildId,
        kind: 'member',
        guildMemberId: s.memberId,
        createdAt: grantAt,
      });
      const since = await lockDeactivatedAt(tx, s.ownerA);
      if (typeof since !== 'string') throw new Error('A has no deactivated_at');
      await tx
        .update(schema.users)
        .set({ deactivatedAt: null })
        .where(eq(schema.users.id, s.ownerA));
      return auditOwnerReactivated(tx, s.ownerA, since, null);
    });
    expect(written).toBe(1);
  });
});

describe('ROK-2160 sweep guard and repeated cycles', () => {
  it('9. sweep: a user seen after the member fetch is not deactivated and nothing is audited', async () => {
    const s = await seed(T1);
    await testApp.db
      .update(schema.users)
      .set({ guildMemberSeenAt: new Date(NOW - DAY) })
      .where(eq(schema.users.id, s.ownerA));
    await testApp.app
      .get(DiscordNotificationService)
      .deactivateUser(s.ownerA, 'reconciliation-sweep', {
        seenBefore: new Date(NOW - 2 * DAY),
      });
    expect((await userState(s.ownerA)).deactivatedAt).toBeNull();
    expect(await linkAudits(s.ownerB)).toEqual([]);
    expect(await granted(s.ownerA, s, 'guid')).toBe(true);
  });

  it('10. two away-and-back cycles with no grant meanwhile keep A own grant', async () => {
    const s = await seed(T1);
    for (let i = 0; i < 2; i += 1) {
      await deactivate(s.ownerA);
      expect(await granted(s.ownerB, s, 'blizzard')).toBe(false);
      await reactivate(s.ownerA);
    }
    expect(await granted(s.ownerA, s, 'guid')).toBe(true);
    expect(await linkAudits(s.ownerA)).toEqual([]);
    const released = await linkAudits(s.ownerB);
    expect(released.map((a) => a.action)).toEqual([
      'external_id_linked',
      'external_id_linked',
    ]);
  });
});
