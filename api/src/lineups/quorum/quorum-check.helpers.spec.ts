/**
 * Unit tests for quorum predicates (ROK-1118).
 *
 * Both predicates require participants to use their full allotment:
 *   - building → voting: each voter has nominated ≥ minPerVoter games AND
 *     total distinct nominations ≥ floor.
 *   - voting → decided: each voter has cast `lineup.maxVotesPerPlayer` votes.
 */
import { createDrizzleMock } from '../../common/testing/drizzle-mock';

jest.mock('./quorum-voters.helpers', () => ({
  loadQuorumGatingVoters: jest.fn(),
}));

import { loadQuorumGatingVoters } from './quorum-voters.helpers';
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

function nominationsPerVoter(rows: Array<{ userId: number; count: number }>) {
  return rows;
}

function totalRow(count: number) {
  return [{ total: count }];
}

interface QuorumTestSettings {
  get: jest.Mock;
}

/**
 * Settings mock that returns different values per key. Building reads:
 *   1. LINEUP_AUTO_ADVANCE_MIN_NOMINATIONS (floor)
 *   2. LINEUP_AUTO_ADVANCE_MIN_NOMINATIONS_PER_VOTER (per-voter min)
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

  it('reports not ready when there are no expected voters', async () => {
    const db = createDrizzleMock();
    setExpectedVoters([]);

    const result = await checkBuildingQuorum(
      db as never,
      makeSettings() as never,
      baseLineup,
    );

    expect(result.ready).toBe(false);
    expect(result.reason).toContain('solo lineup');
  });

  it('reports not ready for a solo lineup (1 expected voter)', async () => {
    const db = createDrizzleMock();
    setExpectedVoters([1]);

    const result = await checkBuildingQuorum(
      db as never,
      makeSettings() as never,
      baseLineup,
    );

    expect(result.ready).toBe(false);
    expect(result.reason).toContain('solo lineup');
  });

  it('reports not ready when an expected nominator has not submitted (ROK-1296)', async () => {
    const db = createDrizzleMock();
    setExpectedVoters([1, 2, 3, 4]);
    // Only voters 1-3 stamped `nominations_submitted_at`; voter 4 missing.
    db.groupBy.mockResolvedValueOnce(
      nominationsPerVoter([
        { userId: 1, count: 3 },
        { userId: 2, count: 3 },
        { userId: 3, count: 3 },
      ]),
    );
    db.execute.mockResolvedValueOnce(totalRow(9));

    const result = await checkBuildingQuorum(
      db as never,
      makeSettings() as never,
      baseLineup,
    );

    expect(result.ready).toBe(false);
    expect(result.reason).toMatch(/have not submitted/);
  });

  it('reports not ready when zero nominators have submitted (ROK-1296 — was: 1 of 3 nominations each)', async () => {
    const db = createDrizzleMock();
    setExpectedVoters([1, 2, 3, 4]);
    // Pre-1296 this row set encoded "all 4 voters at 1/3 entries" and the
    // per-voter min was 3 → short. Post-1296 the per-voter gate is
    // submission presence — the same input now means "all 4 voters DID
    // submit" → ready. Update the input to express the new intent (nobody
    // submitted) so the test still validates the predicate's short-circuit.
    db.groupBy.mockResolvedValueOnce(nominationsPerVoter([]));
    db.execute.mockResolvedValueOnce(totalRow(4));

    const result = await checkBuildingQuorum(
      db as never,
      makeSettings() as never,
      baseLineup,
    );

    expect(result.ready).toBe(false);
    expect(result.reason).toMatch(/have not submitted/);
  });

  it('reports not ready when per-voter is met but total floor not met', async () => {
    const db = createDrizzleMock();
    // Two voters × 1 nomination each = 2 (below default floor of 4) but each
    // hits a custom per-voter min of 1.
    setExpectedVoters([1, 2]);
    db.groupBy.mockResolvedValueOnce(
      nominationsPerVoter([
        { userId: 1, count: 1 },
        { userId: 2, count: 1 },
      ]),
    );
    db.execute.mockResolvedValueOnce(totalRow(2));

    const result = await checkBuildingQuorum(
      db as never,
      makeSettings({
        [SETTING_KEYS.LINEUP_AUTO_ADVANCE_MIN_NOMINATIONS_PER_VOTER]: '1',
      }) as never,
      baseLineup,
    );

    expect(result.ready).toBe(false);
    expect(result.reason).toContain('floor');
  });

  it('reports ready when each voter hits the per-voter min and the floor is met', async () => {
    const db = createDrizzleMock();
    setExpectedVoters([1, 2]);
    db.groupBy.mockResolvedValueOnce(
      nominationsPerVoter([
        { userId: 1, count: 3 },
        { userId: 2, count: 3 },
      ]),
    );
    db.execute.mockResolvedValueOnce(totalRow(6));

    const result = await checkBuildingQuorum(
      db as never,
      makeSettings() as never,
      baseLineup,
    );

    expect(result.ready).toBe(true);
  });

  it('honors a custom floor from settings', async () => {
    const db = createDrizzleMock();
    setExpectedVoters([1, 2]);
    db.groupBy.mockResolvedValueOnce(
      nominationsPerVoter([
        { userId: 1, count: 3 },
        { userId: 2, count: 3 },
      ]),
    );
    db.execute.mockResolvedValueOnce(totalRow(6));

    const result = await checkBuildingQuorum(
      db as never,
      makeSettings({
        [SETTING_KEYS.LINEUP_AUTO_ADVANCE_MIN_NOMINATIONS]: '2',
      }) as never,
      baseLineup,
    );

    expect(result.ready).toBe(true);
  });

  it('honors a custom per-voter min from settings', async () => {
    const db = createDrizzleMock();
    setExpectedVoters([1, 2]);
    db.groupBy.mockResolvedValueOnce(
      nominationsPerVoter([
        { userId: 1, count: 1 },
        { userId: 2, count: 1 },
      ]),
    );
    db.execute.mockResolvedValueOnce(totalRow(2));

    const result = await checkBuildingQuorum(
      db as never,
      makeSettings({
        [SETTING_KEYS.LINEUP_AUTO_ADVANCE_MIN_NOMINATIONS]: '2',
        [SETTING_KEYS.LINEUP_AUTO_ADVANCE_MIN_NOMINATIONS_PER_VOTER]: '1',
      }) as never,
      baseLineup,
    );

    expect(result.ready).toBe(true);
  });
});

describe('checkVotingQuorum', () => {
  beforeEach(() => jest.clearAllMocks());

  it('reports not ready when no expected voters', async () => {
    const db = createDrizzleMock();
    setExpectedVoters([]);
    db.groupBy.mockResolvedValueOnce([]);

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
// New contract: quorum no longer counts nominations or vote totals per voter.
// It checks whether every expected voter has stamped a row in
// `community_lineup_user_submissions`:
//   - building → voting: `nominations_submitted_at IS NOT NULL` for all.
//   - voting   → decided: `votes_submitted_at IS NOT NULL` for all.
//
// The nomination FLOOR + ≥2-voter guards stay intact — those tests already
// exist above and continue to pass. These tests pin the NEW per-voter
// predicate. They MUST fail at commit time because checkBuildingQuorum and
// checkVotingQuorum still read from community_lineup_entries /
// community_lineup_votes for the per-voter gate.
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

describe('checkBuildingQuorum — ROK-1296 submission-presence semantics', () => {
  beforeEach(() => jest.clearAllMocks());

  // CRITICAL DIFFERENCE FROM OLD SEMANTICS:
  // Old code counts entries-per-voter via communityLineupEntries.groupBy. New
  // code probes communityLineupUserSubmissions for nominations_submitted_at.
  // The deliberate split below would return DIFFERENT ready values under each
  // semantic, which is the only way to force the dev to actually rewrite the
  // predicate rather than tweak the existing one.

  it('NOT ready when entries-per-voter passes but NO submission rows exist (new behaviour diverges from old)', async () => {
    const db = createDrizzleMock();
    setExpectedVoters([1, 2]);
    // First .groupBy() call: NEW code reads submission rows — none exist.
    db.groupBy.mockResolvedValueOnce(submissionsForVoters([]));
    // Floor query: trivially satisfied.
    db.execute.mockResolvedValueOnce(totalRow(99));
    // OLD code would also read .groupBy() here (entries-per-voter, both at 5,
    // i.e. ≥ minPerVoter 3) and return ready: true. The drizzle-mock returns
    // empty on extra calls, so the OLD code path actually flags both voters
    // as short and returns ready: false — but for the WRONG reason. The
    // reason match below pins the new semantic.
    const result = await checkBuildingQuorum(
      db as never,
      makeSettings() as never,
      baseLineup,
    );

    expect(result.ready).toBe(false);
    // The new gate's reason mentions submissions, not "below N nominations".
    expect(result.reason).toMatch(/submit|submission/i);
  });

  it('READY when every voter has a submission row, even with ZERO entries (new ignores entry count)', async () => {
    const db = createDrizzleMock();
    setExpectedVoters([1, 2]);
    // NEW: both voters submitted.
    db.groupBy.mockResolvedValueOnce(submissionsForVoters([1, 2]));
    // Floor satisfied.
    db.execute.mockResolvedValueOnce(totalRow(99));
    // OLD code would query entries-per-voter on a SECOND groupBy and see []
    // (drizzle-mock default), flag both as 0 < 3, return NOT ready. NEW code
    // returns ready: true because the per-voter gate is just submission
    // presence. Only the new semantic produces ready === true here.
    const result = await checkBuildingQuorum(
      db as never,
      makeSettings() as never,
      baseLineup,
    );

    expect(result.ready).toBe(true);
  });

  it('still blocks on the nomination floor regardless of submissions', async () => {
    const db = createDrizzleMock();
    setExpectedVoters([1, 2]);
    // Both submitted — per-voter gate passes…
    db.groupBy.mockResolvedValueOnce(submissionsForVoters([1, 2]));
    // …but total nominations (3) fall below the default floor of 4.
    db.execute.mockResolvedValueOnce(totalRow(3));

    const result = await checkBuildingQuorum(
      db as never,
      makeSettings() as never,
      baseLineup,
    );

    expect(result.ready).toBe(false);
    expect(result.reason).toContain('floor');
  });

  it('still blocks for a solo lineup (creator alone) regardless of submission (≥2 voters guard stays)', async () => {
    const db = createDrizzleMock();
    setExpectedVoters([1]);
    db.groupBy.mockResolvedValueOnce(submissionsForVoters([1]));

    const result = await checkBuildingQuorum(
      db as never,
      makeSettings() as never,
      baseLineup,
    );

    expect(result.ready).toBe(false);
    expect(result.reason).toContain('solo lineup');
  });
});

describe('checkVotingQuorum — ROK-1296 submission-presence semantics', () => {
  beforeEach(() => jest.clearAllMocks());

  it('NOT ready when votes-per-voter passes but NO submission rows exist (reason mentions submission)', async () => {
    const db = createDrizzleMock();
    setExpectedVoters([1, 2]);
    // NEW gate reads submission rows — none exist.
    db.groupBy.mockResolvedValueOnce(submissionsForVoters([]));

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

    const result = await checkVotingQuorum(db as never, {
      ...baseLineup,
      status: 'voting',
      visibility: 'private',
    });

    expect(result.ready).toBe(false);
    expect(result.reason).toContain('solo lineup');
  });
});
