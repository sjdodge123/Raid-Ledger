import { Test } from '@nestjs/testing';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ActiveEventCacheService, CachedEvent } from './active-event-cache.service';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { createDrizzleMock } from '../common/testing/drizzle-mock';

function makeEvent(overrides: Partial<CachedEvent> & { id: number }): CachedEvent {
  return {
    startTime: new Date('2026-03-18T20:00:00Z'),
    effectiveEndTime: new Date('2026-03-18T22:00:00Z'),
    cancelledAt: null,
    isAdHoc: false,
    ...overrides,
  };
}

describe('ActiveEventCacheService', () => {
  let service: ActiveEventCacheService;
  let mockDb: ReturnType<typeof createDrizzleMock>;

  beforeEach(async () => {
    mockDb = createDrizzleMock();
    mockDb.where.mockResolvedValue([]);

    const module = await Test.createTestingModule({
      imports: [EventEmitterModule.forRoot()],
      providers: [
        ActiveEventCacheService,
        { provide: DrizzleAsyncProvider, useValue: mockDb },
      ],
    }).compile();

    service = module.get(ActiveEventCacheService);
  });

  describe('getActiveEvents', () => {
    it('returns events in progress', () => {
      const now = new Date('2026-03-18T21:00:00Z');
      const active = makeEvent({ id: 1 });
      const future = makeEvent({
        id: 2,
        startTime: new Date('2026-03-19T20:00:00Z'),
        effectiveEndTime: new Date('2026-03-19T22:00:00Z'),
      });
      // Manually populate cache
      (service as any).cache = new Map([
        [1, active],
        [2, future],
      ]);

      const result = service.getActiveEvents(now);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(1);
    });

    it('excludes cancelled events', () => {
      const now = new Date('2026-03-18T21:00:00Z');
      const cancelled = makeEvent({ id: 1, cancelledAt: new Date() });
      (service as any).cache = new Map([[1, cancelled]]);

      expect(service.getActiveEvents(now)).toHaveLength(0);
    });
  });

  describe('getUpcomingEvents', () => {
    it('returns events starting within window', () => {
      const now = new Date('2026-03-18T19:00:00Z');
      const soon = makeEvent({ id: 1 });
      const far = makeEvent({
        id: 2,
        startTime: new Date('2026-03-20T20:00:00Z'),
        effectiveEndTime: new Date('2026-03-20T22:00:00Z'),
      });
      (service as any).cache = new Map([
        [1, soon],
        [2, far],
      ]);

      const twoHoursMs = 2 * 60 * 60 * 1000;
      const result = service.getUpcomingEvents(now, twoHoursMs);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(1);
    });
  });

  describe('getRecentlyEndedEvents', () => {
    it('returns events that ended within lookback window', () => {
      const now = new Date('2026-03-18T22:30:00Z');
      const recent = makeEvent({ id: 1 });
      const old = makeEvent({
        id: 2,
        startTime: new Date('2026-03-17T20:00:00Z'),
        effectiveEndTime: new Date('2026-03-17T22:00:00Z'),
      });
      (service as any).cache = new Map([
        [1, recent],
        [2, old],
      ]);

      const oneHourMs = 60 * 60 * 1000;
      const result = service.getRecentlyEndedEvents(now, oneHourMs);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(1);
    });
  });

  describe('hasRelevantEvents', () => {
    it('returns true when events exist in the window', () => {
      const now = new Date('2026-03-18T21:00:00Z');
      (service as any).cache = new Map([[1, makeEvent({ id: 1 })]]);

      expect(service.hasRelevantEvents(now, 60_000, 60_000)).toBe(true);
    });

    it('returns false when no events in window', () => {
      const now = new Date('2026-03-20T12:00:00Z');
      (service as any).cache = new Map([[1, makeEvent({ id: 1 })]]);

      expect(service.hasRelevantEvents(now, 60_000, 60_000)).toBe(false);
    });
  });

  describe('invalidate', () => {
    it('removes an event from the cache', () => {
      (service as any).cache = new Map([[1, makeEvent({ id: 1 })]]);
      service.invalidate(1);
      expect((service as any).cache.size).toBe(0);
    });
  });

  describe('refresh', () => {
    it('populates cache from DB query', async () => {
      const now = new Date();
      mockDb.where.mockResolvedValueOnce([
        {
          id: 1,
          duration: [
            new Date('2026-03-18T20:00:00Z'),
            new Date('2026-03-18T22:00:00Z'),
          ],
          extendedUntil: null,
          cancelledAt: null,
          isAdHoc: false,
        },
      ]);

      await service.refresh();
      const cache = (service as any).cache as Map<number, CachedEvent>;
      expect(cache.size).toBe(1);
      expect(cache.get(1)?.id).toBe(1);
    });

    it('uses extendedUntil as effectiveEndTime when present', async () => {
      const extended = new Date('2026-03-18T23:00:00Z');
      mockDb.where.mockResolvedValueOnce([
        {
          id: 1,
          duration: [
            new Date('2026-03-18T20:00:00Z'),
            new Date('2026-03-18T22:00:00Z'),
          ],
          extendedUntil: extended,
          cancelledAt: null,
          isAdHoc: false,
        },
      ]);

      await service.refresh();
      const cache = (service as any).cache as Map<number, CachedEvent>;
      expect(cache.get(1)?.effectiveEndTime).toEqual(extended);
    });
  });

  describe('event handlers', () => {
    it('handleDeleted removes event from cache', () => {
      (service as any).cache = new Map([[42, makeEvent({ id: 42 })]]);
      service.handleDeleted({ eventId: 42 });
      expect((service as any).cache.has(42)).toBe(false);
    });

    it('handleCreated triggers refresh', async () => {
      const spy = jest.spyOn(service, 'refresh').mockResolvedValue();
      service.handleCreated();
      await new Promise(process.nextTick);
      expect(spy).toHaveBeenCalled();
    });

    it('handleUpdated triggers refresh', async () => {
      const spy = jest.spyOn(service, 'refresh').mockResolvedValue();
      service.handleUpdated();
      await new Promise(process.nextTick);
      expect(spy).toHaveBeenCalled();
    });

    it('handleCancelled triggers refresh', async () => {
      const spy = jest.spyOn(service, 'refresh').mockResolvedValue();
      service.handleCancelled();
      await new Promise(process.nextTick);
      expect(spy).toHaveBeenCalled();
    });
  });
});
