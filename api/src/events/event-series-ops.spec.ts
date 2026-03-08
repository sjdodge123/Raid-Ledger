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
  let mockEmitter: { emit: jest.Mock };

  beforeEach(() => {
    mockDb = createDrizzleMock();
    mockEmitter = { emit: jest.fn() };
  });

  it('updates only anchor for scope=this', async () => {
    const anchor = makeAnchor();
    mockDb.limit.mockResolvedValueOnce([anchor]);

    await updateSeriesEvents(
      mockDb as never,
      mockEmitter as never,
      1,
      CREATOR_ID,
      false,
      'this',
      { title: 'Updated' },
    );

    expect(mockDb.update).toHaveBeenCalled();
    expect(mockEmitter.emit).toHaveBeenCalledTimes(1);
  });

  it('updates all events for scope=all', async () => {
    const anchor = makeAnchor();
    const siblings = [anchor, makeSibling(2, 7), makeSibling(3, 14)];
    mockDb.limit.mockResolvedValueOnce([anchor]);
    mockDb.orderBy.mockResolvedValueOnce(siblings);

    await updateSeriesEvents(
      mockDb as never,
      mockEmitter as never,
      1,
      CREATOR_ID,
      false,
      'all',
      { title: 'Updated All' },
    );

    expect(mockDb.update).toHaveBeenCalledTimes(3);
    expect(mockEmitter.emit).toHaveBeenCalledTimes(3);
  });

  it('throws ForbiddenException for non-owner non-admin', async () => {
    const anchor = makeAnchor();
    mockDb.limit.mockResolvedValueOnce([anchor]);

    await expect(
      updateSeriesEvents(
        mockDb as never,
        mockEmitter as never,
        1,
        999,
        false,
        'this',
        { title: 'Nope' },
      ),
    ).rejects.toThrow(ForbiddenException);
  });
});

describe('deleteSeriesEvents', () => {
  let mockDb: MockDb;
  let mockEmitter: { emit: jest.Mock };

  beforeEach(() => {
    mockDb = createDrizzleMock();
    mockEmitter = { emit: jest.fn() };
  });

  it('deletes only anchor for scope=this', async () => {
    const anchor = makeAnchor();
    mockDb.limit.mockResolvedValueOnce([anchor]);

    await deleteSeriesEvents(
      mockDb as never,
      mockEmitter as never,
      1,
      CREATOR_ID,
      false,
      'this',
    );

    expect(mockDb.delete).toHaveBeenCalledTimes(1);
    expect(mockEmitter.emit).toHaveBeenCalledTimes(1);
  });

  it('deletes all events for scope=all', async () => {
    const anchor = makeAnchor();
    const siblings = [anchor, makeSibling(2, 7), makeSibling(3, 14)];
    mockDb.limit.mockResolvedValueOnce([anchor]);
    mockDb.orderBy.mockResolvedValueOnce(siblings);

    await deleteSeriesEvents(
      mockDb as never,
      mockEmitter as never,
      1,
      CREATOR_ID,
      false,
      'all',
    );

    expect(mockDb.delete).toHaveBeenCalledTimes(3);
    expect(mockEmitter.emit).toHaveBeenCalledTimes(3);
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

    await cancelSeriesEvents(
      mockDb as never,
      mockNotification as never,
      1,
      CREATOR_ID,
      false,
      'this',
      {},
    );

    expect(mockDb.update).toHaveBeenCalled();
  });

  it('cancels all events for scope=all', async () => {
    const anchor = makeAnchor();
    const siblings = [anchor, makeSibling(2, 7), makeSibling(3, 14)];
    mockDb.limit.mockResolvedValueOnce([anchor]);
    mockDb.orderBy.mockResolvedValueOnce(siblings);
    setupCancelMocks();

    await cancelSeriesEvents(
      mockDb as never,
      mockNotification as never,
      1,
      CREATOR_ID,
      false,
      'all',
      { reason: 'Holiday break' },
    );

    expect(mockDb.update).toHaveBeenCalledTimes(3);
  });

  it('skips already-cancelled events', async () => {
    const anchor = makeAnchor();
    const cancelled = makeSibling(2, 7);
    (cancelled as Record<string, unknown>).cancelledAt = new Date();
    mockDb.limit.mockResolvedValueOnce([anchor]);
    mockDb.orderBy.mockResolvedValueOnce([anchor, cancelled]);
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

    // Only 1 update (the non-cancelled anchor), not 2
    expect(mockDb.update).toHaveBeenCalledTimes(1);
  });
});
