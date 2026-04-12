/**
 * TDD tests for event conflict enrichment helper (ROK-1031).
 * Tests enrichEventWithConflicts() which enriches an EventResponseDto
 * with myConflicts when an authenticated userId is provided.
 */
import { enrichEventWithConflicts } from './event-conflict-enrich.helpers';
import type { EventResponseDto } from '@raid-ledger/contract';

// ─── Shared test data ───────────────��──────────────────────────────────────

const BASE_EVENT: EventResponseDto = {
  id: 1,
  title: 'Test Event',
  description: null,
  startTime: '2026-05-01T18:00:00.000Z',
  endTime: '2026-05-01T20:00:00.000Z',
  creator: { id: 10, username: 'Admin', avatar: null, discordId: null },
  game: null,
  signupCount: 3,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function buildConflict(
  id: number,
  title: string,
): {
  id: number;
  title: string;
  duration: [Date, Date];
  cancelledAt: null;
} {
  return {
    id,
    title,
    duration: [
      new Date('2026-05-01T17:00:00Z'),
      new Date('2026-05-01T19:00:00Z'),
    ],
    cancelledAt: null,
  };
}

// ─── enrichEventWithConflicts ───────────────────���─────────────────────────

describe('enrichEventWithConflicts', () => {
  it('returns event unchanged when userId is null', async () => {
    const finder = jest.fn();
    const result = await enrichEventWithConflicts(BASE_EVENT, null, finder);

    expect(result).toEqual(BASE_EVENT);
    expect(result.myConflicts).toBeUndefined();
    expect(finder).not.toHaveBeenCalled();
  });

  it('returns event with empty myConflicts when no conflicts exist', async () => {
    const finder = jest.fn().mockResolvedValue([]);
    const result = await enrichEventWithConflicts(BASE_EVENT, 5, finder);

    expect(result.myConflicts).toEqual([]);
    expect(finder).toHaveBeenCalledWith({
      userId: 5,
      startTime: new Date('2026-05-01T18:00:00.000Z'),
      endTime: new Date('2026-05-01T20:00:00.000Z'),
      excludeEventId: 1,
    });
  });

  it('maps conflicts to ConflictingEventDto shape', async () => {
    const conflicts = [
      buildConflict(10, 'Raid Night'),
      buildConflict(11, 'Dungeon Run'),
    ];
    const finder = jest.fn().mockResolvedValue(conflicts);

    const result = await enrichEventWithConflicts(BASE_EVENT, 5, finder);

    expect(result.myConflicts).toHaveLength(2);
    expect(result.myConflicts![0]).toEqual({
      id: 10,
      title: 'Raid Night',
      startTime: '2026-05-01T17:00:00.000Z',
      endTime: '2026-05-01T19:00:00.000Z',
    });
    expect(result.myConflicts![1]).toEqual({
      id: 11,
      title: 'Dungeon Run',
      startTime: '2026-05-01T17:00:00.000Z',
      endTime: '2026-05-01T19:00:00.000Z',
    });
  });

  it('excludes the current event from conflict search', async () => {
    const finder = jest.fn().mockResolvedValue([]);
    await enrichEventWithConflicts(BASE_EVENT, 5, finder);

    const params = finder.mock.calls[0][0];
    expect(params.excludeEventId).toBe(1);
  });

  it('returns event unchanged when finder throws (graceful)', async () => {
    const finder = jest.fn().mockRejectedValue(new Error('DB error'));
    const result = await enrichEventWithConflicts(BASE_EVENT, 5, finder);

    expect(result).toEqual(BASE_EVENT);
    expect(result.myConflicts).toBeUndefined();
  });
});
