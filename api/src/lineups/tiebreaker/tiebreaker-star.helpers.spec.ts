/**
 * ROK-1474 (A9) — the star tie resolver, table-tested without a database.
 *
 * `resolveTieFromStarCounts` is the pure core both `detectTies` consumers
 * call through (D4), so every branch that can decide — or refuse to decide —
 * a lineup is exercised here.
 */
import {
  describeStarOutcome,
  resolveTieFromStarCounts,
  type StarCounts,
} from './tiebreaker-star.helpers';
import type { TieResult } from './tiebreaker-detect.helpers';

const twoWayTie: TieResult = { tiedGameIds: [10, 20], voteCount: 5 };

describe('resolveTieFromStarCounts', () => {
  it('a clear star lead wins the tie and states its own reasoning', () => {
    const res = resolveTieFromStarCounts(twoWayTie, { 10: 4, 20: 1 });
    expect(res).toEqual({
      kind: 'winner',
      gameId: 10,
      starCounts: { 10: 4, 20: 1 },
      reasoning: 'tied on votes 5–5, won on top picks 4–1',
    });
  });

  it('reports the winner even when it is the second tied game', () => {
    const res = resolveTieFromStarCounts(twoWayTie, { 10: 1, 20: 3 });
    expect(res.kind).toBe('winner');
    expect(res.kind === 'winner' && res.gameId).toBe(20);
    expect(res.kind === 'winner' && res.reasoning).toBe(
      'tied on votes 5–5, won on top picks 3–1',
    );
  });

  it('an equal number of stars is unresolved as a star tie', () => {
    const res = resolveTieFromStarCounts(twoWayTie, { 10: 2, 20: 2 });
    expect(res).toEqual({
      kind: 'unresolved',
      starCounts: { 10: 2, 20: 2 },
      reason: 'star-tie',
    });
  });

  /**
   * AC6 / D8 — the legacy guard. Every ballot cast before this story shipped
   * has `rank IS NULL` on every row, so `countStarsPerGame` returns nothing
   * and the resolver must refuse to reinterpret it. Mutation proof: deleting
   * the all-zero early return makes this fail with
   * `Expected: "no-stars"  Received: "star-tie"`.
   */
  it('a ballot with no stars resolves as unresolved(no-stars)', () => {
    const res = resolveTieFromStarCounts(twoWayTie, {});
    expect(res.kind).toBe('unresolved');
    expect(res.kind === 'unresolved' && res.reason).toBe('no-stars');
  });

  it('treats an explicit zero the same as an absent count', () => {
    const res = resolveTieFromStarCounts(twoWayTie, { 10: 0, 20: 0 });
    expect(res.kind === 'unresolved' && res.reason).toBe('no-stars');
  });

  it('counts an unstarred tied game as zero against a starred one', () => {
    // AC7 mixed ballot: game 20 was approved by everyone but starred by
    // nobody, so it must not be treated as absent from the tie.
    const res = resolveTieFromStarCounts(twoWayTie, { 10: 1 });
    expect(res.kind === 'winner' && res.gameId).toBe(10);
    expect(res.kind === 'winner' && res.reasoning).toBe(
      'tied on votes 5–5, won on top picks 1–0',
    );
  });

  it('resolves a three-way approval tie with a unique star leader', () => {
    const threeWay: TieResult = { tiedGameIds: [10, 20, 30], voteCount: 5 };
    const counts: StarCounts = { 10: 1, 20: 3, 30: 1 };
    const res = resolveTieFromStarCounts(threeWay, counts);
    expect(res.kind === 'winner' && res.gameId).toBe(20);
    expect(res.kind === 'winner' && res.reasoning).toBe(
      'tied on votes 5–5–5, won on top picks 3–1–1',
    );
  });

  it('a three-way tie whose top two stars are level stays unresolved', () => {
    const threeWay: TieResult = { tiedGameIds: [10, 20, 30], voteCount: 4 };
    const res = resolveTieFromStarCounts(threeWay, { 10: 2, 20: 2, 30: 1 });
    expect(res.kind === 'unresolved' && res.reason).toBe('star-tie');
  });
});

describe('describeStarOutcome', () => {
  const winner = resolveTieFromStarCounts(twoWayTie, { 10: 4, 20: 1 });

  it('narrates a star victory the lineup actually recorded', () => {
    expect(describeStarOutcome(winner, 10)).toBe(
      'tied on votes 5–5, won on top picks 4–1',
    );
  });

  /**
   * D9 clause (b): an operator who hand-picks a winner skips tie detection
   * entirely. The string must never claim a star victory for a decision a
   * human made — that is the trust failure this story exists to fix.
   */
  it('says nothing when the decided game is not the star winner', () => {
    expect(describeStarOutcome(winner, 20)).toBeNull();
  });

  it('says nothing when the lineup has no decided game', () => {
    expect(describeStarOutcome(winner, null)).toBeNull();
  });

  it('says nothing for an unresolved star tie', () => {
    const tied = resolveTieFromStarCounts(twoWayTie, { 10: 2, 20: 2 });
    expect(describeStarOutcome(tied, 10)).toBeNull();
  });

  it('says nothing for a legacy ballot with no stars', () => {
    const legacy = resolveTieFromStarCounts(twoWayTie, {});
    expect(describeStarOutcome(legacy, 10)).toBeNull();
  });
});
