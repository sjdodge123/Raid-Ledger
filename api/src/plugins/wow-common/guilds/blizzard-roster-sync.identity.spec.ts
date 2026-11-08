/**
 * ROK-2139 — Forever roster identity: LedgerLink stores "Name Surname", the
 * Blizzard API returns "Name". Unique first names pair; ambiguous ones do
 * not; the Blizzard id always wins; earlier junk rows merge; a sync pairing
 * fewer than half of the GUID roster is refused.
 */
import type { ForeverGuildMember } from '../blizzard-forever-guild.helpers';
import {
  matchRosterMembers,
  type ExistingRosterRow,
} from './blizzard-roster-sync.helpers';
import {
  firstNameKey,
  identityMismatch,
  planJunkMerges,
  withMergesApplied,
} from './blizzard-roster-sync.identity';

const OLD_T = new Date('2026-01-01T00:00:00.000Z');
const ADDON_T = new Date('2026-11-01T00:00:00.000Z');
const SYNC_T = new Date('2026-11-07T00:00:00.000Z');

const api = (
  name: string,
  blizzardId: number | null = null,
): ForeverGuildMember => ({ name, level: 60, classId: 8, rank: 3, blizzardId });

let nextId = 1;
function row(over: Partial<ExistingRosterRow>): ExistingRosterRow {
  const id = nextId++;
  return {
    id,
    guid: `Player-1-${String(id).padStart(4, '0')}`,
    blizzardCharacterId: null,
    characterName: `Member${id}`,
    className: null,
    level: 60,
    rankIndex: 3,
    rankName: 'Raider',
    lastSeenAt: ADDON_T,
    ...over,
  };
}
const junk = (name: string, blizzardId: number) =>
  row({
    guid: null,
    characterName: name,
    blizzardCharacterId: blizzardId,
    lastSeenAt: SYNC_T,
  });

const pairs = (res: ReturnType<typeof matchRosterMembers>) =>
  res.matched.map((m) => [m.existingId, m.member.name]);

describe('firstNameKey', () => {
  it('takes the lower-cased part before the first space', () => {
    expect(firstNameKey('  Rok   Androl ')).toBe('rok');
    expect(firstNameKey('Hiphoptobop')).toBe('hiphoptobop');
  });
});

describe('matchRosterMembers — Forever first-name rule (ROK-2139)', () => {
  it('pairs "Rok Androl" (LedgerLink) with "Rok" (Blizzard)', () => {
    const rok = row({ characterName: 'Rok Androl' });
    const hip = row({ characterName: 'Hiphoptobop Smith' });
    const res = matchRosterMembers(
      [rok, hip],
      [api('Rok'), api('Hiphoptobop')],
    );
    expect(pairs(res)).toEqual([
      [rok.id, 'Rok'],
      [hip.id, 'Hiphoptobop'],
    ]);
    expect(res.unmatched).toEqual([]);
  });

  it('does not pair a first name two GUID rows share', () => {
    const a = row({ characterName: 'Rok Androl' });
    const b = row({ characterName: 'Rok Bloggs' });
    const res = matchRosterMembers([a, b], [api('Rok')]);
    expect(res.matched).toEqual([]);
    expect(res.unmatched.map((m) => m.name)).toEqual(['Rok']);
  });

  it('does not pair a first name two roster members share', () => {
    const a = row({ characterName: 'Rok Androl' });
    const res = matchRosterMembers([a], [api('Rok', 1), api('rok', 2)]);
    expect(res.matched).toEqual([]);
  });

  it('the Blizzard id wins over a first-name candidate', () => {
    const named = row({ characterName: 'Rok Androl' });
    const bound = row({ characterName: 'Other Name', blizzardCharacterId: 77 });
    const res = matchRosterMembers([named, bound], [api('Rok', 77)]);
    expect(pairs(res)).toEqual([[bound.id, 'Rok']]);
  });

  it('an exact full name still wins over the first-name rule', () => {
    const exact = row({ characterName: 'Rok' });
    const res = matchRosterMembers([exact], [api('Rok')]);
    expect(pairs(res)).toEqual([[exact.id, 'Rok']]);
  });

  it('M1: never pairs with a departed GUID row (older than the newest batch)', () => {
    const departed = row({ characterName: 'Rok Androl', lastSeenAt: OLD_T });
    const hip = row({ characterName: 'Hip Smith' });
    const res = matchRosterMembers([departed, hip], [api('Rok'), api('Hip')]);
    expect(pairs(res)).toEqual([[hip.id, 'Hip']]);
    expect(res.unmatched.map((m) => m.name)).toEqual(['Rok']);
  });

  it('M1: a departed namesake does not make the current row ambiguous', () => {
    const departed = row({ characterName: 'Rok Androl', lastSeenAt: OLD_T });
    const current = row({ characterName: 'Rok Bloggs' });
    const res = matchRosterMembers([departed, current], [api('Rok')]);
    expect(pairs(res)).toEqual([[current.id, 'Rok']]);
  });

  it('M1: never pairs across classes when both are known', () => {
    const warrior = row({ characterName: 'Rok Androl', className: 'Warrior' });
    expect(matchRosterMembers([warrior], [api('Rok')]).matched).toEqual([]);
    const mage = row({ characterName: 'Rok Androl', className: 'Mage' });
    expect(pairs(matchRosterMembers([mage], [api('Rok')]))).toEqual([
      [mage.id, 'Rok'],
    ]);
  });

  it('never steals a row bound to another Blizzard id', () => {
    const bound = row({ characterName: 'Rok Androl', blizzardCharacterId: 5 });
    const res = matchRosterMembers([bound], [api('Rok', 6)]);
    expect(res.matched).toEqual([]);
  });
});

