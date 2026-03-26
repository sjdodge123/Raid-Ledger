/**
 * ROK-964: Failing TDD tests for lineup matches and scheduling schema.
 *
 * These tests define the contract for the new schema additions:
 * - 4 new Drizzle tables (matches, match_members, schedule_slots, schedule_votes)
 * - Updated LineupStatusSchema with 'scheduling'
 * - New contract Zod schemas and enums
 *
 * All tests MUST fail until the dev agent implements the schema changes.
 */
import { getTableColumns } from 'drizzle-orm';
import * as schema from '../schema';
import {
  LineupStatusSchema,
  // New enum schemas (ROK-964)
  MatchStatusSchema,
  FitTypeSchema,
  MemberSourceSchema,
  SlotSuggesterSchema,
  // New response schemas (ROK-964)
  LineupMatchSchema,
  LineupMatchMemberSchema,
  LineupScheduleSlotSchema,
  LineupScheduleVoteSchema,
  // Composite DTOs (ROK-964)
  MatchDetailResponseSchema,
  SchedulePollResponseSchema,
} from '@raid-ledger/contract';

// ---------------------------------------------------------------------------
// AC: LineupStatusSchema includes 'scheduling'
// ---------------------------------------------------------------------------
describe('LineupStatusSchema — scheduling status (ROK-964)', () => {
  it('accepts "scheduling" as a valid status', () => {
    const result = LineupStatusSchema.safeParse('scheduling');
    expect(result.success).toBe(true);
  });

  it('includes scheduling in the enum options', () => {
    const options = LineupStatusSchema.options;
    expect(options).toContain('scheduling');
  });

  it('Drizzle schema status enum includes scheduling', () => {
    const columns = getTableColumns(schema.communityLineups);
    const statusCol = columns.status;
    expect(statusCol).toBeDefined();
    // The enum array should include 'scheduling'
    expect((statusCol as { enumValues?: string[] }).enumValues).toContain(
      'scheduling',
    );
  });
});

