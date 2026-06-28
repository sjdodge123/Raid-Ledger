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
import { buildUpdateData } from './event-update.helpers';

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

  describe('computeTimeDelta + applyTimeDelta integration', () => {
    it('correctly shifts a sibling duration using computed delta', () => {
      const anchorStart = new Date('2026-03-10T18:00:00Z');
      const newStartIso = '2026-03-10T19:30:00Z';
      const delta = computeTimeDelta(anchorStart, newStartIso);

      expect(delta).toBe(5400_000); // +1.5 hours

      const siblingDuration = [
        new Date('2026-03-17T18:00:00Z'),
        new Date('2026-03-17T20:00:00Z'),
      ] as [Date, Date];
      const [start, end] = applyTimeDelta(siblingDuration, delta);

      expect(start.toISOString()).toBe('2026-03-17T19:30:00.000Z');
      expect(end.toISOString()).toBe('2026-03-17T21:30:00.000Z');
    });

    it('preserves duration length when shifting earlier', () => {
      const anchorStart = new Date('2026-03-10T18:00:00Z');
      const delta = computeTimeDelta(anchorStart, '2026-03-10T16:00:00Z');

      const siblingDuration = [
        new Date('2026-03-17T18:00:00Z'),
        new Date('2026-03-17T20:00:00Z'),
      ] as [Date, Date];
      const [start, end] = applyTimeDelta(siblingDuration, delta);

      // Duration length (2 hours) is preserved
      const originalLen =
        siblingDuration[1].getTime() - siblingDuration[0].getTime();
      const shiftedLen = end.getTime() - start.getTime();
      expect(shiftedLen).toBe(originalLen);

      expect(start.toISOString()).toBe('2026-03-17T16:00:00.000Z');
      expect(end.toISOString()).toBe('2026-03-17T18:00:00.000Z');
    });
  });

  // ROK-1352: buildUpdateData drives both PATCH /events/:id (single) and
  // PATCH /events/:id/series (per resolved target). Mapping the per-event
  // ephemeral override here makes both edit + series-scope propagation work.
  describe('buildUpdateData — ephemeral voice override (ROK-1352)', () => {
    const existing = createMockEvent({ id: 1 }) as Parameters<
      typeof buildUpdateData
    >[1];

    it('maps ephemeralVoiceEnabled=true onto the update set', () => {
      const data = buildUpdateData({ ephemeralVoiceEnabled: true }, existing);
      expect(data.ephemeralVoiceEnabled).toBe(true);
    });

    it('maps an explicit opt-out (false)', () => {
      const data = buildUpdateData({ ephemeralVoiceEnabled: false }, existing);
      expect(data.ephemeralVoiceEnabled).toBe(false);
    });

    it('maps null to clear the override (inherit series/global)', () => {
      const data = buildUpdateData({ ephemeralVoiceEnabled: null }, existing);
      expect(data.ephemeralVoiceEnabled).toBeNull();
    });

    it('omits the column when the field is not in the DTO', () => {
      const data = buildUpdateData({ title: 'unchanged' }, existing);
      expect('ephemeralVoiceEnabled' in data).toBe(false);
    });
  });
});
