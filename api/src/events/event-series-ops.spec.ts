/**
 * Tests for event series operations: update, delete, cancel (ROK-429).
 */
import { ForbiddenException } from '@nestjs/common';
import { createDrizzleMock, type MockDb } from '../common/testing/drizzle-mock';
import { createMockEvent } from '../common/testing/factories';
import * as schema from '../drizzle/schema';
import {
  updateSeriesEvents,
  deleteSeriesEvents,
  cancelSeriesEvents,
} from './event-series.helpers';

const GROUP_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const CREATOR_ID = 1;

function makeAnchor(id = 1) {
  return createMockEvent({
    id,
    creatorId: CREATOR_ID,
    recurrenceGroupId: GROUP_ID,
    duration: [
      new Date('2026-03-10T18:00:00Z'),
      new Date('2026-03-10T20:00:00Z'),
    ] as [Date, Date],
  });
}

function makeSibling(id: number, dayOffset: number) {
  return createMockEvent({
    id,
    creatorId: CREATOR_ID,
    recurrenceGroupId: GROUP_ID,
    duration: [
      new Date(`2026-03-${10 + dayOffset}T18:00:00Z`),
      new Date(`2026-03-${10 + dayOffset}T20:00:00Z`),
    ] as [Date, Date],
  });
}

describe('updateSeriesEvents', () => {
  let mockDb: MockDb;

  beforeEach(() => {
    mockDb = createDrizzleMock();
  });

  it('updates only anchor for scope=this and returns its ID', async () => {
    const anchor = makeAnchor();
    mockDb.limit.mockResolvedValueOnce([anchor]);

    const ids = await updateSeriesEvents(
      mockDb as never,
      1,
      CREATOR_ID,
      false,
      'this',
      { title: 'Updated' },
    );

    expect(mockDb.update).toHaveBeenCalled();
    expect(ids).toEqual([1]);
  });

  it('updates each event individually for scope=all (different data per event)', async () => {
    const anchor = makeAnchor();
    const siblings = [anchor, makeSibling(2, 7), makeSibling(3, 14)];
    mockDb.limit.mockResolvedValueOnce([anchor]);
    mockDb.orderBy.mockResolvedValueOnce(siblings);

    const ids = await updateSeriesEvents(
      mockDb as never,
      1,
      CREATOR_ID,
      false,
      'all',
      { title: 'Updated All' },
    );

    // Updates must remain per-event because buildUpdateForTarget
    // produces different data for each event (time delta)
    expect(mockDb.update).toHaveBeenCalledTimes(3);
    expect(ids).toEqual([1, 2, 3]);
  });

  it('throws ForbiddenException for non-owner non-admin', async () => {
    const anchor = makeAnchor();
    mockDb.limit.mockResolvedValueOnce([anchor]);

    await expect(
      updateSeriesEvents(mockDb as never, 1, 999, false, 'this', {
        title: 'Nope',
      }),
    ).rejects.toThrow(ForbiddenException);
  });
});

describe('deleteSeriesEvents', () => {
  let mockDb: MockDb;

  beforeEach(() => {
    mockDb = createDrizzleMock();
  });

  it('deletes only anchor for scope=this and returns its ID', async () => {
    const anchor = makeAnchor();
    mockDb.limit.mockResolvedValueOnce([anchor]);

    const ids = await deleteSeriesEvents(
      mockDb as never,
      1,
      CREATOR_ID,
      false,
      'this',
    );

    expect(mockDb.delete).toHaveBeenCalledTimes(1);
    expect(ids).toEqual([1]);
  });

  it('uses a single batched delete for scope=all', async () => {
    const anchor = makeAnchor();
    const siblings = [anchor, makeSibling(2, 7), makeSibling(3, 14)];
    mockDb.limit.mockResolvedValueOnce([anchor]);
    mockDb.orderBy.mockResolvedValueOnce(siblings);

    const ids = await deleteSeriesEvents(
      mockDb as never,
      1,
      CREATOR_ID,
      false,
      'all',
    );

    // Should use 1 batched delete, not N individual deletes
    expect(mockDb.delete).toHaveBeenCalledTimes(1);
    expect(ids).toEqual([1, 2, 3]);
  });
});

