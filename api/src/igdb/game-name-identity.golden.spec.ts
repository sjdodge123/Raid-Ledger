/**
 * Golden pin for the game-name identity helpers (ROK-1668, RH-1b AC2).
 *
 * Captured on the PRE-move code and asserted through the OLD api import paths,
 * so the move into `@raid-ledger/contract` must leave every value unchanged.
 * This file and `common/testing/game-name-corpus.ts` are frozen after the
 * capture commit — a diff to either is a behaviour change, not a refactor.
 */
import { normalizeForDedup } from './igdb-search-dedup.helpers';
import { buildGameNameLockKeys } from './games-name-lock.helpers';
import { ROMAN_ARABIC_PAIRS } from '../common/search.util';
import {
  GAME_NAME_CORPUS,
  LOCK_KEYS_CORPUS,
  LOCK_KEYS_GOLDEN,
  NORMALIZE_GOLDEN,
  ROMAN_PAIRS_GOLDEN,
} from '../common/testing/game-name-corpus';

describe('game-name corpus integrity', () => {
  it('has exactly one golden value per normalize input', () => {
    expect(new Set(GAME_NAME_CORPUS).size).toBe(GAME_NAME_CORPUS.length);
    expect(Object.keys(NORMALIZE_GOLDEN).sort()).toEqual(
      [...GAME_NAME_CORPUS].sort(),
    );
  });

  it('has exactly one golden value per lock-keys case', () => {
    const labels = LOCK_KEYS_CORPUS.map((c) => c.label);
    expect(new Set(labels).size).toBe(labels.length);
    expect(Object.keys(LOCK_KEYS_GOLDEN).sort()).toEqual([...labels].sort());
  });
});

describe('normalizeForDedup golden (old api path)', () => {
  it.each(GAME_NAME_CORPUS.map((input) => [JSON.stringify(input), input]))(
    'normalizes %s to its captured value',
    (_label, input) => {
      expect(normalizeForDedup(input)).toBe(NORMALIZE_GOLDEN[input]);
    },
  );
});

describe('buildGameNameLockKeys golden (old api path)', () => {
  it.each(LOCK_KEYS_CORPUS.map((c) => [c.label, c.input] as const))(
    'derives the captured keys for: %s',
    (label, input) => {
      expect(buildGameNameLockKeys(input)).toEqual(LOCK_KEYS_GOLDEN[label]);
    },
  );
});

describe('ROMAN_ARABIC_PAIRS golden (old api path)', () => {
  it('keeps the captured pairs in longest-first order', () => {
    expect(ROMAN_ARABIC_PAIRS).toEqual(ROMAN_PAIRS_GOLDEN);
  });
});
