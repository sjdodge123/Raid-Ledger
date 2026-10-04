/**
 * Unit tests for quorum predicates (ROK-1118).
 *
 *   - building → voting: ready only when the ROK-1444 nomination count
 *     target fires (TDB:449 retired the submission branch).
 *   - voting → decided: every expected voter has stamped `votes_submitted_at`.
 */
import { createDrizzleMock } from '../../common/testing/drizzle-mock';

jest.mock('./quorum-voters.helpers', () => ({
  loadQuorumGatingVoters: jest.fn(),
}));

// ROK-1474 (D7): `checkVotingQuorum` now asks the star resolver whether a
// tie can be broken. That resolver is its own unit
// (`tiebreaker-star.helpers.spec.ts`); here it must neither consume the
// mocked query queue nor change the outcome, so it always reports an
// unbreakable tie and every ROK-1374 assertion below keeps its meaning.
jest.mock('../tiebreaker/tiebreaker-star.helpers', () => ({
  ...jest.requireActual('../tiebreaker/tiebreaker-star.helpers'),
  resolveApprovalTieByStars: jest.fn().mockResolvedValue({
    kind: 'unresolved',
    starCounts: {},
    reason: 'no-stars',
  }),
}));

// TDB:449: the building predicate's only ready path is the ROK-1444 count
// target. Its evaluation is its own unit (`nomination-target.helpers.spec.ts`).
jest.mock('./nomination-target.helpers', () => ({
  evaluateNominationTarget: jest.fn(),
}));

import { loadQuorumGatingVoters } from './quorum-voters.helpers';
import { evaluateNominationTarget } from './nomination-target.helpers';
import { resolveApprovalTieByStars } from '../tiebreaker/tiebreaker-star.helpers';
import { checkBuildingQuorum, checkVotingQuorum } from './quorum-check.helpers';
import { SETTING_KEYS } from '../../drizzle/schema/app-settings';
import type * as schema from '../../drizzle/schema';

type LineupRow = typeof schema.communityLineups.$inferSelect;

const baseLineup: LineupRow = {
  id: 42,
  title: 'Test',
  description: null,
  status: 'building',
  visibility: 'public',
  targetDate: null,
  decidedGameId: null,
  linkedEventId: null,
  createdBy: 1,
  votingDeadline: null,
  phaseDeadline: null,
  phaseDurationOverride: null,
  matchThreshold: 35,
  maxVotesPerPlayer: 3,
  defaultTiebreakerMode: null,
  activeTiebreakerId: null,
  discordCreatedChannelId: null,
  discordCreatedMessageId: null,
  channelOverrideId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
} as unknown as LineupRow;

function setExpectedVoters(ids: number[]): void {
  (loadQuorumGatingVoters as jest.Mock).mockResolvedValue(ids);
}

function totalRow(count: number) {
  return [{ total: count }];
}

/**
 * ROK-1374 (D1): `checkVotingQuorum` issues a SECOND `groupBy` — the
 * unconditional `detectTies` probe. The flat drizzle mock serves queued
 * values in call order, so every voting fixture queues a per-game vote-count
 * row set behind its submitter row set. `[]` = no votes recorded = no tie.
 */
function queueTieProbe(
  db: ReturnType<typeof createDrizzleMock>,
  rows: Array<{ gameId: number; voteCount: number }> = [],
): void {
  db.groupBy.mockResolvedValueOnce(rows);
}

interface QuorumTestSettings {
  get: jest.Mock;
}

/**
 * Settings mock that returns different values per key. Building reads only
 * LINEUP_AUTO_ADVANCE_MIN_NOMINATIONS (the floor fed to the count target).
 */
function makeSettings(
  overrides: Record<string, string> = {},
): QuorumTestSettings {
  return {
    get: jest
      .fn()
      .mockImplementation((key: string) =>
        Promise.resolve(overrides[key] ?? null),
      ),
  };
}