describe('planJunkMerges — repair rows an earlier sync inserted', () => {
  it('merges a junk "Rok" into GUID row "Rok Androl" by first name', () => {
    const rok = row({ characterName: 'Rok Androl' });
    const j = junk('Rok', 900);
    expect(planJunkMerges([rok, j])).toEqual([
      { junkId: j.id, targetId: rok.id, blizzardCharacterId: 900 },
    ]);
  });

  it('merges by Blizzard id before first name', () => {
    const named = row({ characterName: 'Rok Androl' });
    const bound = row({ characterName: 'Kor Other', blizzardCharacterId: 900 });
    const j = junk('Rok', 900);
    expect(planJunkMerges([named, bound, j])).toEqual([
      { junkId: j.id, targetId: bound.id, blizzardCharacterId: 900 },
    ]);
  });

  it('M1: never merges into a departed GUID row by first name', () => {
    const departed = row({ characterName: 'Rok Androl', lastSeenAt: OLD_T });
    const current = row({ characterName: 'Hip Smith' });
    expect(planJunkMerges([departed, current, junk('Rok', 900)])).toEqual([]);
  });

  it('M1: never merges across classes when both are known', () => {
    const rok = row({ characterName: 'Rok Androl', className: 'Mage' });
    const j = { ...junk('Rok', 900), className: 'Warrior' };
    expect(planJunkMerges([rok, j])).toEqual([]);
  });

  it('leaves an ambiguous junk row alone', () => {
    const a = row({ characterName: 'Rok Androl' });
    const b = row({ characterName: 'Rok Bloggs' });
    expect(planJunkMerges([a, b, junk('Rok', 900)])).toEqual([]);
  });

  it('is idempotent: the merged rows plan nothing more', () => {
    const rows = [row({ characterName: 'Rok Androl' }), junk('Rok', 900)];
    const once = withMergesApplied(rows, planJunkMerges(rows));
    expect(
      once.map((r) => [
        r.characterName,
        r.guid !== null,
        r.blizzardCharacterId,
      ]),
    ).toEqual([['Rok Androl', true, 900]]);
    expect(planJunkMerges(once)).toEqual([]);
  });
});

describe('identityMismatch — the safety guard', () => {
  const guild = () =>
    Array.from({ length: 4 }, (_, i) => row({ characterName: `Name${i} Sur` }));

  it('refuses when fewer than half of the latest GUID rows matched', () => {
    const rows = guild();
    const reason = identityMismatch(rows, new Set([rows[0]?.id ?? -1]), 3);
    expect(reason).toContain('matched only 1 of 4 LedgerLink members');
  });

  it('allows exactly half', () => {
    const rows = guild();
    const ids = new Set(rows.slice(0, 2).map((r) => r.id));
    expect(identityMismatch(rows, ids, 2)).toBeNull();
  });

  it('allows a guild with no GUID rows (Blizzard-only)', () => {
    expect(identityMismatch([junk('Rok', 1)], new Set(), 0)).toBeNull();
  });

  it('counts only the newest GUID snapshot, not departed members', () => {
    const gone = Array.from({ length: 6 }, () =>
      row({ lastSeenAt: new Date('2026-01-01T00:00:00.000Z') }),
    );
    const live = guild();
    const ids = new Set(live.map((r) => r.id));
    expect(identityMismatch([...gone, ...live], ids, 0)).toBeNull();
  });

  it('M2: allows a real shrink (8 → 2, both matched, nobody new)', () => {
    const rows = Array.from({ length: 8 }, () => row({}));
    const ids = new Set(rows.slice(0, 2).map((r) => r.id));
    expect(identityMismatch(rows, ids, 0)).toBeNull();
  });

  it('M2: allows a small reference batch in a mostly-Blizzard guild', () => {
    const ref = Array.from({ length: 3 }, () => row({}));
    const blizz = Array.from({ length: 38 }, (_, i) => junk(`B${i}`, 500 + i));
    const ids = new Set([ref[0]?.id ?? -1, ...blizz.map((r) => r.id)]);
    expect(identityMismatch([...ref, ...blizz], ids, 0)).toBeNull();
  });
});

describe('the operator case — 11 Forever GUID rows vs 11 Blizzard first names', () => {
  const guidRows = () =>
    Array.from({ length: 11 }, (_, i) =>
      row({ characterName: `Nm${i}x Sur${i}`, className: 'Mage' }),
    );
  const check = (rows: ExistingRosterRow[], roster: ForeverGuildMember[]) => {
    const res = matchRosterMembers(rows, roster);
    const ids = new Set(res.matched.map((m) => m.existingId));
    return { res, reason: identityMismatch(rows, ids, res.unmatched.length) };
  };

  it('0 full-name matches, all 11 pair by first name and the guard allows it', () => {
    const rows = guidRows();
    const roster = rows.map((_, i) => api(`Nm${i}x`, 900 + i));
    const { res, reason } = check(rows, roster);
    expect(pairs(res)).toEqual(rows.map((r, i) => [r.id, `Nm${i}x`]));
    expect(res.unmatched).toEqual([]);
    expect(reason).toBeNull();
  });

  it('a real mismatch (0 of 11 paired, 11 unknown names) is refused', () => {
    const rows = guidRows();
    const roster = rows.map((_, i) => api(`Zz${i}q`, 900 + i));
    const { res, reason } = check(rows, roster);
    expect(res.matched).toEqual([]);
    expect(reason).toContain('matched only 0 of 11 LedgerLink members');
  });
});
