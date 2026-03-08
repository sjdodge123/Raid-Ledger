/**
 * Tests for event series helper functions (ROK-429).
 */
import { NotFoundException } from '@nestjs/common';
import { createDrizzleMock, type MockDb } from '../common/testing/drizzle-mock';
import { createMockEvent } from '../common/testing/factories';
import {
  findSeriesEvents,
  computeTimeDelta,
  applyTimeDelta,
} from './event-series.helpers';

const GROUP_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

function seriesEvent(id: number, startHour: number) {
  return createMockEvent({
    id,
    recurrenceGroupId: GROUP_ID,
    duration: [
      new Date(
        `2026-03-${10 + id}T${String(startHour).padStart(2, '0')}:00:00Z`,
      ),
      new Date(
        `2026-03-${10 + id}T${String(startHour + 2).padStart(2, '0')}:00:00Z`,
      ),
    ] as [Date, Date],
  });
}

describe('event-series.helpers', () => {
  let mockDb: MockDb;

  beforeEach(() => {
    mockDb = createDrizzleMock();
  });

  describe('findSeriesEvents', () => {
    it('returns events for a group ordered by start time', async () => {
      const events = [
        seriesEvent(1, 18),
        seriesEvent(2, 18),
        seriesEvent(3, 18),
      ];
      mockDb.orderBy.mockResolvedValueOnce(events);

      const result = await findSeriesEvents(mockDb as never, GROUP_ID);

      expect(result).toHaveLength(3);
      expect(mockDb.select).toHaveBeenCalled();
      expect(mockDb.where).toHaveBeenCalled();
    });

    it('throws NotFoundException when no events in group', async () => {
      mockDb.orderBy.mockResolvedValueOnce([]);

      await expect(findSeriesEvents(mockDb as never, GROUP_ID)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('computeTimeDelta', () => {
    it('computes millisecond delta between old and new times', () => {
      const oldStart = new Date('2026-03-10T18:00:00Z');
      const newStartIso = '2026-03-10T19:00:00Z';
      const delta = computeTimeDelta(oldStart, newStartIso);
      expect(delta).toBe(3600_000); // 1 hour
    });

    it('computes negative delta when shifted earlier', () => {
      const oldStart = new Date('2026-03-10T18:00:00Z');
      const newStartIso = '2026-03-10T17:30:00Z';
      const delta = computeTimeDelta(oldStart, newStartIso);
      expect(delta).toBe(-1800_000); // -30 min
    });
  });

  describe('applyTimeDelta', () => {
    it('shifts duration by delta ms', () => {
      const duration = [
        new Date('2026-03-10T18:00:00Z'),
        new Date('2026-03-10T20:00:00Z'),
      ] as [Date, Date];
      const delta = 3600_000; // +1 hour

      const [start, end] = applyTimeDelta(duration, delta);

      expect(start.toISOString()).toBe('2026-03-10T19:00:00.000Z');
      expect(end.toISOString()).toBe('2026-03-10T21:00:00.000Z');
    });
  });
});