describe('checkBuildingQuorum', () => {
  beforeEach(() => jest.clearAllMocks());

  // Every fixture below also queues the inputs the retired ROK-1296 branch
  // read (two expected voters, both submitted, floor met). The old predicate
  // returned ready on them; the count target is now the only ready path.
  function queueRetiredSubmissionBranch(
    db: ReturnType<typeof createDrizzleMock>,
  ): void {
    setExpectedVoters([1, 2]);
    db.execute.mockResolvedValueOnce(totalRow(99));
    db.groupBy.mockResolvedValueOnce(submissionsForVoters([1, 2]));
  }

  it('is not ready with no target, after reading only the total and floor (TDB:449)', async () => {
    const db = createDrizzleMock();
    queueRetiredSubmissionBranch(db);
    const settings = makeSettings();

    const result = await checkBuildingQuorum(
      db as never,
      settings as never,
      baseLineup,
    );

    expect(result).toEqual({
      ready: false,
      reason: 'no nomination target; deadline or manual advance required',
    });
    // countNominations + the floor read are the only inputs left.
    expect(db.execute).toHaveBeenCalledTimes(1);
    expect(settings.get).toHaveBeenCalledTimes(1);
    expect(settings.get).toHaveBeenCalledWith(
      SETTING_KEYS.LINEUP_AUTO_ADVANCE_MIN_NOMINATIONS,
    );
    expect(db.groupBy).not.toHaveBeenCalled();
    expect(loadQuorumGatingVoters).not.toHaveBeenCalled();
    expect(evaluateNominationTarget).not.toHaveBeenCalled();
  });

  it('is not ready when the target is armed but not met, whoever submitted', async () => {
    const db = createDrizzleMock();
    queueRetiredSubmissionBranch(db);
    const lineup = { ...baseLineup, nominationTargetPct: 50 } as LineupRow;
    (evaluateNominationTarget as jest.Mock).mockResolvedValue({
      ready: false,
    });

    const result = await checkBuildingQuorum(
      db as never,
      makeSettings() as never,
      lineup,
    );

    expect(result).toEqual({
      ready: false,
      reason: 'nomination target not met; deadline or manual advance required',
    });
    expect(evaluateNominationTarget).toHaveBeenCalledWith(db, lineup, 99, 4);
    expect(db.groupBy).not.toHaveBeenCalled();
    expect(loadQuorumGatingVoters).not.toHaveBeenCalled();
  });

  it('is ready when the count target fires', async () => {
    const db = createDrizzleMock();
    db.execute.mockResolvedValueOnce(totalRow(12));
    const lineup = { ...baseLineup, nominationTargetPct: 50 } as LineupRow;
    (evaluateNominationTarget as jest.Mock).mockResolvedValue({ ready: true });

    const result = await checkBuildingQuorum(
      db as never,
      makeSettings({
        [SETTING_KEYS.LINEUP_AUTO_ADVANCE_MIN_NOMINATIONS]: '6',
      }) as never,
      lineup,
    );

    expect(result).toEqual({ ready: true });
    expect(evaluateNominationTarget).toHaveBeenCalledWith(db, lineup, 12, 6);
  });
});

