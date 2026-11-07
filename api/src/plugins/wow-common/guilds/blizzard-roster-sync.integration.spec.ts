/**
 * ROK-1928 §E "B integration" — the Forever Blizzard roster sync against the
 * real DB with a stubbed `BlizzardService.fetchForeverGuildRoster`. The guild
 * is seeded by a real LedgerLink import (harness from
 * `addon-import-guild-dings.integration.spec.ts`). Fleet-only.
 */
import type * as SentryModule from '@sentry/nestjs';
import * as bcrypt from 'bcrypt';
import { and, count, desc, eq, isNotNull } from 'drizzle-orm';
import { BadGatewayException } from '@nestjs/common';
import type { AddonGuildMember } from '@raid-ledger/contract';
import { getTestApp, type TestApp } from '../../../common/testing/test-app';
import { truncateAllTables } from '../../../common/testing/integration-helpers';
import { nonEmpty } from '../../../common/testing/narrow';
import * as schema from '../../../drizzle/schema';
import { PluginRegistryService } from '../../plugin-host/plugin-registry.service';
import { ROSTER_FLAG_TITLE } from '../addon-import/addon-import-guild.flag';
import { ROSTER_AUDIT_ACTION } from '../addon-import/addon-import-guild.guard';
import {
  FIXTURE_EXPORTED_AT,
  buildGuildPayload,
  buildImportString,
  buildMember,
} from '../addon-import/testing/addon-fixture.builder';
import { pinExportClock } from '../addon-import/testing/pin-export-clock';
import type { ForeverGuildMember } from '../blizzard-forever-guild.helpers';
import { BlizzardService } from '../blizzard.service';
import { BlizzardRosterSyncService } from './blizzard-roster-sync.service';
import { inLatestSnapshot } from './guild-membership.helpers';

/**
 * Spy on the live CJS module, NOT `jest.mock`: `setupFilesAfterEnv` loads
 * AppModule → this service → the real `@sentry/nestjs` before a hoisted
 * `jest.mock` registers, so a module mock never reaches the service (same
 * trap as `game-role-reconcile.integration.spec.ts`).
 */
const sentry = jest.requireActual<typeof SentryModule>('@sentry/nestjs');
const captureException = jest.spyOn(sentry, 'captureException');

pinExportClock();

const FOREVER_SLUG = 'world-of-warcraft-forever';
let testApp: TestApp;
let gameId: number;
let fetchSpy: jest.SpyInstance;

/** Importer (FIXTURE_GUID) + Member1..n-1, all level 60 unless overridden. */
const addonRoster = (n: number, level = 60): AddonGuildMember[] => [
  buildMember(0xabcdef0, { name: 'Ana' }),
  ...Array.from({ length: n - 1 }, (_, i) => buildMember(i + 1, { level })),
];
const apiMember = (name: string, level = 60): ForeverGuildMember => ({
  name,
  level,
  classId: 8,
  rank: 3,
  blizzardId: null,
});

async function ensureGame(): Promise<number> {
  const [found] = await testApp.db
    .select()
    .from(schema.games)
    .where(eq(schema.games.slug, FOREVER_SLUG));
  if (found) return found.id;
  const values = { name: 'World of Warcraft: Forever', slug: FOREVER_SLUG };
  const rows = await testApp.db.insert(schema.games).values(values).returning();
  return nonEmpty(rows, 'forever game')[0].id;
}

async function setup(): Promise<void> {
  gameId = await ensureGame();
  const registry = testApp.app.get(PluginRegistryService);
  await registry.ensureInstalled('blizzard');
  await registry.activate('blizzard');
}

async function importer(): Promise<{ token: string; charId: string }> {
  const email = `gm${Date.now()}@test.local`;
  const [user] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({ discordId: `local:${email}`, username: 'gm', role: 'member' })
      .returning(),
    'user',
  );
  const passwordHash = await bcrypt.hash('TestPassword123!', 4);
  await testApp.db
    .insert(schema.localCredentials)
    .values({ email, passwordHash, userId: user.id });
  const auth = await testApp.request
    .post('/auth/local')
    .send({ email, password: 'TestPassword123!' });
  const token = auth.body.access_token as string;
  const char = await testApp.request
    .post('/users/me/characters')
    .set('Authorization', `Bearer ${token}`)
    .send({
      gameId,
      name: 'Ana Forever',
      class: 'Paladin',
      region: 'us',
      ruleset: 'normal',
    });
  expect(char.status).toBe(201);
  return { token, charId: char.body.id as string };
}

type Who = Awaited<ReturnType<typeof importer>>;

