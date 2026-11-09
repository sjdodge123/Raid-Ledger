/**
 * ROK-2133 AC-8 (unit) — roster members' Armory snapshots as blizzard facts,
 * used only for a ref whose character produced no blizzard facts (D5, L5).
 * DB filtering is proven in blizzard-forever.member-facts.integration.spec.ts.
 */
import {
  createDrizzleMock,
  type MockDb,
} from '../../../common/testing/drizzle-mock';
import { BlizzardForeverFactSource } from './blizzard-forever.fact-source';
import { loadMemberFacts } from './blizzard-forever.member-facts';
import type { RosterCharRef } from './wow-fact.types';

const CHAR_SYNCED = new Date('2026-11-06T09:00:00.000Z');
const MEMBER_SYNCED = new Date('2026-11-07T09:00:00.000Z');

const ref = (
  key: string,
  memberId: number | null,
  characterId: string | null,
): RosterCharRef => ({ key, memberId, characterId });

function memberRow(memberId: number, over: Record<string, unknown> = {}) {
  return {
    memberId,
    level: 58,
    class: 'Priest',
    race: 'Dwarf',
    role: 'healer',
    itemLevel: 51,
    equipment: null,
    armoryProfessions: null,
    lastSyncedAt: MEMBER_SYNCED,
    ...over,
  };
}

function charRow(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    level: 60,
    class: 'Warrior',
    race: 'Human',
    role: 'tank',
    itemLevel: 64,
    equipment: null,
    armoryProfessions: null,
    lastSyncedAt: CHAR_SYNCED,
    ...over,
  };
}

describe('loadMemberFacts', () => {
  let db: MockDb;
  beforeEach(() => {
    db = createDrizzleMock();
  });

  it('serves a member snapshot as blizzard facts dated synced_at, for every key on the member', async () => {
    db.where.mockResolvedValueOnce([memberRow(7)]);
    const got = await loadMemberFacts(db as never, [
      ref('a', 7, null),
      ref('b', 7, null),
      ref('other', 8, null),
    ]);
    const b = (value: unknown) => ({
      value,
      source: 'blizzard',
      asOf: MEMBER_SYNCED,
    });
    expect([...got.keys()].sort()).toEqual(['a', 'b']);
    expect(got.get('a')).toEqual({
      level: b(58),
      class: b('Priest'),
      race: b('Dwarf'),
      role: b('healer'),
      ilvl: b(51),
    });
  });

  it('issues no query when no ref carries a member id', async () => {
    const got = await loadMemberFacts(db as never, [ref('c', null, 'c1')]);
    expect(got.size).toBe(0);
    expect(db.select).not.toHaveBeenCalled();
  });
});

describe('BlizzardForeverFactSource.load — member snapshot fallback (D5)', () => {
  let db: MockDb;
  beforeEach(() => {
    db = createDrizzleMock();
  });

  it('a linked character with blizzard facts wins over its member snapshot', async () => {
    db.where
      .mockResolvedValueOnce([charRow('c1')])
      .mockResolvedValueOnce([memberRow(7)]);
    const got = await new BlizzardForeverFactSource(db as never).load([
      ref('linked', 7, 'c1'),
    ]);
    expect(got.get('linked')?.class?.value).toBe('Warrior');
    expect(db.select).toHaveBeenCalledTimes(1);
  });

  it('an unclaimed member gets its snapshot facts', async () => {
    db.where.mockResolvedValueOnce([memberRow(7)]);
    const got = await new BlizzardForeverFactSource(db as never).load([
      ref('unclaimed', 7, null),
    ]);
    expect(got.get('unclaimed')?.class).toEqual({
      value: 'Priest',
      source: 'blizzard',
      asOf: MEMBER_SYNCED,
    });
  });

  it('a claimed member whose character has no Armory facts falls back to the snapshot', async () => {
    db.where
      .mockResolvedValueOnce([
        charRow('c2', {
          level: null,
          class: null,
          race: null,
          role: null,
          itemLevel: null,
        }),
      ])
      .mockResolvedValueOnce([memberRow(9)]);
    const got = await new BlizzardForeverFactSource(db as never).load([
      ref('manual', 9, 'c2'),
      ref('unsynced', 10, 'c3'),
    ]);
    expect(got.get('manual')?.ilvl?.value).toBe(51);
    expect(got.has('unsynced')).toBe(false);
    expect(db.select).toHaveBeenCalledTimes(2);
  });
});