describe('checkVotingQuorum', () => {
  beforeEach(() => jest.clearAllMocks());

  it('reports not ready when no expected voters', async () => {
    const db = createDrizzleMock();
    setExpectedVoters([]);
    db.groupBy.mockResolvedValueOnce([]);
    queueTieProbe(db);

    const result = await checkVotingQuorum(db as never, {
      ...baseLineup,
      status: 'voting',
    });

    expect(result.ready).toBe(false);
    expect(result.reason).toContain('solo lineup');
  });

  it('reports not ready for a solo lineup (1 expected voter)', async () => {
    const db = createDrizzleMock();
    setExpectedVoters([1]);
    db.groupBy.mockResolvedValueOnce([{ userId: 1, count: 3 }]);
    queueTieProbe(db);

    const result = await checkVotingQuorum(db as never, {
      ...baseLineup,
      status: 'voting',
    });

    expect(result.ready).toBe(false);
    expect(result.reason).toContain('solo lineup');
  });

  it('reports not ready when zero voters have submitted (ROK-1296 — was: 1 of 3 votes each)', async () => {
    const db = createDrizzleMock();
    setExpectedVoters([1, 2, 3]);
    // Pre-1296: this row set encoded "all 3 voters cast 1 of 3 votes" and
    // the per-voter required = 3 → short. Post-1296 the per-voter gate is
    // submission presence; same input would now mean "all 3 voters DID
    // submit" → ready. Update the input to express the new intent (nobody
    // submitted yet) so the predicate's short-circuit is still validated.
    db.groupBy.mockResolvedValueOnce([]);
    queueTieProbe(db);

    const result = await checkVotingQuorum(db as never, {
      ...baseLineup,
      status: 'voting',
    });

    expect(result.ready).toBe(false);
    expect(result.reason).toMatch(/have not submitted/);
  });

  it('reports not ready when one voter has not submitted (ROK-1296 — was: one vote short)', async () => {
    const db = createDrizzleMock();
    setExpectedVoters([1, 2, 3]);
    // Voters 1 + 2 submitted; voter 3 missing.
    db.groupBy.mockResolvedValueOnce([
      { userId: 1, count: 3 },
      { userId: 2, count: 3 },
    ]);
    queueTieProbe(db);

    const result = await checkVotingQuorum(db as never, {
      ...baseLineup,
      status: 'voting',
    });

    expect(result.ready).toBe(false);
    expect(result.reason).toMatch(/have not submitted/);
  });

  it('reports ready when every voter has used their full allotment', async () => {
    const db = createDrizzleMock();
    setExpectedVoters([1, 2, 3]);
    db.groupBy.mockResolvedValueOnce([
      { userId: 1, count: 3 },
      { userId: 2, count: 3 },
      { userId: 3, count: 3 },
    ]);
    queueTieProbe(db);

    const result = await checkVotingQuorum(db as never, {
      ...baseLineup,
      status: 'voting',
      visibility: 'private',
    });

    expect(result.ready).toBe(true);
  });

  it('private lineup ignores extra public voters when quorum already met', async () => {
    const db = createDrizzleMock();
    setExpectedVoters([1, 2]);
    db.groupBy.mockResolvedValueOnce([
      { userId: 1, count: 3 },
      { userId: 2, count: 3 },
      { userId: 99, count: 1 },
    ]);
    queueTieProbe(db);

    const result = await checkVotingQuorum(db as never, {
      ...baseLineup,
      status: 'voting',
      visibility: 'private',
    });

    expect(result.ready).toBe(true);
  });

  it('honors a custom maxVotesPerPlayer on the lineup', async () => {
    const db = createDrizzleMock();
    setExpectedVoters([1, 2]);
    db.groupBy.mockResolvedValueOnce([
      { userId: 1, count: 5 },
      { userId: 2, count: 5 },
    ]);
    queueTieProbe(db);

    const result = await checkVotingQuorum(db as never, {
      ...baseLineup,
      status: 'voting',
      maxVotesPerPlayer: 5,
    });

    expect(result.ready).toBe(true);
  });

  // ROK-1258 hybrid policy: checkVotingQuorum consumes whatever
  // loadQuorumGatingVoters returns. These tests pin the contract by
  // simulating the pre-/post-drop gating set the new helper produces.
  it('advances once post-deadline drop narrows the gating set to actual voters', async () => {
    const db = createDrizzleMock();
    // 5-invitee private; after deadline drops 2 non-voters, gating set =
    // creator + 2 voters who already cast 3.
    setExpectedVoters([1, 2, 3]);
    db.groupBy.mockResolvedValueOnce([
      { userId: 1, count: 3 },
      { userId: 2, count: 3 },
      { userId: 3, count: 3 },
    ]);
    queueTieProbe(db);

    const result = await checkVotingQuorum(db as never, {
      ...baseLineup,
      status: 'voting',
      visibility: 'private',
    });

    expect(result.ready).toBe(true);
  });

  it('still blocks when the only voter is the creator (creator never dropped)', async () => {
    const db = createDrizzleMock();
    // Solo-creator gating set after every non-voter dropped post-deadline.
    setExpectedVoters([1]);
    db.groupBy.mockResolvedValueOnce([]);
    queueTieProbe(db);

    const result = await checkVotingQuorum(db as never, {
      ...baseLineup,
      status: 'voting',
      visibility: 'private',
    });

    expect(result.ready).toBe(false);
    expect(result.reason).toContain('solo lineup');
  });
});

