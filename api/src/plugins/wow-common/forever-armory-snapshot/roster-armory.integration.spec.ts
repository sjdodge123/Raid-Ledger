/**
 * ROK-2133 L6a — the roster Armory pass (`RosterArmoryService`) against a
 * real database: AC-1..AC-7, AC-11, AC-13. Blizzard is stubbed at the
 * `BlizzardCharacterSyncAdapter` seam (spies on the instance the app holds);
 * the roster fetch behind Sync now is stubbed on `BlizzardService`.
 */
import { BadGatewayException, NotFoundException } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../../../common/testing/test-app';
import { truncateAllTables } from '../../../common/testing/integration-helpers';
import { nonEmpty } from '../../../common/testing/narrow';
import * as schema from '../../../drizzle/schema';
import { SettingsService } from '../../../settings/settings.service';
import { PluginRegistryService } from '../../plugin-host/plugin-registry.service';
import type {
  ExternalCharacterEquipment,
  ExternalCharacterProfessions,
  ExternalCharacterProfile,
} from '../../plugin-host/extension-types';
import { BlizzardCharacterSyncAdapter } from '../blizzard-character-sync.adapter';
import type { ForeverGuildRoster } from '../blizzard-forever-guild.helpers';
import { BlizzardService } from '../blizzard.service';
import { WOW_FOREVER_ARMORY_IMPORT_KEY } from '../forever.settings';
import { BlizzardRosterSyncJob } from '../guilds/blizzard-roster-sync.job';
import { WOW_FOREVER_GAME_SLUG } from '../wow-forever-identity.helpers';
import { RosterInsightsCache } from '../guilds/roster-insights/roster-insights.cache';
import { RosterArmoryService } from './roster-armory.service';

const HOUR = 60 * 60 * 1000;
const equipment: ExternalCharacterEquipment = {
  equippedItemLevel: 51,
  items: [
    {
      slot: 'HEAD',
      name: 'Test Helm',
      itemId: 1,
      quality: 'RARE',
      itemLevel: 51,
      itemSubclass: null,
    },
  ],
  syncedAt: '2026-11-08T00:00:00.000Z',
};
const professions: ExternalCharacterProfessions = {
  primary: [
    {
      id: 164,
      name: 'Blacksmithing',
      slug: 'blacksmithing',
      skillLevel: 150,
      maxSkillLevel: 300,
      tiers: [],
    },
  ],
  secondary: [],
  syncedAt: '2026-11-08T00:00:00.000Z',
};
const talents = { tree: 'holy', points: 31 };

type MemberInsert = typeof schema.guildMembers.$inferInsert;
type ArmoryInsert = typeof schema.guildMemberArmory.$inferInsert;

let testApp: TestApp;
let adapter: BlizzardCharacterSyncAdapter;
let settings: SettingsService;
let service: RosterArmoryService;
let gameId: number;
let fetchProfile: jest.SpyInstance<
  Promise<ExternalCharacterProfile>,
  Parameters<BlizzardCharacterSyncAdapter['fetchProfile']>
>;
let fetchQuests: jest.SpyInstance;
/** Name → Blizzard id the stubbed profile reports (unknown name → 404). */
let profileIds: Map<string, string>;

function profile(name: string, externalId: string): ExternalCharacterProfile {
  return {
    name,
    realm: null,
    class: 'Paladin',
    spec: null,
    role: null,
    level: 60,
    race: 'Human',
    faction: 'Alliance',
    itemLevel: 51,
    avatarUrl: 'https://render.test/avatar.jpg',
    renderUrl: null,
    profileUrl: null,
    externalId,
  };
}

/** The stubbed Armory profile route: a known name, else a 404. */
function resolveProfile(name: string): Promise<ExternalCharacterProfile> {
  const id = profileIds.get(name);
  if (id === undefined) {
    return Promise.reject(new NotFoundException('no such character'));
  }
  return Promise.resolve(profile(name, id));
}

function stubAdapter(): void {
  fetchProfile = jest
    .spyOn(adapter, 'fetchProfile')
    .mockImplementation(resolveProfile);
  jest
    .spyOn(adapter, 'fetchSpecialization')
    .mockResolvedValue({ spec: 'Holy', role: 'healer', talents });
  jest.spyOn(adapter, 'fetchEquipment').mockResolvedValue(equipment);
  jest.spyOn(adapter, 'fetchProfessions').mockResolvedValue(professions);
  fetchQuests = jest.spyOn(adapter, 'fetchQuests').mockResolvedValue(null);
}

