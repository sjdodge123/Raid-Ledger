import { computeRoleCounts } from './guild-role-counts.helpers';
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
    ...over,
  };
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

  it('skips unlinked members and counts a role-less character as unknown', () => {
    const counts = computeRoleCounts([
      row({ characterId: null, userId: null, role: 'dps' }),
      row({ userId: 3, role: null }),
      row({ userId: 4, role: 'dps' }),
      row({ userId: 5, role: 'dps', isMain: true }),
    ]);
    expect(counts).toEqual({ tank: 0, healer: 0, dps: 2, unknown: 1 });
  });
});