// ROK-1258: dedicated coverage for the hybrid voter-participation policy.
// quorum-check is mocked above, so here we exercise the real helper against
// a small handwritten drizzle stub keyed on the (in order) queries it makes:
//   1. invitees lookup
//   2. participants lookup (votes during voting, entries during building)
describe('loadQuorumGatingVoters (ROK-1258 hybrid policy)', () => {
  // Resolve dynamically so the jest.mock above (used by the
  // quorum-check tests) doesn't suppress the real helper here.

  const actual = jest.requireActual<{
    loadQuorumGatingVoters: (db: unknown, lineup: unknown) => Promise<number[]>;
  }>('./quorum-voters.helpers');

  /**
   * Minimal stub: each `.where(...)` resolves to the next queued row set,
   * matching the order helpers run their queries. The helper's
   * loadPrivateExpectedVoters runs the invitee query first; then if the
   * post-deadline branch hits, findDistinctVoters / findDistinctNominators
   * runs the participants query.
   */
  function makeDb(invitees: number[], participants: number[]) {
    const queue: Array<Array<{ userId: number }>> = [
      invitees.map((userId) => ({ userId })),
      participants.map((userId) => ({ userId })),
    ];
    const stub = {
      select: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      where: jest
        .fn()
        .mockImplementation(() => Promise.resolve(queue.shift() ?? [])),
    };
    return stub;
  }

  const privateBase = {
    ...baseLineup,
    visibility: 'private' as const,
    status: 'voting' as const,
  };

  it('returns the full roster when the phase deadline is still future', async () => {
    const future = new Date(Date.now() + 60_000);
    const db = makeDb([2, 3, 4], []);

    const result = await actual.loadQuorumGatingVoters(db, {
      ...privateBase,
      createdBy: 1,
      phaseDeadline: future,
    });

    expect(result.sort()).toEqual([1, 2, 3, 4]);
  });

  it('drops non-voting invitees once the phase deadline has passed', async () => {
    const past = new Date(Date.now() - 60_000);
    // Invited: 2,3,4,5. Only 2 and 3 voted. Creator=1 never dropped.
    const db = makeDb([2, 3, 4, 5], [2, 3]);

    const result = await actual.loadQuorumGatingVoters(db, {
      ...privateBase,
      createdBy: 1,
      phaseDeadline: past,
    });

    expect(result.sort()).toEqual([1, 2, 3]);
  });

  it('returns the full roster when the deadline is null (no grace path)', async () => {
    const db = makeDb([2, 3, 4], []);

    const result = await actual.loadQuorumGatingVoters(db, {
      ...privateBase,
      createdBy: 1,
      phaseDeadline: null,
      votingDeadline: null,
    });

    expect(result.sort()).toEqual([1, 2, 3, 4]);
  });

  it('keeps the creator after deadline even when they have not voted', async () => {
    const past = new Date(Date.now() - 60_000);
    // Creator=1 has not voted; only invitee 2 voted. 1 still gates.
    const db = makeDb([2, 3], [2]);

    const result = await actual.loadQuorumGatingVoters(db, {
      ...privateBase,
      createdBy: 1,
      phaseDeadline: past,
    });

    expect(result.sort()).toEqual([1, 2]);
  });

  it('falls back to votingDeadline when phaseDeadline is null but votingDeadline is set', async () => {
    const past = new Date(Date.now() - 60_000);
    // Pre-fix legacy path: operator set an explicit votingDeadline only.
    const db = makeDb([2, 3, 4], [2]);

    const result = await actual.loadQuorumGatingVoters(db, {
      ...privateBase,
      createdBy: 1,
      phaseDeadline: null,
      votingDeadline: past,
    });

    expect(result.sort()).toEqual([1, 2]);
  });

  it('uses phaseDeadline for the building phase grace window', async () => {
    const past = new Date(Date.now() - 60_000);
    // Building phase: dropped invitees = those without nominations.
    // Invited: 2,3. Only 2 nominated.
    const db = makeDb([2, 3], [2]);

    const result = await actual.loadQuorumGatingVoters(db, {
      ...privateBase,
      status: 'building',
      createdBy: 1,
      phaseDeadline: past,
      votingDeadline: null,
    });

    expect(result.sort()).toEqual([1, 2]);
  });
});

