/**
 * ROK-2025 — unit tests for the organizer's bench pick: the overflow
 * arithmetic and every 400 branch with its exact copy. The DB reads behind
 * `assertBenchPick` are covered by
 * `standalone-poll-bench-pick.integration.spec.ts`.
 */
import { BadRequestException } from '@nestjs/common';
import {
  benchPickCountMessage,
  benchPickOverflow,
  checkBenchPick,
} from './standalone-poll-bench-pick.helpers';

/** The message of the BadRequestException `fn` throws, or a marker. */
function badRequestMessage(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    if (err instanceof BadRequestException) return err.message;
    throw err;
  }
  return '<no throw>';
}

const CANDIDATES: ReadonlySet<number> = new Set([11, 12, 13, 14]);

describe('benchPickOverflow (ROK-2025)', () => {
  it('is the candidates past the open spots', () => {
    // 2 spots, creator holds 1 → 1 open; 4 candidates → 3 over.
    expect(benchPickOverflow(2, 1, 4)).toBe(3);
  });

  it('is 0 when every candidate fits', () => {
    expect(benchPickOverflow(5, 1, 4)).toBe(0);
  });

  it('is 0 for an unlimited roster', () => {
    expect(benchPickOverflow(null, 9, 4)).toBe(0);
  });

  it('treats an over-full roster as zero open spots', () => {
    expect(benchPickOverflow(2, 3, 2)).toBe(2);
  });
});

describe('checkBenchPick (ROK-2025)', () => {
  it('returns the picked set when it is exactly the overflow of candidates', () => {
    expect([...checkBenchPick([12, 11], CANDIDATES, 2)]).toEqual([12, 11]);
  });

  it('accepts an empty pick when nobody overflows', () => {
    expect([...checkBenchPick([], CANDIDATES, 0)]).toEqual([]);
  });

  it('refuses a duplicate id with the duplicate copy', () => {
    expect(badRequestMessage(() => checkBenchPick([11, 11], CANDIDATES, 2))).toBe(
      'Each person can only be picked for the bench once.',
    );
  });

  it('refuses a non-candidate (creator / non-voter / other slot)', () => {
    expect(badRequestMessage(() => checkBenchPick([11, 99], CANDIDATES, 2))).toBe(
      'Only people who voted yes for this time can go to the bench.',
    );
  });

  it('refuses one too few with the exact-count copy', () => {
    expect(badRequestMessage(() => checkBenchPick([11], CANDIDATES, 2))).toBe(
      'The votes changed while you were choosing. Pick exactly 2 for the bench.',
    );
  });

  it('refuses one too many with the exact-count copy', () => {
    expect(
      badRequestMessage(() => checkBenchPick([11, 12, 13], CANDIDATES, 2)),
    ).toBe(
      'The votes changed while you were choosing. Pick exactly 2 for the bench.',
    );
  });

  it('refuses any pick once nobody overflows', () => {
    expect(badRequestMessage(() => checkBenchPick([11], CANDIDATES, 0))).toBe(
      'Nobody needs to go to the bench any more.',
    );
  });
});

describe('benchPickCountMessage (ROK-2025)', () => {
  it('names the overflow as a digit', () => {
    expect(benchPickCountMessage(3)).toBe(
      'The votes changed while you were choosing. Pick exactly 3 for the bench.',
    );
  });
});
