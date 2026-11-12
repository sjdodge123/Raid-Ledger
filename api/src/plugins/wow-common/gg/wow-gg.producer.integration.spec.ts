/**
 * ROK-2187 metric 12 (Q7) — the WoW levels-dinged GG card against a real
 * database. The community tz is America/New_York, so the 2026 window is
 * [2026-01-01T05:00Z, 2027-01-01T05:00Z). Mutation map: drop the window's
 * `lt` → the Jan 1 2027 ding counts (case 1 red); drop `ownerActive` → the
 * deactivated owner gets a card (case 4 red); drop BOTH event dedupes (the
 * query's DISTINCT ON and `toWowLevelsCard`'s seen-set — either alone holds)
 * → the two-character row counts each ding twice (case 5 red); join on GUID
 * only → case 2 red.
 */
import { getTestApp, type TestApp } from '../../../common/testing/test-app';
import { truncateAllTables } from '../../../common/testing/integration-helpers';
import { nonEmpty } from '../../../common/testing/narrow';
import * as schema from '../../../drizzle/schema';
import type { GgCardContext } from '../../core/gg/gg-card.registry';
import { writeJunkMerges } from '../guilds/blizzard-roster-sync.repair';
import { wowLevelsYearProducer } from './wow-gg.producer';

const SNAP = new Date('2026-11-08T12:00:00.000Z');
let testApp: TestApp;
let seq = 0;
const next = (): number => (seq += 1);

function ctxFor(userId: number): GgCardContext {
  return {
    db: testApp.db,
    userId,
    year: 2026,
    window: {
      start: new Date('2026-01-01T05:00:00Z'),
      end: new Date('2027-01-01T05:00:00Z'),
    },
    tz: 'America/New_York',
  };
}

