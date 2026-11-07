/**
 * ROK-1928 B1 — pure roster-sync rules: class-id map (B-2), member matching
 * (blizzard id, then lower(name), B-5 duplicates), rank-name carry (B-3),
 * the update patch's column allow-list (§B2 step 6) and the empty guard (B-4).
 */
import { titleCaseClass } from '../addon-import/addon-import.binding-name';
import type { ForeverGuildMember } from '../blizzard-forever-guild.helpers';
import {
  classNameForForeverId,
  isEmptyRoster,
  matchRosterMembers,
  nextRankName,
  rosterUpdatePatch,
  type ExistingRosterRow,
} from './blizzard-roster-sync.helpers';

const T = new Date('2026-11-06T12:00:00.000Z');

function member(over: Partial<ForeverGuildMember> = {}): ForeverGuildMember {
  return {
    name: 'Ana Example',
    level: 60,
    classId: 8,
    rank: 0,
    blizzardId: 800001,
    ...over,
  };
}

function row(over: Partial<ExistingRosterRow> = {}): ExistingRosterRow {
  return {
    id: 1,
    guid: 'Player-1-0001',
    blizzardCharacterId: null,
    characterName: 'Ana Example',
    level: 58,
    rankIndex: 0,
    rankName: 'Guild Master',
    lastSeenAt: new Date('2026-11-01T00:00:00.000Z'),
    ...over,
  };
}

describe('classNameForForeverId (B-2)', () => {
  it.each([
    [1, 'WARRIOR'],
    [2, 'PALADIN'],
    [3, 'HUNTER'],
    [4, 'ROGUE'],
    [5, 'PRIEST'],
    [7, 'SHAMAN'],
    [8, 'MAGE'],
    [9, 'WARLOCK'],
    [11, 'DRUID'],
  ])(
    'Given class id %i, When mapped, Then it equals titleCaseClass(%s)',
    (id, token) => {
      expect(classNameForForeverId(id)).toBe(titleCaseClass(token));
    },
  );

  it('Given class id 8, When mapped, Then it is "Mage"', () => {
    expect(classNameForForeverId(8)).toBe('Mage');
  });

  it.each([[6], [10], [12], [99], [null]])(
    'Given unknown class id %p, When mapped, Then it is null',
    (id) => {
      expect(classNameForForeverId(id)).toBeNull();
    },
  );
});

describe('matchRosterMembers (B2 step 5)', () => {
  it('Given a stored blizzard id, When an incoming member carries it, Then it matches even after a rename', () => {
    const existing = [
      row({ id: 7, blizzardCharacterId: 800001, characterName: 'Old Name' }),
    ];
    const result = matchRosterMembers(existing, [member()]);
    expect(result.matched).toEqual([{ existingId: 7, member: member() }]);
    expect(result.unmatched).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('Given no stored blizzard id, When names differ only in case, Then it matches by lower(name)', () => {
    const existing = [row({ id: 3, characterName: 'ana EXAMPLE' })];
    const result = matchRosterMembers(existing, [member()]);
    expect(result.matched).toEqual([{ existingId: 3, member: member() }]);
  });

  it('Given an incoming member with no stored row, When matched, Then it is unmatched', () => {
    const incoming = member({ name: 'Bo Sample', blizzardId: 800002 });
    const result = matchRosterMembers([row()], [incoming]);
    expect(result.matched).toEqual([]);
    expect(result.unmatched).toEqual([incoming]);
  });

  it('Given a stored row with another blizzard id, When names match, Then it is not matched by name', () => {
    const existing = [row({ blizzardCharacterId: 555 })];
    const result = matchRosterMembers(existing, [member()]);
    expect(result.unmatched).toEqual([member()]);
  });

  it('Given two rows sharing lower(name), When matched, Then the newest last_seen_at wins and a warning is returned', () => {
    const existing = [
      row({ id: 1, lastSeenAt: new Date('2026-10-01T00:00:00.000Z') }),
      row({ id: 2, characterName: 'ANA EXAMPLE', lastSeenAt: T }),
      row({ id: 3, lastSeenAt: null }),
    ];
    const result = matchRosterMembers(existing, [member()]);
    expect(result.matched).toEqual([{ existingId: 2, member: member() }]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('ana example');
  });

  it('Given one stored row, When two incoming members claim it, Then only the first matches', () => {
    const existing = [row({ id: 4, blizzardCharacterId: 800001 })];
    const twin = member({ blizzardId: 800009 });
    const result = matchRosterMembers(existing, [member(), twin]);
    expect(result.matched).toEqual([{ existingId: 4, member: member() }]);
    expect(result.unmatched).toEqual([twin]);
  });
});

describe('nextRankName (B-3)', () => {
  it('Given an unchanged rank index, When computed, Then the stored rank name is kept', () => {
    expect(nextRankName(2, 'Officer', 2)).toBe('Officer');
  });

  it('Given a changed rank index, When computed, Then the rank name is null', () => {
    expect(nextRankName(2, 'Officer', 3)).toBeNull();
  });

  it('Given no previous rank (insert), When computed, Then the rank name is null', () => {
    expect(nextRankName(null, null, 0)).toBeNull();
  });
});

describe('rosterUpdatePatch (B2 step 6)', () => {
  it('Given a mapped member, When patched, Then only the allowed columns are written', () => {
    const patch = rosterUpdatePatch(row(), member(), T);
    expect(patch).toEqual({
      level: 60,
      class: 'Mage',
      rankIndex: 0,
      rankName: 'Guild Master',
      blizzardCharacterId: 800001,
      lastSeenAt: T,
      updatedAt: T,
    });
  });

  it('Given an unknown class and no blizzard id, When patched, Then class and blizzard id are left untouched', () => {
    const patch = rosterUpdatePatch(
      row(),
      member({ classId: 99, blizzardId: null }),
      T,
    );
    expect(patch).not.toHaveProperty('class');
    expect(patch).not.toHaveProperty('blizzardCharacterId');
  });

  it('Given a rank change, When patched, Then the rank name is cleared', () => {
    const patch = rosterUpdatePatch(row(), member({ rank: 3 }), T);
    expect(patch.rankIndex).toBe(3);
    expect(patch.rankName).toBeNull();
  });

  it('Given any member, When patched, Then addon-owned columns are never written', () => {
    const keys = Object.keys(rosterUpdatePatch(row(), member(), T));
    for (const forbidden of [
      'guid',
      'publicNote',
      'onlineAtExport',
      'lastOnlineDays',
      'capturedByUserId',
      'source',
    ]) {
      expect(keys).not.toContain(forbidden);
    }
  });
});

describe('isEmptyRoster (B-4)', () => {
  it('Given no members, When checked, Then it is empty (skipped_empty)', () => {
    expect(isEmptyRoster({ members: [] })).toBe(true);
  });

  it('Given one member, When checked, Then it is not empty', () => {
    expect(isEmptyRoster({ members: [member()] })).toBe(false);
  });
});