// ============================================================================
// ROK-1296 (U4 SubmitBar) — submission-presence quorum semantics.
//
// Voting quorum no longer counts vote totals per voter. It checks whether
// every expected voter has stamped `votes_submitted_at` in
// `community_lineup_user_submissions`. (The building half of this pivot was
// retired by TDB:449 — see the `checkBuildingQuorum` block above.)
//
// The ≥2-voter guard stays intact. These tests pin the per-voter predicate.
// ============================================================================

/**
 * Submission row shape used by the new per-voter query path.
 *
 * Includes `count: 0` so the SAME mock value can be served to the old code
 * path (which reads `.count`): the old code computes `(0 ?? 0) < 3` → true,
 * flags all returned voters as short, returns NOT ready. The NEW code path
 * reads only `.userId` from this row set — same input, opposite verdict.
 * This is the deliberate behavioural pivot the dev's predicate rewrite must
 * cross to make these tests green.
 */
function submissionsForVoters(voterIds: number[]) {
  return voterIds.map((userId) => ({ userId, count: 0 }));
}

describe('checkVotingQuorum — ROK-1296 submission-presence semantics', () => {
  beforeEach(() => jest.clearAllMocks());

  it('NOT ready when votes-per-voter passes but NO submission rows exist (reason mentions submission)', async () => {
    const db = createDrizzleMock();
    setExpectedVoters([1, 2]);
    // NEW gate reads submission rows — none exist.
    db.groupBy.mockResolvedValueOnce(submissionsForVoters([]));
    queueTieProbe(db);

    const result = await checkVotingQuorum(db as never, {
      ...baseLineup,
      status: 'voting',
      visibility: 'private',
    });

    expect(result.ready).toBe(false);
    expect(result.reason).toMatch(/submit|submission/i);
  });

  it('READY when every voter has a submission row, even with ZERO raw votes (new ignores vote count)', async () => {
    const db = createDrizzleMock();
    setExpectedVoters([1, 2]);
    // NEW: both submitted.
    db.groupBy.mockResolvedValueOnce(submissionsForVoters([1, 2]));
    queueTieProbe(db);
    // OLD code would query votes-per-voter and see [], flag both as 0 < 3
    // and return NOT ready. Only the new semantic produces ready === true.
    const result = await checkVotingQuorum(db as never, {
      ...baseLineup,
      status: 'voting',
      visibility: 'private',
      maxVotesPerPlayer: 99,
    });

    expect(result.ready).toBe(true);
  });

  it('ignores maxVotesPerPlayer for the per-voter check (submission supersedes vote-count)', async () => {
    const db = createDrizzleMock();
    setExpectedVoters([1, 2]);
    db.groupBy.mockResolvedValueOnce(submissionsForVoters([1, 2]));
    queueTieProbe(db);

    // A lineup with a 10-vote cap: the OLD code would require 10 votes per
    // voter. The NEW predicate ignores the cap entirely.
    const result = await checkVotingQuorum(db as never, {
      ...baseLineup,
      status: 'voting',
      visibility: 'private',
      maxVotesPerPlayer: 10,
    });

    expect(result.ready).toBe(true);
  });

  it('still blocks the solo-creator lineup even when they submitted (≥2 voters guard stays)', async () => {
    const db = createDrizzleMock();
    setExpectedVoters([1]);
    db.groupBy.mockResolvedValueOnce(submissionsForVoters([1]));
    queueTieProbe(db);

    const result = await checkVotingQuorum(db as never, {
      ...baseLineup,
      status: 'voting',
      visibility: 'private',
    });

    expect(result.ready).toBe(false);
    expect(result.reason).toContain('solo lineup');
  });
});