async function ensureGame(): Promise<number> {
  const [existing] = await testApp.db
    .select()
    .from(schema.games)
    .where(eq(schema.games.slug, WOW_FOREVER_GAME_SLUG))
    .limit(1);
  if (existing) return existing.id;
  const [game] = nonEmpty(
    await testApp.db
      .insert(schema.games)
      .values({
        name: 'World of Warcraft: Forever',
        slug: WOW_FOREVER_GAME_SLUG,
      })
      .returning(),
    'game',
  );
  return game.id;
}

/** A claimable Forever hub by default (active, visible `wow_guild`). */
async function insertGuild(
  over: Partial<typeof schema.guilds.$inferInsert> = {},
): Promise<number> {
  const name = `Armory Guild ${Math.random().toString(36).slice(2, 10)}`;
  const [g] = nonEmpty(
    await testApp.db
      .insert(schema.guilds)
      .values({
        gameId,
        region: 'us',
        name,
        nameKey: name.toLowerCase(),
        source: 'blizzard',
        ...over,
      })
      .returning({ id: schema.guilds.id }),
    'guild',
  );
  return g.id;
}

/** A Blizzard roster row (due by default: id, level 60, no snapshot). */
async function seedMember(
  guildId: number,
  over: Partial<MemberInsert> = {},
): Promise<number> {
  const [m] = nonEmpty(
    await testApp.db
      .insert(schema.guildMembers)
      .values({
        guildId,
        characterName: 'Ana Forever',
        blizzardCharacterId: 9001,
        level: 60,
        source: 'blizzard',
        ...over,
      })
      .returning({ id: schema.guildMembers.id }),
    'member',
  );
  return m.id;
}

async function seedSnapshot(
  guildMemberId: number,
  over: Partial<ArmoryInsert> = {},
): Promise<void> {
  await testApp.db.insert(schema.guildMemberArmory).values({
    guildMemberId,
    blizzardCharacterId: 9001,
    level: 60,
    rosterLevel: 60,
    ...over,
  });
}

const armRow = async (memberId: number) =>
  (
    await testApp.db
      .select()
      .from(schema.guildMemberArmory)
      .where(eq(schema.guildMemberArmory.guildMemberId, memberId))
  )[0];

const fetchedNames = (): string[] => fetchProfile.mock.calls.map((c) => c[0]);

const countRows = async (
  table: typeof schema.characters | typeof schema.guildMemberArmory,
): Promise<number> => {
  const [row] = await testApp.db
    .select({ n: sql<number>`count(*)::int` })
    .from(table);
  return row?.n ?? -1;
};

/** Assert `at` lies in [before + ms, after + ms]. */
function expectOffset(
  at: Date | null | undefined,
  before: number,
  after: number,
  ms: number,
): void {
  expect(at).toBeInstanceOf(Date);
  const t = at?.getTime() ?? Number.NaN;
  expect(t).toBeGreaterThanOrEqual(before + ms);
  expect(t).toBeLessThanOrEqual(after + ms);
}

beforeAll(async () => {
  testApp = await getTestApp();
  adapter = testApp.app.get(BlizzardCharacterSyncAdapter);
  settings = testApp.app.get(SettingsService);
});

beforeEach(async () => {
  gameId = await ensureGame();
  profileIds = new Map([['Ana Forever', '9001']]);
  jest.spyOn(settings, 'isBlizzardConfigured').mockResolvedValue(true);
  stubAdapter();
  // No 500 ms spacing between fetches: the 150-member cap run stays fast.
  service = new RosterArmoryService(
    testApp.db,
    settings,
    adapter,
    testApp.app.get(RosterInsightsCache),
    () => Promise.resolve(),
  );
});

afterEach(async () => {
  jest.restoreAllMocks();
  testApp.seed = await truncateAllTables(testApp.db);
});

// No afterAll truncate: the shared integration setup closes the pool.