async function addonImport(who: Who, members: AddonGuildMember[], step = 0) {
  const payload = buildGuildPayload(members);
  payload.data.snapshotAt += step * 60;
  return testApp.request
    .post(`/plugins/wow/characters/${who.charId}/addon-import`)
    .set('Authorization', `Bearer ${who.token}`)
    .send({ importString: buildImportString(payload), dryRun: false });
}

/** Seed a Forever guild by addon import and give it a Blizzard slug. */
async function seedGuild(members: AddonGuildMember[]) {
  const who = await importer();
  expect((await addonImport(who, members)).status).toBe(200);
  const [guild] = nonEmpty(
    await testApp.db
      .update(schema.guilds)
      .set({ guildSlug: 'night-shift' })
      .returning(),
    'guild',
  );
  return { who, guild };
}

const sync = (guildId: number) =>
  testApp.app.get(BlizzardRosterSyncService).syncForeverGuildRoster(guildId);
const stubRoster = (members: ForeverGuildMember[]) =>
  fetchSpy.mockResolvedValue({ members });

async function liveNames(guildId: number): Promise<string[]> {
  const rows = await testApp.db
    .select({ name: schema.guildMembers.characterName })
    .from(schema.guildMembers)
    .innerJoin(schema.guilds, eq(schema.guilds.id, schema.guildMembers.guildId))
    .where(and(eq(schema.guildMembers.guildId, guildId), inLatestSnapshot()));
  return rows.map((r) => r.name).sort();
}

const allRows = () => testApp.db.select().from(schema.guildMembers);
const guildRow = async (id: number) =>
  nonEmpty(
    await testApp.db
      .select()
      .from(schema.guilds)
      .where(eq(schema.guilds.id, id)),
    'guild row',
  )[0];
const auditCount = async (): Promise<number> => {
  const [row] = await testApp.db
    .select({ n: count() })
    .from(schema.activityLog)
    .where(eq(schema.activityLog.action, ROSTER_AUDIT_ACTION));
  return row?.n ?? 0;
};

/**
 * The sync stamps real wall-clock time while fixture exports are pinned to
 * 2026-09-21, so no export could ever be newer than it. Move the sync's
 * instant T back to seed + `secs` so a later export is NEWER (review MAJOR).
 */
async function rewindSync(guildId: number, secs: number): Promise<void> {
  const t = (await guildRow(guildId)).lastSnapshotAt;
  if (t === null) throw new Error('sync stamped no snapshot');
  const to = new Date((FIXTURE_EXPORTED_AT + secs) * 1000);
  const m = schema.guildMembers;
  await testApp.db
    .update(m)
    .set({ lastSeenAt: to })
    .where(and(eq(m.guildId, guildId), eq(m.lastSeenAt, t)));
  await testApp.db
    .update(schema.guilds)
    .set({ lastSnapshotAt: to, blizzardRosterSyncedAt: to })
    .where(eq(schema.guilds.id, guildId));
}

const lastAudit = async () => {
  const rows = await testApp.db
    .select()
    .from(schema.activityLog)
    .where(eq(schema.activityLog.action, ROSTER_AUDIT_ACTION))
    .orderBy(desc(schema.activityLog.id))
    .limit(1);
  return nonEmpty(rows, 'roster audit')[0].metadata;
};

/** The columns a sync must never touch on an existing row (review MINOR 12). */
async function untouchedCols(ids: readonly number[]) {
  return (await allRows())
    .filter((r) => ids.includes(r.id))
    .sort((a, b) => a.id - b.id)
    .map((r) => ({
      id: r.id,
      guid: r.guid,
      publicNote: r.publicNote,
      onlineAtExport: r.onlineAtExport,
      lastOnlineDays: r.lastOnlineDays,
      capturedByUserId: r.capturedByUserId,
      source: r.source,
    }));
}

/** API view of the 5-member seed minus Member4, plus a newcomer. */
const fourPlusOne = () => [
  apiMember('Ana'),
  apiMember('Member1'),
  apiMember('Member2'),
  apiMember('Member3'),
  apiMember('Newbie'),
];

beforeAll(async () => {
  testApp = await getTestApp();
});

beforeEach(async () => {
  await setup();
  fetchSpy = jest.spyOn(
    testApp.app.get(BlizzardService),
    'fetchForeverGuildRoster',
  );
  captureException.mockClear();
  captureException.mockReturnValue('event-id');
});

afterAll(() => {
  captureException.mockRestore();
});

afterEach(async () => {
  fetchSpy.mockRestore();
  process.env.THROTTLE_DISABLED = 'true';
  testApp.seed = await truncateAllTables(testApp.db);
});

