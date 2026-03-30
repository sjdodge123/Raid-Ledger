/**
 * Unit tests for scheduling response helpers (ROK-965).
 */
import {
  buildPollResponse,
  buildMatchDetailDto,
} from './scheduling-response.helpers';

const baseMatch = {
  id: 10,
  lineupId: 1,
  gameId: 5,
  status: 'scheduling',
  thresholdMet: true,
  voteCount: 3,
  votePercentage: '75.00',
  fitType: 'normal',
  linkedEventId: null,
  createdAt: new Date('2026-03-01'),
  updatedAt: new Date('2026-03-01'),
  gameName: 'Elden Ring',
  gameCoverUrl: 'https://img.example.com/cover.jpg',
};

const baseMembers = [
  {
    id: 1,
    matchId: 10,
    userId: 100,
    source: 'voted',
    createdAt: new Date('2026-03-01'),
    displayName: 'Alice',
    avatar: null,
    discordId: null,
    customAvatarUrl: null,
  },
];

const baseSlots = [
  {
    id: 20,
    matchId: 10,
    proposedTime: new Date('2026-04-01T19:00:00Z'),
    overlapScore: '0.80',
    suggestedBy: 'user',
    createdAt: new Date('2026-03-28'),
  },
];

const baseVotes = [
  {
    id: 1,
    slotId: 20,
    userId: 100,
    displayName: 'Alice',
    createdAt: new Date('2026-03-29'),
  },
];

describe('buildPollResponse', () => {
  it('builds complete poll response with match, slots, and votes', () => {
    const result = buildPollResponse(
      baseMatch,
      baseMembers,
      baseSlots,
      baseVotes,
      100,
      'scheduling',
    );

    expect(result.match.gameName).toBe('Elden Ring');
    expect(result.match.members).toHaveLength(1);
    expect(result.slots).toHaveLength(1);
    expect(result.slots[0].votes).toHaveLength(1);
    expect(result.myVotedSlotIds).toEqual([20]);
    expect(result.lineupStatus).toBe('scheduling');
  });

  it('returns empty myVotedSlotIds for unauthenticated user', () => {
    const result = buildPollResponse(
      baseMatch,
      baseMembers,
      baseSlots,
      baseVotes,
      null,
      'scheduling',
    );

    expect(result.myVotedSlotIds).toEqual([]);
  });
});

describe('buildMatchDetailDto', () => {
  it('maps match row to DTO shape with ISO date strings', () => {
    const dto = buildMatchDetailDto(
      baseMatch,
      baseMembers,
      'Elden Ring',
      'https://img.example.com/cover.jpg',
    );

    expect(dto.id).toBe(10);
    expect(dto.gameName).toBe('Elden Ring');
    expect(dto.createdAt).toMatch(/^\d{4}-/);
    expect(dto.members[0].displayName).toBe('Alice');
  });
});
