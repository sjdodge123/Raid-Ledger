import {
  createDrizzleMock,
  type MockDb,
} from '../../../common/testing/drizzle-mock';
import { AddonSnapshotFactSource } from './addon-snapshot.fact-source';
import { CharacterRowFactSource } from './character-row.fact-source';
import { RosterFactSource } from './roster.fact-source';
import { MAX_ROSTER_ROWS, type RosterCharRef } from './wow-fact.types';

const T = new Date('2026-11-01T10:00:00.000Z');
const ref = (i: number, linked = true): RosterCharRef => ({
  key: `m${i}`,
  memberId: i,
  characterId: linked ? `c${i}` : null,
});
const fullRoster = Array.from({ length: MAX_ROSTER_ROWS }, (_, i) => ref(i));

let db: MockDb;
beforeEach(() => {
  db = createDrizzleMock();
});

describe('RosterFactSource', () => {
  it('loads 2000 roster rows in ONE query, linked or not', async () => {
    db.where.mockResolvedValue([]);
    await new RosterFactSource(db as never).load(fullRoster);
    expect(db.select).toHaveBeenCalledTimes(1);
  });

  it('maps level, class and last seen with asOf = lastSeenAt', async () => {
    db.where.mockResolvedValue([
      { id: 7, level: 42, class: 'Mage', lastSeenAt: T },
    ]);
    const got = await new RosterFactSource(db as never).load([ref(7, false)]);
    expect(got.get('m7')).toEqual({
      level: { value: 42, source: 'roster', asOf: T },
      class: { value: 'Mage', source: 'roster', asOf: T },
      lastOnline: { value: T, source: 'roster', asOf: T },
    });
  });

  it('issues no query for an empty batch', async () => {
    expect((await new RosterFactSource(db as never).load([])).size).toBe(0);
    expect(db.select).not.toHaveBeenCalled();
  });
});

describe('AddonSnapshotFactSource', () => {
  const data = {
    gear: [
      { slot: 1, itemId: 10, ilvl: 60, bonusIds: [], enchantId: 5 },
      { slot: 4, itemId: 11, ilvl: 1, bonusIds: [] },
      { slot: 5, itemId: 12, ilvl: 70, bonusIds: [] },
    ],
    talents: {
      nodes: [
        { nodeId: 1, rank: 5, tree: 2 },
        { nodeId: 2, rank: 31, tree: 2 },
        { nodeId: 3, rank: 5, tree: 0 },
      ],
    },
    lockouts: [],
    quests: { completed: [1, 2], inProgress: [] },
  };

  it('loads 2000 characters in ONE query', async () => {
    db.where.mockResolvedValue([]);
    await new AddonSnapshotFactSource(db as never).load(fullRoster);
    expect(db.select).toHaveBeenCalledTimes(1);
  });

  it('maps gear, ilvl, quests, lockouts and a talents role hint (asOf = capturedAt)', async () => {
    db.where.mockResolvedValue([
      { characterId: 'c1', data, capturedAt: T, class: 'Warrior' },
    ]);
    const got = await new AddonSnapshotFactSource(db as never).load([ref(1)]);
    const facts = got.get('m1');
    expect(facts?.gear).toEqual({ value: data.gear, source: 'addon', asOf: T });
    expect(facts?.ilvl).toEqual({ value: 65, source: 'addon', asOf: T });
    expect(facts?.quests?.value).toEqual(data.quests);
    expect(facts?.lockouts).toEqual({ value: [], source: 'addon', asOf: T });
    expect(facts?.role).toEqual({ value: 'tank', source: 'addon', asOf: T });
  });

  it('gives no role hint when the class is unknown', async () => {
    db.where.mockResolvedValue([
      { characterId: 'c1', data, capturedAt: T, class: null },
    ]);
    const got = await new AddonSnapshotFactSource(db as never).load([ref(1)]);
    expect(got.get('m1')?.role).toBeUndefined();
  });

  it('skips unlinked rows without a query', async () => {
    await new AddonSnapshotFactSource(db as never).load([ref(1, false)]);
    expect(db.select).not.toHaveBeenCalled();
  });
});

describe('CharacterRowFactSource', () => {
  const row = {
    id: 'c1',
    level: 60,
    class: 'Priest',
    race: 'Human',
    role: 'dps',
    roleOverride: 'healer',
    itemLevel: 66,
    professions: { primary: [], secondary: [], syncedAt: T.toISOString() },
    lastSyncedAt: T,
    externalId: null,
    addonGuid: 'Player-1-abc',
  };

  it('loads 2000 characters in ONE query', async () => {
    db.where.mockResolvedValue([]);
    await new CharacterRowFactSource(db as never).load(fullRoster);
    expect(db.select).toHaveBeenCalledTimes(1);
  });

  it('maps roleOverride and professions as manual, the rest by origin', async () => {
    db.where.mockResolvedValue([row]);
    const got = (
      await new CharacterRowFactSource(db as never).load([ref(1)])
    ).get('m1');
    expect(got?.role).toEqual({
      value: 'healer',
      source: 'manual',
      asOf: null,
    });
    expect(got?.professions?.source).toBe('manual');
    expect(got?.level).toEqual({ value: 60, source: 'addon', asOf: T });
    expect(got?.ilvl).toEqual({ value: 66, source: 'addon', asOf: T });
    expect(got?.race?.value).toBe('Human');
  });

  it('labels an Armory-synced row blizzard and keeps its synced role', async () => {
    db.where.mockResolvedValue([
      { ...row, roleOverride: null, externalId: '123', addonGuid: null },
    ]);
    const got = (
      await new CharacterRowFactSource(db as never).load([ref(1)])
    ).get('m1');
    expect(got?.role).toEqual({ value: 'dps', source: 'blizzard', asOf: T });
    expect(got?.class?.source).toBe('blizzard');
  });
});
