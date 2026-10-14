import {
  dedupeByMember,
  effectiveRole,
  groupRoster,
  type RawRosterRow,
} from './guild-roster.helpers';

const CHAR = '11111111-1111-4111-8111-111111111111';

function row(over: Partial<RawRosterRow>): RawRosterRow {
  return {
    memberId: 1,
    name: 'Anna',
    class: 'Mage',
    level: 60,
    rankIndex: 2,
    rankName: 'Raider',
    characterId: null,
    role: null,
    roleOverride: null,
    isMain: null,
    ...over,
  };
}

describe('effectiveRole', () => {
  it('prefers roleOverride over role', () => {
    expect(effectiveRole(row({ role: 'dps', roleOverride: 'healer' }))).toBe(
      'healer',
    );
  });

  it('falls back to role, and drops values outside the enum', () => {
    expect(effectiveRole(row({ role: 'tank' }))).toBe('tank');
    expect(effectiveRole(row({ role: 'bard' }))).toBeNull();
    expect(effectiveRole(row({}))).toBeNull();
  });
});

describe('dedupeByMember', () => {
  it('keeps one row per member, preferring the main character', () => {
    const out = dedupeByMember([
      row({ memberId: 7, characterId: 'alt', isMain: false }),
      row({ memberId: 7, characterId: CHAR, isMain: true }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]?.characterId).toBe(CHAR);
  });
});

describe('groupRoster', () => {
  it('groups by rank ascending with null ranks last, names sorted', () => {
    const groups = groupRoster([
      row({ memberId: 1, name: 'zed', rankIndex: 2 }),
      row({ memberId: 2, name: 'Bob', rankIndex: null, rankName: null }),
      row({ memberId: 3, name: 'Gm', rankIndex: 0, rankName: 'Guild Master' }),
      row({ memberId: 4, name: 'amy', rankIndex: 2 }),
    ]);
    expect(groups.map((g) => [g.rankIndex, g.rankName])).toEqual([
      [0, 'Guild Master'],
      [2, 'Raider'],
      [null, null],
    ]);
    expect(groups[1]?.members.map((m) => m.name)).toEqual(['amy', 'zed']);
  });

  it('maps a linked row to the contract row; unlinked has null id (D9)', () => {
    const [group] = groupRoster([
      row({ memberId: 1, characterId: CHAR, role: 'tank', isMain: true }),
      row({ memberId: 2, name: 'Bea' }),
    ]);
    expect(group?.members).toEqual([
      {
        memberId: 1,
        name: 'Anna',
        class: 'Mage',
        level: 60,
        rankIndex: 2,
        rankName: 'Raider',
        effectiveRole: 'tank',
        characterId: CHAR,
        isMain: true,
      },
      expect.objectContaining({
        memberId: 2,
        characterId: null,
        effectiveRole: null,
        isMain: false,
      }),
    ]);
  });

  it('returns no groups for an empty roster', () => {
    expect(groupRoster([])).toEqual([]);
  });
});
