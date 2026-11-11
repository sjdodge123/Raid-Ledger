/**
 * ROK-2164 — the separator dashes U+2012..U+2015 (figure, en, em dash,
 * horizontal bar) fold to a space in the name normaliser, so the IGDB/ITAD/Steam sync and the
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
import { GAME_NAME_CORPUS } from '../common/testing/game-name-corpus';

const COLON = "Asgard's Fall: Viking Survivors";
const EXPECTED = "asgard's fall viking survivors";

describe('normalizeForDedup — Unicode dash folding (ROK-2164)', () => {
  it.each([
    ['spaced em dash', "Asgard's Fall — Viking Survivors"],
    ['unspaced em dash', "Asgard's Fall—Viking Survivors"],
    ['spaced en dash', "Asgard's Fall – Viking Survivors"],
    ['unspaced en dash', "Asgard's Fall–Viking Survivors"],
    ['one-sided em dash', "Asgard's Fall —Viking Survivors"],
    ['spaced figure dash U+2012', "Asgard's Fall \u2012 Viking Survivors"],
    ['unspaced horizontal bar U+2015', "Asgard's Fall\u2015Viking Survivors"],
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

/** Dash-bearing names: every one goes through the new fold. */
const DASH_CASES: readonly string[] = [
  'Doom \u2014 Eternal',
  'Doom \u2014 2016',
  'Foo \u2014',
  'Foo \u2014\u2014 Bar',
  'A \u2012 B',
  'A\u2015B',
  'Paris\u2013Dakar',
];

describe('normalizeForDedup — dash-specific boundaries (ROK-2164)', () => {
  it.each([
    ['Doom \u2014 Eternal', 'Doom \u2014 2016'],
    ['Paris\u2013Dakar', 'Paris-Dakar'], // known limit: unspaced en dash != hyphen
    ['Half Life 2', 'Half-Life 2'], // ASCII word-internal hyphen is NOT folded
    ['A \u2212 B', 'A B'], // U+2212 minus is NOT in the class
    ['A \uFF0D B', 'A B'], // U+FF0D fullwidth hyphen-minus is NOT in the class
  ])('keeps %s and %s distinct', (a, b) => {
    expect(namesMatch(normalizeForDedup(a), normalizeForDedup(b))).toBe(false);
  });

  it.each([
    ['Foo \u2014', 'foo'], // trailing dash
    ['Foo \u2014\u2014 Bar', 'foo bar'], // double dash
  ])('%s folds to %s', (input, expected) => {
    expect(normalizeForDedup(input)).toBe(expected);
  });

  it.each([...GAME_NAME_CORPUS, ...DASH_CASES])(
    'is idempotent for %s',
    (input) => {
      const once = normalizeForDedup(input);
      expect(normalizeForDedup(once)).toBe(once);
    },
  );
});