// ---------------------------------------------------------------------------
// AC: Contract exports enums — MatchStatusSchema
// ---------------------------------------------------------------------------
describe('MatchStatusSchema (ROK-964)', () => {
  it('is defined and has the correct values', () => {
    expect(MatchStatusSchema).toBeDefined();
    expect(MatchStatusSchema.options).toEqual(
      expect.arrayContaining([
        'suggested',
        'scheduling',
        'scheduled',
        'archived',
      ]),
    );
  });

  it('accepts valid match statuses', () => {
    for (const val of ['suggested', 'scheduling', 'scheduled', 'archived']) {
      expect(MatchStatusSchema.safeParse(val).success).toBe(true);
    }
  });

  it('rejects invalid match status', () => {
    expect(MatchStatusSchema.safeParse('invalid').success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AC: Contract exports enums — FitTypeSchema
// ---------------------------------------------------------------------------
describe('FitTypeSchema (ROK-964)', () => {
  it('is defined and has the correct values', () => {
    expect(FitTypeSchema).toBeDefined();
    expect(FitTypeSchema.options).toEqual(
      expect.arrayContaining([
        'perfect',
        'normal',
        'oversubscribed',
        'undersubscribed',
      ]),
    );
  });

  it('rejects invalid fit type', () => {
    expect(FitTypeSchema.safeParse('loose').success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AC: Contract exports enums — MemberSourceSchema
// ---------------------------------------------------------------------------
describe('MemberSourceSchema (ROK-964)', () => {
  it('is defined and has the correct values', () => {
    expect(MemberSourceSchema).toBeDefined();
    expect(MemberSourceSchema.options).toEqual(
      expect.arrayContaining(['voted', 'bandwagon']),
    );
  });

  it('rejects invalid source', () => {
    expect(MemberSourceSchema.safeParse('manual').success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AC: Contract exports enums — SlotSuggesterSchema
// ---------------------------------------------------------------------------
describe('SlotSuggesterSchema (ROK-964)', () => {
  it('is defined and has the correct values', () => {
    expect(SlotSuggesterSchema).toBeDefined();
    expect(SlotSuggesterSchema.options).toEqual(
      expect.arrayContaining(['system', 'user']),
    );
  });

  it('rejects invalid suggester', () => {
    expect(SlotSuggesterSchema.safeParse('admin').success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AC: Contract exports — LineupMatchSchema
// ---------------------------------------------------------------------------
describe('LineupMatchSchema (ROK-964)', () => {
  const validMatch = {
    id: 1,
    lineupId: 10,
    gameId: 5,
    status: 'suggested',
    thresholdMet: false,
    voteCount: 3,
    votePercentage: null,
    fitType: null,
    linkedEventId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  it('parses a valid match object', () => {
    const result = LineupMatchSchema.safeParse(validMatch);
    expect(result.success).toBe(true);
  });

  it('accepts non-null votePercentage and fitType', () => {
    const result = LineupMatchSchema.safeParse({
      ...validMatch,
      votePercentage: 42.5,
      fitType: 'perfect',
      linkedEventId: 99,
    });
    expect(result.success).toBe(true);
  });

  it('rejects match with missing required fields', () => {
    const { id: _id, ...incomplete } = validMatch;
    const result = LineupMatchSchema.safeParse(incomplete);
    expect(result.success).toBe(false);
  });

  it('rejects match with invalid status', () => {
    const result = LineupMatchSchema.safeParse({
      ...validMatch,
      status: 'pending',
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AC: Contract exports — LineupMatchMemberSchema
// ---------------------------------------------------------------------------
describe('LineupMatchMemberSchema (ROK-964)', () => {
  const validMember = {
    id: 1,
    matchId: 10,
    userId: 5,
    source: 'voted',
    createdAt: '2026-01-01T00:00:00.000Z',
  };

  it('parses a valid member object', () => {
    const result = LineupMatchMemberSchema.safeParse(validMember);
    expect(result.success).toBe(true);
  });

  it('accepts bandwagon source', () => {
    const result = LineupMatchMemberSchema.safeParse({
      ...validMember,
      source: 'bandwagon',
    });
    expect(result.success).toBe(true);
  });

  it('rejects member with invalid source', () => {
    const result = LineupMatchMemberSchema.safeParse({
      ...validMember,
      source: 'manual',
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AC: Contract exports — LineupScheduleSlotSchema
// ---------------------------------------------------------------------------
describe('LineupScheduleSlotSchema (ROK-964)', () => {
  const validSlot = {
    id: 1,
    matchId: 10,
    proposedTime: '2026-03-01T19:00:00.000Z',
    overlapScore: null,
    suggestedBy: 'system',
    createdAt: '2026-01-01T00:00:00.000Z',
  };

  it('parses a valid schedule slot', () => {
    const result = LineupScheduleSlotSchema.safeParse(validSlot);
    expect(result.success).toBe(true);
  });

  it('accepts non-null overlapScore', () => {
    const result = LineupScheduleSlotSchema.safeParse({
      ...validSlot,
      overlapScore: 87.5,
      suggestedBy: 'user',
    });
    expect(result.success).toBe(true);
  });

  it('rejects slot with invalid suggestedBy', () => {
    const result = LineupScheduleSlotSchema.safeParse({
      ...validSlot,
      suggestedBy: 'bot',
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AC: Contract exports — LineupScheduleVoteSchema
// ---------------------------------------------------------------------------
describe('LineupScheduleVoteSchema (ROK-964)', () => {
  const validVote = {
    id: 1,
    slotId: 10,
    userId: 5,
    createdAt: '2026-01-01T00:00:00.000Z',
  };

  it('parses a valid schedule vote', () => {
    const result = LineupScheduleVoteSchema.safeParse(validVote);
    expect(result.success).toBe(true);
  });

  it('rejects vote with missing slotId', () => {
    const { slotId: _slotId, ...incomplete } = validVote;
    const result = LineupScheduleVoteSchema.safeParse(incomplete);
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AC: Contract exports — MatchDetailResponseSchema (composite)
// ---------------------------------------------------------------------------
describe('MatchDetailResponseSchema (ROK-964)', () => {
  const validDetail = {
    id: 1,
    lineupId: 10,
    gameId: 5,
    status: 'suggested',
    thresholdMet: false,
    voteCount: 3,
    votePercentage: 42.5,
    fitType: 'normal',
    linkedEventId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    gameName: 'Test Game',
    gameCoverUrl: null,
    members: [
      {
        id: 1,
        matchId: 1,
        userId: 5,
        source: 'voted',
        createdAt: '2026-01-01T00:00:00.000Z',
        displayName: 'Player1',
      },
    ],
  };

  it('parses a valid match detail response', () => {
    const result = MatchDetailResponseSchema.safeParse(validDetail);
    expect(result.success).toBe(true);
  });

  it('includes gameName and members fields', () => {
    const result = MatchDetailResponseSchema.safeParse(validDetail);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.gameName).toBe('Test Game');
      expect(result.data.members).toHaveLength(1);
      expect(result.data.members[0].displayName).toBe('Player1');
    }
  });
});

// ---------------------------------------------------------------------------
// AC: Contract exports — SchedulePollResponseSchema (composite)
// ---------------------------------------------------------------------------
describe('SchedulePollResponseSchema (ROK-964)', () => {
  const validPoll = {
    matchId: 1,
    slots: [
      {
        id: 1,
        matchId: 1,
        proposedTime: '2026-03-01T19:00:00.000Z',
        overlapScore: 75.0,
        suggestedBy: 'system',
        createdAt: '2026-01-01T00:00:00.000Z',
        votes: [
          { userId: 5, displayName: 'Player1' },
          { userId: 6, displayName: 'Player2' },
        ],
      },
    ],
  };

  it('parses a valid schedule poll response', () => {
    const result = SchedulePollResponseSchema.safeParse(validPoll);
    expect(result.success).toBe(true);
  });

  it('includes nested slot votes with displayName', () => {
    const result = SchedulePollResponseSchema.safeParse(validPoll);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.slots[0].votes).toHaveLength(2);
      expect(result.data.slots[0].votes[0].displayName).toBe('Player1');
    }
  });
});

// ---------------------------------------------------------------------------
// AC: Drizzle schema defines all 4 new tables
// ---------------------------------------------------------------------------
describe('Drizzle table exports (ROK-964)', () => {
  it('exports communityLineupMatches table', () => {
    expect(schema.communityLineupMatches).toBeDefined();
    const columns = getTableColumns(schema.communityLineupMatches);
    expect(columns.id).toBeDefined();
    expect(columns.lineupId).toBeDefined();
    expect(columns.gameId).toBeDefined();
    expect(columns.status).toBeDefined();
    expect(columns.thresholdMet).toBeDefined();
    expect(columns.voteCount).toBeDefined();
    expect(columns.votePercentage).toBeDefined();
    expect(columns.fitType).toBeDefined();
    expect(columns.linkedEventId).toBeDefined();
    expect(columns.createdAt).toBeDefined();
    expect(columns.updatedAt).toBeDefined();
  });

  it('exports communityLineupMatchMembers table', () => {
    expect(schema.communityLineupMatchMembers).toBeDefined();
    const columns = getTableColumns(schema.communityLineupMatchMembers);
    expect(columns.id).toBeDefined();
    expect(columns.matchId).toBeDefined();
    expect(columns.userId).toBeDefined();
    expect(columns.source).toBeDefined();
    expect(columns.createdAt).toBeDefined();
  });

  it('exports communityLineupScheduleSlots table', () => {
    expect(schema.communityLineupScheduleSlots).toBeDefined();
    const columns = getTableColumns(schema.communityLineupScheduleSlots);
    expect(columns.id).toBeDefined();
    expect(columns.matchId).toBeDefined();
    expect(columns.proposedTime).toBeDefined();
    expect(columns.overlapScore).toBeDefined();
    expect(columns.suggestedBy).toBeDefined();
    expect(columns.createdAt).toBeDefined();
  });

  it('exports communityLineupScheduleVotes table', () => {
    expect(schema.communityLineupScheduleVotes).toBeDefined();
    const columns = getTableColumns(schema.communityLineupScheduleVotes);
    expect(columns.id).toBeDefined();
    expect(columns.slotId).toBeDefined();
    expect(columns.userId).toBeDefined();
    expect(columns.createdAt).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// AC: Drizzle column types match the migration spec
// ---------------------------------------------------------------------------
describe('Drizzle column types (ROK-964)', () => {
  it('communityLineupMatches.status maps to "status" with correct enum', () => {
    const columns = getTableColumns(schema.communityLineupMatches);
    expect(columns.status.name).toBe('status');
    expect((columns.status as { enumValues?: string[] }).enumValues).toEqual(
      expect.arrayContaining([
        'suggested',
        'scheduling',
        'scheduled',
        'archived',
      ]),
    );
  });

  it('communityLineupMatches.votePercentage is nullable numeric(5,2)', () => {
    const columns = getTableColumns(schema.communityLineupMatches);
    expect(columns.votePercentage.name).toBe('vote_percentage');
    expect(columns.votePercentage.notNull).toBe(false);
  });

  it('communityLineupMatchMembers.source has voted/bandwagon enum', () => {
    const columns = getTableColumns(schema.communityLineupMatchMembers);
    expect(columns.source.name).toBe('source');
    expect((columns.source as { enumValues?: string[] }).enumValues).toEqual(
      expect.arrayContaining(['voted', 'bandwagon']),
    );
  });

  it('communityLineupScheduleSlots.suggestedBy has system/user enum', () => {
    const columns = getTableColumns(schema.communityLineupScheduleSlots);
    expect(columns.suggestedBy.name).toBe('suggested_by');
    expect(
      (columns.suggestedBy as { enumValues?: string[] }).enumValues,
    ).toEqual(expect.arrayContaining(['system', 'user']));
  });
});

// ---------------------------------------------------------------------------
// AC: match_threshold is NOT recreated (already exists from 0103)
// ---------------------------------------------------------------------------
describe('match_threshold backward compatibility (ROK-964)', () => {
  it('communityLineups still has matchThreshold column from 0103', () => {
    const columns = getTableColumns(schema.communityLineups);
    expect(columns.matchThreshold).toBeDefined();
    expect(columns.matchThreshold.name).toBe('match_threshold');
  });
});

// ---------------------------------------------------------------------------
// AC: Existing lineup CRUD still works (backwards compatible)
// ---------------------------------------------------------------------------
describe('existing lineup schema backward compatibility (ROK-964)', () => {
  it('communityLineups retains all original columns', () => {
    const columns = getTableColumns(schema.communityLineups);
    expect(columns.id).toBeDefined();
    expect(columns.status).toBeDefined();
    expect(columns.targetDate).toBeDefined();
    expect(columns.decidedGameId).toBeDefined();
    expect(columns.linkedEventId).toBeDefined();
    expect(columns.createdBy).toBeDefined();
    expect(columns.votingDeadline).toBeDefined();
    expect(columns.phaseDeadline).toBeDefined();
    expect(columns.phaseDurationOverride).toBeDefined();
    expect(columns.matchThreshold).toBeDefined();
    expect(columns.createdAt).toBeDefined();
    expect(columns.updatedAt).toBeDefined();
  });

  it('communityLineupEntries table is unchanged', () => {
    const columns = getTableColumns(schema.communityLineupEntries);
    expect(columns.id).toBeDefined();
    expect(columns.lineupId).toBeDefined();
    expect(columns.gameId).toBeDefined();
    expect(columns.nominatedBy).toBeDefined();
    expect(columns.note).toBeDefined();
    expect(columns.carriedOverFrom).toBeDefined();
    expect(columns.createdAt).toBeDefined();
  });

  it('communityLineupVotes table is unchanged', () => {
    const columns = getTableColumns(schema.communityLineupVotes);
    expect(columns.id).toBeDefined();
    expect(columns.lineupId).toBeDefined();
    expect(columns.userId).toBeDefined();
    expect(columns.gameId).toBeDefined();
    expect(columns.rank).toBeDefined();
    expect(columns.createdAt).toBeDefined();
  });

  it('LineupStatusSchema still accepts existing statuses', () => {
    for (const status of ['building', 'voting', 'decided', 'archived']) {
      expect(LineupStatusSchema.safeParse(status).success).toBe(true);
    }
  });
});