async function insertGuild(): Promise<number> {
  const name = `GG Dings ${next()}`;
  const [g] = nonEmpty(
    await testApp.db
      .insert(schema.guilds)
      .values({
        gameId: testApp.seed.game.id,
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

async function insertUser(deactivated = false): Promise<number> {
  const n = next();
  const [u] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({
        discordId: `local:gg-dings-${n}@test`,
        username: `GgDings_${n}`,
        role: 'member',
        deactivatedAt: deactivated ? SNAP : null,
      })
      .returning({ id: schema.users.id }),
    'user',
  );
  return u.id;
}

interface CharOpts {
  name?: string;
  externalId?: string;
  addonGuid?: string;
  region?: string | null;
}

async function insertChar(userId: number, o: CharOpts): Promise<void> {
  await testApp.db.insert(schema.characters).values({
    userId,
    gameId: testApp.seed.game.id,
    name: o.name ?? `DingChar${next()}`,
    class: 'Warrior',
    role: 'dps',
    isMain: false,
    region: o.region === undefined ? 'us' : o.region,
    externalId: o.externalId ?? null,
    addonGuid: o.addonGuid ?? null,
  });
}

async function insertRow(
  guildId: number,
  o: { guid?: string; blizzardId?: number },
): Promise<number> {
  const [m] = nonEmpty(
    await testApp.db
      .insert(schema.guildMembers)
      .values({
        guildId,
        guid: o.guid ?? null,
        blizzardCharacterId: o.blizzardId ?? null,
        characterName: `Row${next()}`,
        rankIndex: 3,
        rankName: 'Member',
        source: o.guid ? 'addon_import' : 'blizzard',
        lastSeenAt: SNAP,
      })
      .returning({ id: schema.guildMembers.id }),
    'member row',
  );
  return m.id;
}

async function insertDing(
  guildId: number,
  memberId: number,
  toLevel: number,
  at: string,
): Promise<void> {
  await testApp.db.insert(schema.guildMemberLevelEvents).values({
    guildId,
    guildMemberId: memberId,
    fromLevel: toLevel - 1,
    toLevel,
    occurredAt: new Date(at),
  });
}

beforeAll(async () => {
  testApp = await getTestApp();
});

beforeEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
});

describe('wowLevelsYearProducer — link arms and repair (integration, ROK-2187)', () => {
  it('counts GUID-linked dings inside the community-tz year only', async () => {
    const me = await insertUser();
    const guild = await insertGuild();
    await insertChar(me, { name: 'Thrall', addonGuid: 'Player-1-0000A' });
    const row = await insertRow(guild, { guid: 'Player-1-0000A' });
    await insertDing(guild, row, 10, '2026-01-01T04:30:00Z'); // Dec 31 2025 23:30 local — out
    await insertDing(guild, row, 11, '2026-01-01T05:00:00Z'); // Jan 1 local — in
    await insertDing(guild, row, 13, '2026-06-01T12:00:00Z'); // in
    await insertDing(guild, row, 14, '2027-01-01T04:30:00Z'); // Dec 31 2026 23:30 local — in
    await insertDing(guild, row, 15, '2027-01-01T05:00:00Z'); // Jan 1 2027 local — out
    expect(await wowLevelsYearProducer(ctxFor(me))).toEqual({
      totalDings: 3,
      characters: [
        {
          name: 'Thrall',
          className: 'Warrior',
          fromLevel: 10,
          maxLevel: 14,
          dings: 3,
        },
      ],
    });
  });

  it('counts Blizzard-id-linked dings on an Armory-imported character', async () => {
    const me = await insertUser();
    const guild = await insertGuild();
    await insertChar(me, { externalId: '9001' });
    const row = await insertRow(guild, { blizzardId: 9001 });
    await insertDing(guild, row, 30, '2026-03-03T12:00:00Z');
    await insertDing(guild, row, 31, '2026-03-04T12:00:00Z');
    const card = await wowLevelsYearProducer(ctxFor(me));
    expect(card?.totalDings).toBe(2);
    expect(card?.characters[0]?.maxLevel).toBe(31);
  });

  it('counts a junk row’s dings once after the repair merges them into the twin', async () => {
    const me = await insertUser();
    const guild = await insertGuild();
    await insertChar(me, { addonGuid: 'Player-1-0000B', externalId: '777' });
    const twin = await insertRow(guild, { guid: 'Player-1-0000B' });
    const junk = await insertRow(guild, { blizzardId: 777 });
    await insertDing(guild, junk, 10, '2026-02-01T12:00:00Z');
    await insertDing(guild, junk, 11, '2026-03-01T12:00:00Z');
    await insertDing(guild, twin, 11, '2026-03-01T12:00:00Z');
    await insertDing(guild, twin, 12, '2026-04-01T12:00:00Z');
    expect((await wowLevelsYearProducer(ctxFor(me)))?.totalDings).toBe(2);
    await writeJunkMerges(testApp.db, guild, [
      { junkId: junk, targetId: twin, blizzardCharacterId: 777 },
    ]);
    const card = await wowLevelsYearProducer(ctxFor(me));
    expect(card?.totalDings).toBe(3);
    expect(card?.characters).toHaveLength(1);
    expect(card?.characters[0]).toMatchObject({ fromLevel: 9, maxLevel: 12 });
  });
});

describe('wowLevelsYearProducer — exclusions and dedupe (integration, ROK-2187)', () => {
  it('omits the card for a deactivated owner; the active Blizzard-id holder keeps the dings', async () => {
    const gone = await insertUser(true);
    const active = await insertUser();
    const guild = await insertGuild();
    await insertChar(gone, { addonGuid: 'Player-1-0000C' });
    await insertChar(active, { externalId: '4242' });
    const row = await insertRow(guild, {
      guid: 'Player-1-0000C',
      blizzardId: 4242,
    });
    await insertDing(guild, row, 20, '2026-05-05T12:00:00Z');
    expect(await wowLevelsYearProducer(ctxFor(gone))).toBeNull();
    expect((await wowLevelsYearProducer(ctxFor(active)))?.totalDings).toBe(1);
  });

  it('never double-counts a row linked to two characters or to two users', async () => {
    const me = await insertUser();
    const other = await insertUser();
    const guild = await insertGuild();
    await insertChar(me, { addonGuid: 'Player-1-0000D' });
    await insertChar(me, { addonGuid: 'Player-1-0000D', region: null });
    await insertChar(other, { addonGuid: 'Player-1-0000D', region: null });
    const row = await insertRow(guild, { guid: 'Player-1-0000D' });
    await insertDing(guild, row, 40, '2026-08-08T12:00:00Z');
    await insertDing(guild, row, 41, '2026-08-09T12:00:00Z');
    const mine = await wowLevelsYearProducer(ctxFor(me));
    expect(mine?.totalDings).toBe(2);
    expect(mine?.characters).toHaveLength(1);
    expect((await wowLevelsYearProducer(ctxFor(other)))?.totalDings).toBe(2);
  });

  it('omits the card for a user with no dings in the year', async () => {
    expect(await wowLevelsYearProducer(ctxFor(await insertUser()))).toBeNull();
  });
});