describe('a successful pass (AC-1)', () => {
  it('writes the member snapshot, creates no character, skips quests', async () => {
    const memberId = await seedMember(await insertGuild());
    const before = Date.now();

    expect(await service.runDue()).toEqual({ written: 1 });

    expect(fetchProfile).toHaveBeenCalledTimes(1);
    expect(fetchProfile.mock.calls[0]?.slice(0, 3)).toEqual([
      'Ana Forever',
      null,
      'us',
    ]);
    expect(fetchQuests).not.toHaveBeenCalled();
    const row = await armRow(memberId);
    expect(row).toMatchObject({
      blizzardCharacterId: 9001,
      level: 60,
      rosterLevel: 60,
      class: 'Paladin',
      race: 'Human',
      spec: 'Holy',
      role: 'healer',
      itemLevel: 51,
      avatarUrl: 'https://render.test/avatar.jpg',
      equipment,
      talents,
      armoryProfessions: professions,
      failures: 0,
      retryAt: null,
      lastError: null,
    });
    expect(row?.syncedAt?.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(await countRows(schema.characters)).toBe(0);
  });

  it('skips members below level 10, without a Blizzard id, or of a non-claimable hub', async () => {
    const hub = await insertGuild();
    const ok = await seedMember(hub);
    const low = await seedMember(hub, { characterName: 'Low Level', level: 9 });
    const noId = await seedMember(hub, {
      characterName: 'No Ident',
      blizzardCharacterId: null,
    });
    const hidden = await seedMember(
      await insertGuild({ hiddenAt: new Date() }),
      {
        characterName: 'Hidden Hub',
        blizzardCharacterId: 9010,
      },
    );
    profileIds.set('Hidden Hub', '9010');

    expect(await service.runDue()).toEqual({ written: 1 });

    expect(fetchedNames()).toEqual(['Ana Forever']);
    expect((await armRow(ok))?.syncedAt).toBeInstanceOf(Date);
    for (const id of [low, noId, hidden])
      expect(await armRow(id)).toBeUndefined();
  });
});

describe('Armory-linked ids are left to the character sync (AC-2)', () => {
  it('does not fetch a member whose Blizzard id a wow_forever character holds', async () => {
    const hub = await insertGuild();
    const [user] = nonEmpty(
      await testApp.db
        .insert(schema.users)
        .values({ discordId: 'local:armory@test.local', username: 'armory' })
        .returning(),
      'user',
    );
    await testApp.db.insert(schema.characters).values({
      userId: user.id,
      gameId,
      name: 'Owned Forever',
      class: 'Mage',
      region: 'us',
      gameVariant: 'wow_forever',
      externalId: '9002',
      addonGuid: 'Player-5-0A0B0C0D',
    });
    const owned = await seedMember(hub, {
      characterName: 'Owned Forever',
      blizzardCharacterId: 9002,
      guid: 'Player-5-0A0B0C0D',
    });
    profileIds.set('Owned Forever', '9002');
    const guidless = await seedMember(hub, {
      characterName: 'Guidless Forever',
      blizzardCharacterId: 9002,
    });
    profileIds.set('Guidless Forever', '9002');
    await seedMember(hub);

    expect(await service.runDue()).toEqual({ written: 2 });

    // The roster reaches that character only through the GUID link, so a
    // Blizzard-roster-only (guid null) member keeps its own snapshot fresh.
    expect(fetchedNames().sort()).toEqual(['Ana Forever', 'Guidless Forever']);
    expect(await armRow(owned)).toBeUndefined();
    expect(await armRow(guidless)).toMatchObject({
      blizzardCharacterId: 9002,
      itemLevel: 51,
    });
  });
});

describe('ROK-2115 Codex r2 P2: a deactivated owner never starves a member', () => {
  it('fetches a GUID-less member whose only Armory-linked character belongs to a deactivated user', async () => {
    const hub = await insertGuild();
    const [user] = nonEmpty(
      await testApp.db
        .insert(schema.users)
        .values({
          discordId: 'local:armory-gone@test.local',
          username: 'armory-gone',
          deactivatedAt: new Date(),
        })
        .returning(),
      'deactivated user',
    );
    await testApp.db.insert(schema.characters).values({
      userId: user.id,
      gameId,
      name: 'Gone Forever',
      class: 'Mage',
      region: 'us',
      gameVariant: 'wow_forever',
      externalId: '9003',
    });
    const member = await seedMember(hub, {
      characterName: 'Gone Forever',
      blizzardCharacterId: 9003,
    });
    profileIds.set('Gone Forever', '9003');

    expect(await service.runDue()).toEqual({ written: 1 });

    // The roster read drops that character (ownerIsActive), so nothing else
    // refreshes the member: the roster pass must keep its snapshot.
    expect(fetchedNames()).toEqual(['Gone Forever']);
    expect(await armRow(member)).toMatchObject({ blizzardCharacterId: 9003 });
  });
});

describe('Codex P2s: soft-removed members, partial fetches (ROK-2133)', () => {
  it('a member soft-removed by the roster sync (older last_seen_at) is never fetched', async () => {
    const snapshotAt = new Date();
    const hub = await insertGuild({ lastSnapshotAt: snapshotAt });
    await seedMember(hub, { lastSeenAt: snapshotAt });
    const gone = await seedMember(hub, {
      characterName: 'Gone Forever',
      blizzardCharacterId: 9020,
      lastSeenAt: new Date(snapshotAt.getTime() - HOUR),
    });
    profileIds.set('Gone Forever', '9020');

    expect(await service.runDue()).toEqual({ written: 1 });

    expect(fetchedNames()).toEqual(['Ana Forever']);
    expect(await armRow(gone)).toBeUndefined();
  });

  it('a failed equipment / professions sub-call keeps the stored gear and professions', async () => {
    const memberId = await seedMember(await insertGuild());
    const stale = new Date(Date.now() - 25 * HOUR);
    await seedSnapshot(memberId, {
      itemLevel: 40,
      equipment,
      armoryProfessions: professions,
      syncedAt: stale,
    });
    jest.spyOn(adapter, 'fetchEquipment').mockResolvedValue(null);
    jest.spyOn(adapter, 'fetchProfessions').mockResolvedValue(null);

    expect(await service.runDue()).toEqual({ written: 1 });

    const row = await armRow(memberId);
    expect(row).toMatchObject({
      itemLevel: 51,
      equipment,
      armoryProfessions: professions,
    });
    expect(row?.syncedAt?.getTime()).toBeGreaterThan(stale.getTime());
  });
});

describe('failures back off (AC-3, AC-4, AC-5)', () => {
  it('404 keeps the snapshot, backs off per backoffDelay, and is not retried early', async () => {
    const memberId = await seedMember(await insertGuild(), {
      characterName: 'Gone Forever',
    });
    const syncedAt = new Date(Date.now() - 48 * HOUR);
    await seedSnapshot(memberId, { class: 'Mage', itemLevel: 40, syncedAt });

    const before = Date.now();
    expect(await service.runDue()).toEqual({ not_found: 1 });
    const after = Date.now();

    const row = await armRow(memberId);
    expect(row).toMatchObject({
      class: 'Mage',
      itemLevel: 40,
      syncedAt,
      failures: 1,
      lastError: 'not_found',
    });
    expectOffset(row?.retryAt, before, after, HOUR);

    expect(await service.runDue()).toEqual({});
    expect(fetchProfile).toHaveBeenCalledTimes(1);

    await testApp.db
      .update(schema.guildMemberArmory)
      .set({ retryAt: new Date(Date.now() - 1000) })
      .where(eq(schema.guildMemberArmory.guildMemberId, memberId));
    const before2 = Date.now();
    expect(await service.runDue()).toEqual({ not_found: 1 });
    const after2 = Date.now();
    expect(fetchProfile).toHaveBeenCalledTimes(2);
    const again = await armRow(memberId);
    expect(again?.failures).toBe(2);
    expectOffset(again?.retryAt, before2, after2, 2 * HOUR);
  });

  it('a profile whose id is not the roster id stores nothing and backs off 24 h', async () => {
    const memberId = await seedMember(await insertGuild());
    profileIds.set('Ana Forever', '7777');

    const before = Date.now();
    expect(await service.runDue()).toEqual({ id_mismatch: 1 });
    const after = Date.now();

    const row = await armRow(memberId);
    expect(row).toMatchObject({
      syncedAt: null,
      class: null,
      level: null,
      equipment: null,
      lastError: 'id_mismatch',
      failures: 1,
    });
    expectOffset(row?.retryAt, before, after, 24 * HOUR);
  });

  it('an upstream error backs that member off and ends the run', async () => {
    const hub = await insertGuild();
    const first = await seedMember(hub, {
      characterName: 'First Forever',
      blizzardCharacterId: 9101,
    });
    const broken = await seedMember(hub, {
      characterName: 'Broken Forever',
      blizzardCharacterId: 9102,
    });
    const third = await seedMember(hub, {
      characterName: 'Third Forever',
      blizzardCharacterId: 9103,
    });
    profileIds = new Map([
      ['First Forever', '9101'],
      ['Third Forever', '9103'],
    ]);
    fetchProfile.mockImplementation((name: string) =>
      name === 'Broken Forever'
        ? Promise.reject(new BadGatewayException('502'))
        : resolveProfile(name),
    );

    const before = Date.now();
    expect(await service.runDue()).toEqual({ written: 1, upstream: 1 });
    const after = Date.now();

    expect(fetchedNames()).toEqual(['First Forever', 'Broken Forever']);
    expect((await armRow(first))?.syncedAt).toBeInstanceOf(Date);
    const row = await armRow(broken);
    expect(row).toMatchObject({
      lastError: 'upstream',
      failures: 1,
      syncedAt: null,
    });
    expectOffset(row?.retryAt, before, after, HOUR);
    expect(await armRow(third)).toBeUndefined();
  });
});

describe('kill switch and Blizzard config (AC-6)', () => {
  it('kill switch off → no adapter call, no write', async () => {
    await seedMember(await insertGuild());
    const real = settings.get.bind(settings);
    jest
      .spyOn(settings, 'get')
      .mockImplementation((key) =>
        key === WOW_FOREVER_ARMORY_IMPORT_KEY
          ? Promise.resolve('false')
          : real(key),
      );

    expect(await service.runDue()).toBeNull();
    expect(fetchProfile).not.toHaveBeenCalled();
    expect(await countRows(schema.guildMemberArmory)).toBe(0);
  });

  it('Blizzard unconfigured → no adapter call, no write', async () => {
    await seedMember(await insertGuild());
    jest.spyOn(settings, 'isBlizzardConfigured').mockResolvedValue(false);

    expect(await service.runDue()).toBeNull();
    expect(fetchProfile).not.toHaveBeenCalled();
    expect(await countRows(schema.guildMemberArmory)).toBe(0);
  });
});

/** Letters-only suffix (Forever names allow no digits): 0 → "aa". */
const letters = (i: number): string =>
  String.fromCharCode(97 + Math.floor(i / 26)) +
  String.fromCharCode(97 + (i % 26));

describe('cap and due rules (AC-7)', () => {
  it('200 due members → exactly 150 attempted, never-synced then oldest first', async () => {
    const hub = await insertGuild();
    const rows: MemberInsert[] = Array.from({ length: 200 }, (_, i) => ({
      guildId: hub,
      characterName: `Mem${letters(i)} Forever`,
      blizzardCharacterId: 20_000 + i,
      level: 60,
      source: 'blizzard',
    }));
    const members = await testApp.db
      .insert(schema.guildMembers)
      .values(rows)
      .returning({
        id: schema.guildMembers.id,
        name: schema.guildMembers.characterName,
        bid: schema.guildMembers.blizzardCharacterId,
      });
    profileIds = new Map(members.map((m) => [m.name, String(m.bid)]));
    // First 10 never synced; the other 190 stale, OLDER as the index RISES,
    // so oldest-first is the reverse of insertion (id) order.
    const now = Date.now();
    await testApp.db.insert(schema.guildMemberArmory).values(
      members.slice(10).map((m, k) => ({
        guildMemberId: m.id,
        blizzardCharacterId: m.bid,
        level: 60,
        rosterLevel: 60,
        syncedAt: new Date(now - 25 * HOUR - k * 60_000),
      })),
    );
    const stale = members.slice(10).reverse();
    const expected = [
      ...members.slice(0, 10).map((m) => m.name),
      ...stale.slice(0, 140).map((m) => m.name),
    ];

    expect(await service.runDue()).toEqual({ written: 150 });

    expect(fetchedNames()).toEqual(expected);
  });

  it('fresh at the same roster level is not due (even if Blizzard lags); a roster level change, stale age or elapsed retry is', async () => {
    const hub = await insertGuild();
    const recent = new Date(Date.now() - HOUR);
    const add = async (
      name: string,
      bid: number,
      snap: Partial<ArmoryInsert>,
    ) => {
      const id = await seedMember(hub, {
        characterName: name,
        blizzardCharacterId: bid,
      });
      profileIds.set(name, String(bid));
      await seedSnapshot(id, { blizzardCharacterId: bid, ...snap });
    };
    await add('Fresh Forever', 9201, { syncedAt: recent, level: 60 });
    // Blizzard still reports 59 but the roster level it was synced at is
    // unchanged: not due (no re-fetch loop while the Armory lags).
    await add('Lagging Forever', 9206, {
      syncedAt: recent,
      level: 59,
      rosterLevel: 60,
    });
    // The roster moved 59 → 60 since the last sync: due.
    await add('Dinged Forever', 9202, {
      syncedAt: recent,
      level: 59,
      rosterLevel: 59,
    });
    await add('Stale Forever', 9203, {
      syncedAt: new Date(Date.now() - 25 * HOUR),
      level: 60,
    });
    await add('Waiting Forever', 9204, {
      syncedAt: null,
      retryAt: new Date(Date.now() + HOUR),
    });
    await add('Retried Forever', 9205, {
      syncedAt: null,
      retryAt: new Date(Date.now() - 1000),
    });

    expect(await service.runDue()).toEqual({ written: 3 });

    expect(fetchedNames().sort()).toEqual(
      ['Dinged Forever', 'Retried Forever', 'Stale Forever'].sort(),
    );
  });
});

describe('cascade (AC-11)', () => {
  it('deleting the guild_members row deletes its snapshot', async () => {
    const memberId = await seedMember(await insertGuild());
    await seedSnapshot(memberId, { syncedAt: new Date() });
    expect(await armRow(memberId)).toBeDefined();

    await testApp.db
      .delete(schema.guildMembers)
      .where(eq(schema.guildMembers.id, memberId));

    expect(await armRow(memberId)).toBeUndefined();
  });
});

describe('Sync now (AC-13)', () => {
  it('fires one armory pass for that guild only, without awaiting it', async () => {
    const registry = testApp.app.get(PluginRegistryService);
    await registry.ensureInstalled('blizzard');
    await registry.activate('blizzard');
    const synced = await insertGuild({ guildSlug: 'sync-now-guild' });
    const other = await seedMember(await insertGuild(), {
      characterName: 'Other Forever',
      blizzardCharacterId: 9302,
    });
    profileIds.set('Other Forever', '9302');
    jest
      .spyOn(testApp.app.get(BlizzardService), 'fetchForeverGuildRoster')
      .mockResolvedValue({
        members: [
          {
            name: 'Ana Forever',
            level: 60,
            classId: 2,
            rank: 1,
            blizzardId: 9001,
          },
        ],
      } satisfies ForeverGuildRoster);
    // Hold the Armory fetch open: Sync now must answer while it is pending.
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    fetchProfile.mockImplementation(async (name: string) => {
      await gate;
      return resolveProfile(name);
    });
    // The job holds the app's instance (real 500 ms spacing; one fetch here).
    const appService = testApp.app.get(RosterArmoryService);
    const runForGuild = jest.spyOn(appService, 'runForGuild');
    const runDue = jest.spyOn(appService, 'runDue');

    const res = await testApp.app.get(BlizzardRosterSyncJob).syncNow(synced);

    expect(res.status).toBe('ok');
    expect(runForGuild).toHaveBeenCalledTimes(1);
    expect(runForGuild).toHaveBeenCalledWith(synced);
    release();
    const pass = runForGuild.mock.results[0]?.value;
    expect(await pass).toEqual({ written: 1 });
    expect(runDue).not.toHaveBeenCalled();
    expect(fetchedNames()).toEqual(['Ana Forever']);
    const [member] = nonEmpty(
      await testApp.db
        .select({ id: schema.guildMembers.id })
        .from(schema.guildMembers)
        .where(eq(schema.guildMembers.guildId, synced)),
      'synced member',
    );
    expect((await armRow(member.id))?.syncedAt).toBeInstanceOf(Date);
    expect(await armRow(other)).toBeUndefined();
  });
});
