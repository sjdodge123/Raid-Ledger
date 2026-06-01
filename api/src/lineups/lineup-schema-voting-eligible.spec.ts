/**
 * API-side mirror of the contract spec for ROK-1298. Mirrors
 * `packages/contract/src/__tests__/lineup.schema.spec.ts` so the api
 * jest runner exercises the same assertions (the contract package has
 * no test runner of its own). Same pattern as ROK-1297's mirror.
 *
 * Validates the additive `votingEligibleCount` field on
 * `LineupDetailResponseSchema`. MUST fail until the dev ships the schema
 * extension.
 */
import { LineupDetailResponseSchema } from '@raid-ledger/contract';

function baseLineup(): Record<string, unknown> {
  return {
    id: 1,
    title: 'Test Lineup',
    description: null,
    status: 'voting',
    targetDate: null,
    decidedGameId: null,
    decidedGameName: null,
    linkedEventId: null,
    createdBy: { id: 1, displayName: 'Admin' },
    votingDeadline: null,
    phaseDeadline: null,
    pendingAdvanceAt: null,
    autoAdvancePausedAt: null,
    matchThreshold: 35,
    maxVotesPerPlayer: 3,
    defaultTiebreakerMode: null,
    entries: [],
    totalVoters: 0,
    totalMembers: 12,
    myVotes: [],
    unlinkedSteamCount: 0,
    unlinkedSteamMembers: [],
    createdAt: '2026-05-15T00:00:00.000Z',
    updatedAt: '2026-05-15T00:00:00.000Z',
    tiebreaker: null,
    channelOverrideId: null,
    channelOverrideName: null,
    visibility: 'public',
    invitees: [],
    stillWaitingOnVoters: [],
    publicShareEnabled: true,
    publicSlug: 'test-lineup',
    // ROK-1302: scheduling-phase flag (required on the response schema).
    includeSchedulingPhase: true,
    viewerSubmissions: {
      nominationsSubmittedAt: null,
      votesSubmittedAt: null,
    },
  };
}

describe('LineupDetailResponseSchema — votingEligibleCount (ROK-1298, api mirror)', () => {
  it('accepts a positive integer for votingEligibleCount', () => {
    const lineup = { ...baseLineup(), votingEligibleCount: 12 };
    const parsed = LineupDetailResponseSchema.parse(lineup);
    expect(parsed.votingEligibleCount).toBe(12);
  });

  it('accepts votingEligibleCount=1 (creator-only floor)', () => {
    const lineup = { ...baseLineup(), votingEligibleCount: 1 };
    const parsed = LineupDetailResponseSchema.parse(lineup);
    expect(parsed.votingEligibleCount).toBe(1);
  });

  it('rejects votingEligibleCount=0', () => {
    const lineup = { ...baseLineup(), votingEligibleCount: 0 };
    expect(() => LineupDetailResponseSchema.parse(lineup)).toThrow();
  });

  it('rejects a negative votingEligibleCount', () => {
    const lineup = { ...baseLineup(), votingEligibleCount: -3 };
    expect(() => LineupDetailResponseSchema.parse(lineup)).toThrow();
  });

  it('rejects a non-integer votingEligibleCount', () => {
    const lineup = { ...baseLineup(), votingEligibleCount: 4.2 };
    expect(() => LineupDetailResponseSchema.parse(lineup)).toThrow();
  });

  it('rejects a missing votingEligibleCount', () => {
    const lineup = baseLineup();
    expect(() => LineupDetailResponseSchema.parse(lineup)).toThrow();
  });

  it('rejects a string for votingEligibleCount', () => {
    const lineup = { ...baseLineup(), votingEligibleCount: '12' };
    expect(() => LineupDetailResponseSchema.parse(lineup)).toThrow();
  });
});
