/**
 * ROK-2352 §2.1 / §3.4 — WoW LFG catalogue: slug → variant, key grammar,
 * catalogue groups (dungeons + raids) and their roster shapes.
 */
import {
  catalogueInstancesFor,
  parseWowGroupKey,
  toWowGroupDescriptor,
  wowGroupKey,
  wowVariantForSlug,
  type WowLfgInstance,
} from './wow-lfg-catalogue';
import { buildWowLockInFields } from './wow-lfg-lock-in.helpers';
import { ALL_WOW_GAME_SLUGS } from '../manifest';

const inst = (over: Partial<WowLfgInstance>): WowLfgInstance => ({
  id: 36,
  name: 'The Deadmines',
  expansion: 'Classic',
  category: 'dungeon',
  maxPlayers: 5,
  minimumLevel: 17,
  maximumLevel: 26,
  ...over,
});

describe('wowVariantForSlug', () => {
  it('maps every WoW slug the plugin registers to a variant', () => {
    expect(
      ALL_WOW_GAME_SLUGS.filter((s) => wowVariantForSlug(s) === null),
    ).toEqual([]);
  });

  it('treats world-of-warcraft-classic as Classic Era, Forever as wow_forever', () => {
    expect(wowVariantForSlug('world-of-warcraft-classic')).toBe('classic_era');
    expect(wowVariantForSlug('world-of-warcraft-forever')).toBe('wow_forever');
    expect(wowVariantForSlug('valheim')).toBeNull();
  });
});

describe('group keys', () => {
  it('mints and parses dungeon/raid keys', () => {
    expect(wowGroupKey({ category: 'raid', id: 409 })).toBe('raid:409');
    expect(parseWowGroupKey('dungeon:36')).toEqual({
      category: 'dungeon',
      id: 36,
    });
  });

  it.each([
    '',
    'dungeon:',
    'dungeon:0',
    'arena:3',
    'raid:12:heroic',
    'dungeon:abc',
  ])('rejects %p', (key) => expect(parseWowGroupKey(key)).toBeNull());
});

describe('catalogueInstancesFor', () => {
  it('returns dungeons then raids for Classic Era', () => {
    const rows = catalogueInstancesFor('classic_era') ?? [];
    const firstRaid = rows.findIndex((r) => r.category === 'raid');
    expect(rows.some((r) => r.category === 'dungeon')).toBe(true);
    expect(firstRaid).toBeGreaterThan(0);
    expect(rows.slice(firstRaid).every((r) => r.category === 'raid')).toBe(
      true,
    );
  });

  it('is null for journal-served variants', () => {
    expect(catalogueInstancesFor('retail')).toBeNull();
    expect(catalogueInstancesFor('classic')).toBeNull();
  });
});

describe('toWowGroupDescriptor', () => {
  it('shapes a dungeon 1/1/3 with its level range', () => {
    expect(toWowGroupDescriptor(inst({}))).toEqual({
      key: 'dungeon:36',
      label: 'The Deadmines',
      kind: 'dungeon',
      size: 5,
      rosterShape: { tank: 1, healer: 1, dps: 3 },
      levelRange: [17, 26],
    });
  });

  it('shapes a 40-man raid 4/10/26 and a sizeless raid as 10', () => {
    const mc = toWowGroupDescriptor(
      inst({ id: 409, category: 'raid', maxPlayers: 40 }),
    );
    expect(mc.rosterShape).toEqual({ tank: 4, healer: 10, dps: 26 });
    const journal = toWowGroupDescriptor(
      inst({ category: 'raid', maxPlayers: null, minimumLevel: null }),
    );
    expect(journal.size).toBe(10);
    expect(journal.levelRange).toBeUndefined();
  });
});

describe('buildWowLockInFields', () => {
  it('locks a dungeon into an mmo 1/1/3 roster titled after it', () => {
    const f = buildWowLockInFields(inst({}));
    expect(f.slotConfig).toEqual({ type: 'mmo', tank: 1, healer: 1, dps: 3 });
    expect(f.title).toBe('The Deadmines');
    expect(f.contentInstances).toEqual([
      expect.objectContaining({ id: 36, category: 'dungeon', maxPlayers: 5 }),
    ]);
  });

  it('locks a 40-man raid into 4/10/26', () => {
    const f = buildWowLockInFields(
      inst({ id: 409, name: 'Molten Core', category: 'raid', maxPlayers: 40 }),
    );
    expect(f.slotConfig).toEqual({ type: 'mmo', tank: 4, healer: 10, dps: 26 });
  });
});