describe('cancelSeriesEvents', () => {
  let mockDb: MockDb;
  let mockNotification: { create: jest.Mock; getDiscordEmbedUrl: jest.Mock };

  /**
   * getSignedUpUserIds terminates at .where() (no .limit), requiring
   * the mock to resolve to an array. We intercept .from() to detect
   * signups queries and make .where() resolve to [] for those.
   */
  function setupCancelMocks() {
    let inSignupsQuery = false;
    mockDb.from.mockImplementation((table: unknown) => {
      inSignupsQuery = table === schema.eventSignups;
      return mockDb;
    });
    mockDb.where.mockImplementation(() => {
      if (inSignupsQuery) {
        inSignupsQuery = false;
        return Promise.resolve([]);
      }
      return mockDb;
    });
  }

  beforeEach(() => {
    mockDb = createDrizzleMock();
    mockNotification = {
      create: jest.fn(),
      getDiscordEmbedUrl: jest.fn().mockResolvedValue(null),
    };
  });

  it('cancels only anchor for scope=this', async () => {
    const anchor = makeAnchor();
    mockDb.limit.mockResolvedValueOnce([anchor]);
    setupCancelMocks();

    const ids = await cancelSeriesEvents(
      mockDb as never,
      mockNotification as never,
      1,
      CREATOR_ID,
      false,
      'this',
      {},
    );

    expect(mockDb.update).toHaveBeenCalled();
    expect(ids).toEqual([1]);
  });

  it('uses a single batched update for scope=all', async () => {
    const anchor = makeAnchor();
    const siblings = [anchor, makeSibling(2, 7), makeSibling(3, 14)];
    mockDb.limit.mockResolvedValueOnce([anchor]);
    mockDb.orderBy.mockResolvedValueOnce(siblings);
    setupCancelMocks();

    const ids = await cancelSeriesEvents(
      mockDb as never,
      mockNotification as never,
      1,
      CREATOR_ID,
      false,
      'all',
      { reason: 'Holiday break' },
    );

    // Should use 1 batched update, not N individual updates
    expect(mockDb.update).toHaveBeenCalledTimes(1);
    expect(ids).toEqual([1, 2, 3]);
  });

  it('skips already-cancelled events in batched update', async () => {
    const anchor = makeAnchor();
    const cancelled = makeSibling(2, 7);
    (cancelled as Record<string, unknown>).cancelledAt = new Date();
    mockDb.limit.mockResolvedValueOnce([anchor]);
    mockDb.orderBy.mockResolvedValueOnce([anchor, cancelled]);
    setupCancelMocks();

    const ids = await cancelSeriesEvents(
      mockDb as never,
      mockNotification as never,
      1,
      CREATOR_ID,
      false,
      'all',
      {},
    );

    // Only 1 batched update for the non-cancelled event
    expect(mockDb.update).toHaveBeenCalledTimes(1);
    expect(ids).toEqual([1, 2]);
  });

  it('fetches signups in a single batch query', async () => {
    const anchor = makeAnchor();
    const sibling = makeSibling(2, 7);
    mockDb.limit.mockResolvedValueOnce([anchor]);
    mockDb.orderBy.mockResolvedValueOnce([anchor, sibling]);
    setupCancelMocks();

    await cancelSeriesEvents(
      mockDb as never,
      mockNotification as never,
      1,
      CREATOR_ID,
      false,
      'all',
      {},
    );

    // The signups query should only hit the DB once (batched via inArray),
    // not once per event. We detect this via the from(eventSignups) call count.
    const signupsFromCalls = mockDb.from.mock.calls.filter(
      (args: unknown[]) => args[0] === schema.eventSignups,
    );
    expect(signupsFromCalls).toHaveLength(1);
  });
});
