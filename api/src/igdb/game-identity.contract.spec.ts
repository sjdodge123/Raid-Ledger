/**
 * The game-name identity helpers live in `@raid-ledger/contract` (ROK-1668,
 * RH-1b AC1/AC2). The api keeps re-exports at the old paths.
 *
 * - The frozen golden corpus runs through the CONTRACT import, so the moved
 *   code is pinned to the values captured on the pre-move api code.
 * - The api re-exports must be the SAME objects as the contract exports
 *   (`toBe`), not look-alike copies that could drift apart.
 * - `tokenCount` / `namesMatch` were private to the api before the move; they
 *   get their own unit cases here through the contract import.
 */
import {
  buildGameNameLockKeys,
  namesMatch,
  normalizeForDedup,
  ROMAN_ARABIC_PAIRS,
  tokenCount,
} from '@raid-ledger/contract';
import { normalizeForDedup as apiNormalizeForDedup } from './igdb-search-dedup.helpers';
import { buildGameNameLockKeys as apiBuildGameNameLockKeys } from './games-name-lock.helpers';
import { ROMAN_ARABIC_PAIRS as apiRomanArabicPairs } from '../common/search.util';
import {
  GAME_NAME_CORPUS,
  LOCK_KEYS_CORPUS,
  LOCK_KEYS_GOLDEN,
  NORMALIZE_GOLDEN,
  ROMAN_PAIRS_GOLDEN,
} from '../common/testing/game-name-corpus';

describe('api re-exports are the contract exports (same object)', () => {
  it('normalizeForDedup', () => {
    expect(apiNormalizeForDedup).toBe(normalizeForDedup);
  });

  it('buildGameNameLockKeys', () => {
    expect(apiBuildGameNameLockKeys).toBe(buildGameNameLockKeys);
  });

  it('ROMAN_ARABIC_PAIRS', () => {
    expect(apiRomanArabicPairs).toBe(ROMAN_ARABIC_PAIRS);
  });
});

describe('normalizeForDedup golden (@raid-ledger/contract)', () => {
  it.each(GAME_NAME_CORPUS.map((input) => [JSON.stringify(input), input]))(
    'normalizes %s to its captured value',
    (_label, input) => {
      expect(normalizeForDedup(input)).toBe(NORMALIZE_GOLDEN[input]);
    },
  );
});

describe('buildGameNameLockKeys golden (@raid-ledger/contract)', () => {
  it.each(LOCK_KEYS_CORPUS.map((c) => [c.label, c.input] as const))(
    'derives the captured keys for: %s',
    (label, input) => {
      expect(buildGameNameLockKeys(input)).toEqual(LOCK_KEYS_GOLDEN[label]);
    },
  );
});

describe('ROMAN_ARABIC_PAIRS golden (@raid-ledger/contract)', () => {
  it('keeps the captured pairs in longest-first order', () => {
    expect(ROMAN_ARABIC_PAIRS).toEqual(ROMAN_PAIRS_GOLDEN);
  });
});

describe('tokenCount (@raid-ledger/contract)', () => {
  it('counts an empty name as zero tokens', () => {
    expect(tokenCount('')).toBe(0);
  });

  it('counts space-separated tokens, ignoring empty runs', () => {
    expect(tokenCount('slay the spire 2')).toBe(4);
    expect(tokenCount('doom  eternal')).toBe(2);
  });
});

describe('namesMatch (@raid-ledger/contract)', () => {
  it('does not match a name against a longer title that extends it', () => {
    expect(namesMatch('doom', 'doom eternal')).toBe(false);
  });

  it('matches identical normalized names', () => {
    const roman = normalizeForDedup('Slay the Spire II');
    const arabic = normalizeForDedup('Slay the Spire 2');
    expect(namesMatch(roman, arabic)).toBe(true);
    expect(namesMatch('doom', 'doom')).toBe(true);
  });

  it('never matches an empty name', () => {
    expect(namesMatch('', '')).toBe(false);
    expect(namesMatch('', 'doom')).toBe(false);
    expect(namesMatch('doom', '')).toBe(false);
  });
});