// ============================================================================
// ROK-1374 (D1) — tie awareness.
//
// A completed vote that produced two joint-top games is NOT a decidable
// result, so quorum must report `ready: false` and hand the tie payload back
// instead of letting a doomed `voting → decided` transition through for the
// grace job to blow up on. The probe is issued UNCONDITIONALLY (before the
// solo guard) because the flat drizzle mock counts calls — a conditional
// query would desynchronise every fixture above.
// ============================================================================
describe('checkVotingQuorum — ROK-1374 tie awareness', () => {
  beforeEach(() => jest.clearAllMocks());

  const votingLineup = { ...baseLineup, status: 'voting' as const };

  it('reports NOT ready and returns the tie payload when the completed vote is tied', async () => {
    const db = createDrizzleMock();
    setExpectedVoters([1, 2, 3]);
    db.groupBy.mockResolvedValueOnce(submissionsForVoters([1, 2, 3]));
    queueTieProbe(db, [
      { gameId: 7, voteCount: 3 },
      { gameId: 9, voteCount: 3 },
    ]);

    const result = await checkVotingQuorum(db as never, votingLineup);

    expect(result.ready).toBe(false);
    expect(result.tie?.tiedGameIds).toEqual([7, 9]);
    expect(result.tie?.voteCount).toBe(3);
    expect(result.reason).toMatch(/tie/i);
  });

  it('still reports ready when the completed vote has a clear winner', async () => {
    const db = createDrizzleMock();
    setExpectedVoters([1, 2, 3]);
    db.groupBy.mockResolvedValueOnce(submissionsForVoters([1, 2, 3]));
    queueTieProbe(db, [
      { gameId: 7, voteCount: 3 },
      { gameId: 9, voteCount: 1 },
    ]);

    const result = await checkVotingQuorum(db as never, votingLineup);

    expect(result.ready).toBe(true);
    expect(result.tie).toBeUndefined();
  });

  it('issues the tie probe unconditionally — a solo lineup makes the same query count', async () => {
    const tieFree = createDrizzleMock();
    setExpectedVoters([1]);
    tieFree.groupBy.mockResolvedValueOnce(submissionsForVoters([1]));
    queueTieProbe(tieFree);
    const control = await checkVotingQuorum(tieFree as never, votingLineup);

    const tied = createDrizzleMock();
    tied.groupBy.mockResolvedValueOnce(submissionsForVoters([1]));
    queueTieProbe(tied, [
      { gameId: 7, voteCount: 2 },
      { gameId: 9, voteCount: 2 },
    ]);
    const result = await checkVotingQuorum(tied as never, votingLineup);

    expect(tied.groupBy).toHaveBeenCalledTimes(2);
    expect(tied.groupBy.mock.calls.length).toBe(
      tieFree.groupBy.mock.calls.length,
    );
    // The solo guard still wins: a solo lineup never auto-advances, tie or not.
    expect(control.reason).toContain('solo lineup');
    expect(result.reason).toContain('solo lineup');
    expect(result.tie).toBeUndefined();
  });

  // ROK-1474 (D7): the OTHER half of the branch above. Every case in this file
  // runs against the module mock's default `unresolved`, so the path where the
  // top picks BREAK the tie — the half that can newly say `ready: true` — had
  // no test at this tier at all. D4's whole point is that the quorum check and
  // the transition guard never disagree, so the half that says "go" is exactly
  // the half a regression would deadlock on.
  it('reports READY on a tie the top picks break, and hands back no tie', async () => {
    const db = createDrizzleMock();
    setExpectedVoters([1, 2, 3]);
    db.groupBy.mockResolvedValueOnce(submissionsForVoters([1, 2, 3]));
    queueTieProbe(db, [
      { gameId: 7, voteCount: 3 },
      { gameId: 9, voteCount: 3 },
    ]);
    (resolveApprovalTieByStars as jest.Mock).mockResolvedValueOnce({
      kind: 'winner',
      gameId: 7,
      starCounts: { 7: 2, 9: 0 },
      reasoning: 'tied on votes 3–3, won on top picks 2–0',
    });

    const result = await checkVotingQuorum(db as never, votingLineup);

    expect(result.ready).toBe(true);
    expect(result.tie).toBeUndefined();
    expect(result.reason).toBeUndefined();
  });
});
