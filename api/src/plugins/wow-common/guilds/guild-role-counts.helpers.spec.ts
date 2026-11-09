import { computeRoleCounts, roleCountRows } from './guild-role-counts.helpers';
import type { RawRosterRow } from './guild-roster.helpers';

let nextMember = 1;
function row(over: Partial<RawRosterRow>): RawRosterRow {
  const memberId = nextMember++;
  return {
    memberId,
    name: `m${memberId}`,
    class: null,
    level: null,
    rankIndex: 3,
    rankName: null,
    characterId: `char-${memberId}`,
    userId: null,
    role: null,
    roleOverride: null,
    isMain: false,
    onlineAtExport: null,
    lastOnlineDays: null,
    ...over,
  };
}

/** An unclaimed roster member: no character, no owner. */
function unlinked(over: Partial<RawRosterRow>): RawRosterRow {
  return row({ characterId: null, userId: null, ...over });
}

describe('computeRoleCounts', () => {
  it('counts a user once, by their main, however many alts are linked', () => {
    const counts = computeRoleCounts([
      row({ userId: 1, role: 'dps', rankIndex: 1 }),
      row({ userId: 1, role: 'tank', isMain: true, rankIndex: 4 }),
      row({ userId: 1, role: 'healer', rankIndex: 2 }),
    ]);
    expect(counts).toEqual({ tank: 1, healer: 0, dps: 0, unknown: 0 });
  });

  it('without a main in the guild, takes the highest-rank character', () => {
    const counts = computeRoleCounts([
      row({ userId: 2, role: 'dps', rankIndex: 5 }),
      row({ userId: 2, roleOverride: 'healer', role: 'dps', rankIndex: 1 }),
      row({ userId: 2, role: 'tank', rankIndex: null }),
    ]);
    expect(counts).toEqual({ tank: 0, healer: 1, dps: 0, unknown: 0 });
  });

  it('counts each unlinked member too; a member with no role is unknown (ROK-2158)', () => {
    const counts = computeRoleCounts([
      unlinked({ armoryRole: null }),
      row({ userId: 3, role: null }),
      row({ userId: 4, role: 'dps' }),
      row({ userId: 5, role: 'dps', isMain: true }),
    ]);
    expect(counts).toEqual({ tank: 0, healer: 0, dps: 2, unknown: 2 });
  });

  it('an unlinked member with an Armory healer role counts as a healer (ROK-2158)', () => {
    const counts = computeRoleCounts([
      unlinked({ name: 'Bambolina', armoryRole: 'healer' }),
      row({ userId: 6, roleOverride: 'tank' }),
    ]);
    expect(counts).toEqual({ tank: 1, healer: 1, dps: 0, unknown: 0 });
  });

  it('a linked character with no manual role counts by its Armory role (ROK-2158)', () => {
    const counts = computeRoleCounts([
      row({ userId: 7, role: 'dps', armoryRole: 'healer' }),
    ]);
    expect(counts).toEqual({ tank: 0, healer: 1, dps: 0, unknown: 0 });
  });

  it('the override wins over the Armory role; an invalid Armory role falls through (ROK-2158)', () => {
    const counts = computeRoleCounts([
      row({ userId: 8, roleOverride: 'tank', armoryRole: 'healer' }),
      row({ userId: 9, role: 'dps', armoryRole: 'bard' }),
      unlinked({ armoryRole: 'bard' }),
    ]);
    expect(counts).toEqual({ tank: 1, healer: 0, dps: 1, unknown: 1 });
  });
});

describe('roleCountRows (ROK-2158)', () => {
  it('keeps one row per unlinked memberId and one per linked user', () => {
    const member = unlinked({ armoryRole: 'healer' });
    const dupe = { ...member, name: 'same member, another join row' };
    const main = row({ userId: 10, isMain: true });
    const alt = row({ userId: 10, rankIndex: 0 });
    expect(roleCountRows([member, dupe, alt, main])).toEqual([main, member]);
    expect(computeRoleCounts([member, dupe, alt, main])).toMatchObject({
      healer: 1,
    });
  });

  it('keeps every unlinked row that has no roster member id', () => {
    const a = { ...unlinked({}), memberId: null };
    const b = { ...unlinked({}), memberId: null };
    expect(roleCountRows([a, b])).toEqual([a, b]);
  });
});