describe('ROK-1928 — Forever guild roster sync from Blizzard', () => {
  it('(1) 4 of 5 + 1 new → 5 live, 1 not live, 0 deleted, no deactivation', async () => {
    const { guild } = await seedGuild(addonRoster(5));
    const ids = (await allRows()).map((r) => r.id);
    expect(ids).toHaveLength(5);
    const before = await untouchedCols(ids);
    stubRoster(fourPlusOne());
    expect((await sync(guild.id)).status).toBe('ok');
    expect(await untouchedCols(ids)).toEqual(before);
    expect(await liveNames(guild.id)).toEqual(
      ['Ana', 'Member1', 'Member2', 'Member3', 'Newbie'].sort(),
    );
    expect(await allRows()).toHaveLength(6);
    const deactivated = await testApp.db
      .select()
      .from(schema.users)
      .where(isNotNull(schema.users.deactivatedAt));
    expect(deactivated).toEqual([]);
    const stored = await guildRow(guild.id);
    expect([stored.blizzardRosterStatus, stored.memberCount]).toEqual([
      'ok',
      5,
    ]);
    expect(stored.blizzardRosterSyncedAt).toEqual(stored.lastSnapshotAt);
  });

  it('(2) parity: the same delta via addon re-import and via sync → same live set', async () => {
    const delta = [...addonRoster(4), buildMember(99, { name: 'Newbie' })];
    const a = await seedGuild(addonRoster(5));
    expect((await addonImport(a.who, delta, 5)).status).toBe(200);
    const viaAddon = await liveNames(a.guild.id);
    testApp.seed = await truncateAllTables(testApp.db);
    await setup();
    const b = await seedGuild(addonRoster(5));
    stubRoster(fourPlusOne());
    await sync(b.guild.id);
    expect(await liveNames(b.guild.id)).toEqual(viaAddon);
  });

  it('(3) sync then addon import of the same roster demotes nobody twice', async () => {
    const { who, guild } = await seedGuild(addonRoster(5));
    stubRoster(fourPlusOne());
    await sync(guild.id);
    const live = await liveNames(guild.id);
    const audits = await auditCount();
    const res = await addonImport(who, addonRoster(4), 5);
    expect([res.status, res.body.status]).toEqual([200, 'stale']);
    expect(await liveNames(guild.id)).toEqual(live);
    expect(await auditCount()).toBe(audits);
  });

  it('(4) a Blizzard-only row adopts the GUID of a later addon import → one row', async () => {
    const { who, guild } = await seedGuild(addonRoster(2));
    await testApp.db.insert(schema.guildMembers).values({
      guildId: guild.id,
      guid: null,
      characterName: 'Member7',
      level: 60,
      source: 'blizzard',
      lastSeenAt: guild.lastSnapshotAt,
    });
    const next = [...addonRoster(2), buildMember(7)];
    expect((await addonImport(who, next, 5)).status).toBe(200);
    const rows = (await allRows()).filter((r) => r.characterName === 'Member7');
    expect(rows.map((r) => [r.guid, r.source])).toEqual([
      [buildMember(7).guid, 'addon_import'],
    ]);
  });

  it('(5) 404 → status not_found, addon roster stays live', async () => {
    const { guild } = await seedGuild(addonRoster(5));
    fetchSpy.mockResolvedValue(null);
    expect(await sync(guild.id)).toEqual({ status: 'not_found' });
    expect(await liveNames(guild.id)).toHaveLength(5);
    const stored = await guildRow(guild.id);
    expect(stored.blizzardRosterStatus).toBe('not_found');
    expect(stored.lastSnapshotAt).toEqual(guild.lastSnapshotAt);
  });

  it('(6) upstream 502 → nothing written, status error, Sentry tagged', async () => {
    const { guild } = await seedGuild(addonRoster(5));
    fetchSpy.mockRejectedValue(new BadGatewayException('upstream'));
    await expect(sync(guild.id)).rejects.toThrow('upstream');
    const stored = await guildRow(guild.id);
    expect(stored.blizzardRosterStatus).toBe('error');
    expect(stored.lastSnapshotAt).toEqual(guild.lastSnapshotAt);
    expect(await liveNames(guild.id)).toHaveLength(5);
    expect(captureException).toHaveBeenCalledWith(expect.any(Error), {
      tags: { guildId: String(guild.id), region: guild.region },
    });
  });

  it('(7) a mass drop (≥5 and >25%) posts the staff flag', async () => {
    const { guild } = await seedGuild(addonRoster(8));
    stubRoster([apiMember('Ana'), apiMember('Member1')]);
    await sync(guild.id);
    const flags = await testApp.db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.title, ROSTER_FLAG_TITLE));
    expect(flags.length).toBeGreaterThan(0);
    expect(flags[0]?.payload).toMatchObject({ guildId: guild.id, removed: 6 });
  });

  it('(8) level 58 → 60 logs one ding', async () => {
    const { guild } = await seedGuild(addonRoster(2, 58));
    stubRoster([apiMember('Ana'), apiMember('Member1', 60)]);
    await sync(guild.id);
    const dings = await testApp.db.select().from(schema.guildMemberLevelEvents);
    expect(dings.map((d) => [d.fromLevel, d.toLevel])).toEqual([[58, 60]]);
  });

  it('(9) sync adds 3 Blizzard-only rows, a NEWER addon import adopts them → no flag, added=0', async () => {
    const { who, guild } = await seedGuild(addonRoster(20));
    const extras = ['Extra1', 'Extra2', 'Extra3'];
    const seeded = await liveNames(guild.id);
    stubRoster([...seeded, ...extras].map((n) => apiMember(n)));
    expect((await sync(guild.id)).status).toBe('ok');
    expect(await liveNames(guild.id)).toHaveLength(23);
    await rewindSync(guild.id, 120);
    const fresh = extras.map((name, i) => buildMember(200 + i, { name }));
    const res = await addonImport(who, [...addonRoster(20), ...fresh], 5);
    expect(res.status).toBe(200);
    expect(res.body.status).not.toBe('stale');
    expect(await liveNames(guild.id)).toHaveLength(23);
    const rows = await allRows();
    expect(rows).toHaveLength(23);
    const adopted = rows.filter((r) => extras.includes(r.characterName));
    expect(adopted.map((r) => r.guid).sort()).toEqual(
      fresh.map((m) => m.guid).sort(),
    );
    expect(await lastAudit()).toMatchObject({ added: 0, removed: 0 });
    const flags = await testApp.db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.title, ROSTER_FLAG_TITLE));
    expect(flags).toEqual([]);
  });

  it('(10) empty 200 → skipped_empty, live set and last_snapshot_at unchanged, no audit', async () => {
    const { guild } = await seedGuild(addonRoster(5));
    const live = await liveNames(guild.id);
    const audits = await auditCount();
    stubRoster([]);
    expect(await sync(guild.id)).toEqual({ status: 'skipped_empty' });
    expect(await liveNames(guild.id)).toEqual(live);
    const stored = await guildRow(guild.id);
    expect(stored.blizzardRosterStatus).toBe('skipped_empty');
    expect(stored.lastSnapshotAt).toEqual(guild.lastSnapshotAt);
    expect(await auditCount()).toBe(audits);
  });

  it('(11) guild snapshot newer than the sync instant → stale, no status/synced_at written, roster untouched', async () => {
    const { guild } = await seedGuild(addonRoster(5));
    const future = new Date('2099-01-01T00:00:00Z');
    await testApp.db
      .update(schema.guilds)
      .set({ lastSnapshotAt: future })
      .where(eq(schema.guilds.id, guild.id));
    const live = await liveNames(guild.id);
    const audits = await auditCount();
    stubRoster(fourPlusOne());
    expect(await sync(guild.id)).toEqual({ status: 'stale' });
    expect(await liveNames(guild.id)).toEqual(live);
    const stored = await guildRow(guild.id);
    expect(stored.blizzardRosterStatus).toBeNull();
    expect(stored.blizzardRosterSyncedAt).toBeNull();
    expect(stored.lastSnapshotAt).toEqual(future);
    expect(await auditCount()).toBe(audits);
  });

  it('(12) slug cleared between fetch and apply → superseded, nothing written (Codex P2-2)', async () => {
    const { guild } = await seedGuild(addonRoster(5));
    const live = await liveNames(guild.id);
    const audits = await auditCount();
    fetchSpy.mockImplementation(async () => {
      await testApp.db
        .update(schema.guilds)
        .set({ guildSlug: null })
        .where(eq(schema.guilds.id, guild.id));
      return { members: fourPlusOne() };
    });
    expect(await sync(guild.id)).toEqual({ status: 'superseded' });
    expect(await liveNames(guild.id)).toEqual(live);
    expect(await allRows()).toHaveLength(5);
    const stored = await guildRow(guild.id);
    expect(stored.blizzardRosterStatus).toBeNull();
    expect(stored.blizzardRosterSyncedAt).toBeNull();
    expect(stored.lastSnapshotAt).toEqual(guild.lastSnapshotAt);
    expect(await auditCount()).toBe(audits);
  });
});
