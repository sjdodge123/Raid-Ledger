/**
 * ROK-1920 — BlizzardForeverFactSource: Armory-synced Forever rows as
 * blizzard facts (DB filtering itself is proven in
 * blizzard-forever.integration.spec.ts).
 */
import { Logger } from '@nestjs/common';
import {
  createDrizzleMock,
  type MockDb,
} from '../../../common/testing/drizzle-mock';
import {
  BlizzardForeverFactSource,
  toForeverCandidates,
} from './blizzard-forever.fact-source';
import { MAX_ROSTER_ROWS, type RosterCharRef } from './wow-fact.types';

const SYNCED = new Date('2026-11-05T09:00:00.000Z');
const EQUIPMENT = {
  equippedItemLevel: 64,
  items: [
    {
      slot: 'HEAD',
      name: 'Lionheart Helm',
      itemId: 12640,
      quality: 'EPIC',
      itemLevel: 63,
      itemSubclass: null,
    },
  ],
  syncedAt: '2026-11-05T09:00:00.000Z',
};
const PROFS = {
  primary: [
    {
      id: 164,
      name: 'Blacksmithing',
      slug: 'blacksmithing',
      skillLevel: 300,
      maxSkillLevel: 300,
      tiers: [],
    },
  ],
  secondary: [],
  syncedAt: '2026-11-05T09:00:00.000Z',
};
const GEAR = [
  { slot: 1, itemId: 12640, ilvl: 63, bonusIds: [], name: 'Lionheart Helm' },
];

function row(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    level: 60,
    class: 'Warrior',
    race: 'Human',
    role: 'tank',
    itemLevel: 64,
    equipment: EQUIPMENT,
    armoryProfessions: null,
    armoryQuests: null,
    lastSyncedAt: SYNCED,
    ...over,
  };
}

const ref = (key: string, characterId: string | null): RosterCharRef => ({
  key,
  memberId: null,
  characterId,
});

describe('toForeverCandidates', () => {
  it('serves level/class/race/role/ilvl/gear as blizzard, asOf = lastSyncedAt', () => {
    const b = (value: unknown) => ({ value, source: 'blizzard', asOf: SYNCED });
    expect(toForeverCandidates(row('c1'))).toEqual({
      level: b(60),
      class: b('Warrior'),
      race: b('Human'),
      role: b('tank'),
      ilvl: b(64),
      gear: b(GEAR),
      enchantsReported: b(false),
    });
  });

  // ROK-2107 (supersedes ROK-1920 F11): professions come from armory_professions.
  it('serves armory_professions as blizzard professions, asOf = lastSyncedAt', () => {
    const got = toForeverCandidates(row('c1', { armoryProfessions: PROFS }));
    expect(got.professions).toEqual({
      value: PROFS,
      source: 'blizzard',
      asOf: SYNCED,
    });
  });

  it('emits no professions for a null or malformed armory_professions', () => {
    for (const armoryProfessions of [null, { primary: 'nope' }]) {
      const got = toForeverCandidates(row('c1', { armoryProfessions }));
      expect(got).not.toHaveProperty('professions');
    }
  });

  it('never emits quests, lockouts or lastOnline', () => {
    const keys = Object.keys(toForeverCandidates(row('c1')));
    for (const f of ['quests', 'lockouts', 'lastOnline']) {
      expect(keys).not.toContain(f);
    }
  });

  it('skips a role outside the enum', () => {
    expect(toForeverCandidates(row('c1', { role: 'bard' }))).not.toHaveProperty(
      'role',
    );
  });

  it('emits no gear and no enchantsReported when the equipment does not map', () => {
    for (const equipment of [null, { ...EQUIPMENT, source: 'addon' }]) {
      const got = toForeverCandidates(row('c1', { equipment }));
      expect(got).not.toHaveProperty('gear');
      expect(got).not.toHaveProperty('enchantsReported');
    }
  });

  it('a row with no synced data yields no facts', () => {
    const empty = row('c1', {
      level: null,
      class: null,
      race: null,
      role: null,
      itemLevel: null,
      equipment: null,
    });
    expect(toForeverCandidates(empty)).toEqual({});
  });
});

describe('BlizzardForeverFactSource.load', () => {
  let db: MockDb;
  beforeEach(() => {
    db = createDrizzleMock();
  });

  it('answers only the fields it owns', () => {
    expect([...new BlizzardForeverFactSource(db as never).fields]).toEqual([
      'level',
      'class',
      'race',
      'role',
      'ilvl',
      'gear',
      'enchantsReported',
      'professions',
    ]);
  });

  it(`loads ${MAX_ROSTER_ROWS} refs in ONE query`, async () => {
    db.where.mockResolvedValue([]);
    const refs = Array.from({ length: MAX_ROSTER_ROWS }, (_, i) =>
      ref(`m${i}`, `c${i}`),
    );
    await new BlizzardForeverFactSource(db as never).load(refs);
    expect(db.select).toHaveBeenCalledTimes(1);
  });

  it('maps returned rows to every key pointing at them; rows it did not return get no entry', async () => {
    db.where.mockResolvedValue([row('c1')]);
    const got = await new BlizzardForeverFactSource(db as never).load([
      ref('a', 'c1'),
      ref('b', 'c1'),
      ref('manual', 'c2'),
      ref('unlinked', null),
    ]);
    expect(db.select).toHaveBeenCalledTimes(1);
    expect([...got.keys()].sort()).toEqual(['a', 'b']);
    expect(got.get('a')?.level?.source).toBe('blizzard');
  });

  it('issues no query when no ref is linked', async () => {
    const got = await new BlizzardForeverFactSource(db as never).load([
      ref('unlinked', null),
    ]);
    expect(got.size).toBe(0);
    expect(db.select).not.toHaveBeenCalled();
  });

  it('a failed query resolves to no facts and logs a warning', async () => {
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    db.where.mockRejectedValue(new Error('db down'));
    const got = await new BlizzardForeverFactSource(db as never).load([
      ref('a', 'c1'),
    ]);
    expect(got.size).toBe(0);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('db down'));
    warn.mockRestore();
  });
});
