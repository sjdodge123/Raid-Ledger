/**
 * ROK-2164 — em dash (U+2014) and en dash (U+2013) fold like a spaced ASCII
 * " - " in the name normaliser, so the IGDB/ITAD/Steam sync and the
 * ROK-1113/1438 name-dedup guard stop creating "X — Y" twins of "X: Y".
 *
 * Choice: the Unicode dashes fold spaced AND unspaced (neither appears inside
 * a word in a real title); the ASCII hyphen still folds only when spaced, so
 * "Half-Life" / "Spider-Man" keep their hyphen. Distinct games already known
 * to be distinct (Jamestown / Jamestown+, s.p.l.i.t / Split) must stay apart.
 */
import { namesMatch } from '@raid-ledger/contract';
import { normalizeForDedup } from './igdb-search-dedup.helpers';
import { buildGameNameLockKeys } from './games-name-lock.helpers';

const COLON = "Asgard's Fall: Viking Survivors";
const EXPECTED = "asgard's fall viking survivors";

describe('normalizeForDedup — Unicode dash folding (ROK-2164)', () => {
  it.each([
    ['spaced em dash', "Asgard's Fall — Viking Survivors"],
    ['unspaced em dash', "Asgard's Fall—Viking Survivors"],
    ['spaced en dash', "Asgard's Fall – Viking Survivors"],
    ['unspaced en dash', "Asgard's Fall–Viking Survivors"],
    ['one-sided em dash', "Asgard's Fall —Viking Survivors"],
    ['colon form', COLON],
    ['ASCII spaced hyphen', "Asgard's Fall - Viking Survivors"],
  ])('%s folds to the colon form', (_label, input) => {
    expect(normalizeForDedup(input)).toBe(EXPECTED);
  });

  it('an em-dash name matches its colon twin (namesMatch)', () => {
    expect(
      namesMatch(
        normalizeForDedup("Asgard's Fall — Viking Survivors"),
        normalizeForDedup(COLON),
      ),
    ).toBe(true);
  });

  it('em-dash and colon spellings share ONE advisory-lock key', () => {
    expect(
      buildGameNameLockKeys(["Asgard's Fall — Viking Survivors", COLON]),
    ).toEqual([EXPECTED]);
  });

  it('keeps a word-internal ASCII hyphen', () => {
    expect(normalizeForDedup('Half-Life 2')).toBe('half-life 2');
    expect(normalizeForDedup('Spider-Man')).toBe('spider-man');
  });

  it.each([
    ['Jamestown', 'Jamestown+'],
    ['s.p.l.i.t', 'Split'],
    ['Doom', 'Doom — Eternal'],
  ])('keeps %s and %s distinct', (a, b) => {
    expect(namesMatch(normalizeForDedup(a), normalizeForDedup(b))).toBe(false);
  });
});
