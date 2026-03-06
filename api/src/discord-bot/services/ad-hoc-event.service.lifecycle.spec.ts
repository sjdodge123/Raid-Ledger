/**
 * AdHocEventService — finalizeEvent, getAdHocRoster, getActiveState,
 * onModuleInit, onEventCancelled, onEventDeleted, scheduled event interaction tests.
 */
import {
  baseMember,
  baseBinding,
  setupAdHocTestModule,
  type AdHocMocks,
} from './ad-hoc-event.service.spec-helpers';
import type { AdHocEventService } from './ad-hoc-event.service';

describe('AdHocEventService — lifecycle', () => {
  let service: AdHocEventService;
  let mocks: AdHocMocks;

  beforeEach(async () => {
    const setup = await setupAdHocTestModule();
    service = setup.service;
    mocks = setup.mocks;
  });

  afterEach(() => jest.clearAllMocks());

  /** Helper: create an active event on a binding for subsequent tests. */
  async function createActiveEvent(bindingId: string, eventId: number) {
    mocks.settingsService.get.mockResolvedValue('true');
    mocks.db.limit.mockResolvedValueOnce([]); // scheduled overlap check
    mocks.db.limit.mockResolvedValueOnce([{ name: 'WoW' }]);
    mocks.db.returning.mockResolvedValueOnce([{ id: eventId }]);
    mocks.db.limit.mockResolvedValueOnce([
      {
        id: eventId,
        title: 'WoW — Quick Play',
        gameId: 1,
        channelBindingId: bindingId,
      },
    ]);
    mocks.db.limit.mockResolvedValueOnce([{ name: 'WoW' }]);
    await service.handleVoiceJoin(bindingId, baseMember, baseBinding);
  }

  describe('finalizeEvent', () => {
    it('finalizes event when status is grace_period', async () => {
      mocks.db.returning.mockResolvedValueOnce([
        {
          id: 500,
          adHocStatus: 'grace_period',
          channelBindingId: 'binding-fin',
          gameId: 1,
          duration: [
            new Date('2026-02-10T18:00:00Z'),
            new Date('2026-02-10T19:00:00Z'),
          ],
        },
      ]);
      mocks.db.limit.mockResolvedValueOnce([{ name: 'WoW' }]);
      await service.finalizeEvent(500);
      expect(mocks.participantService.finalizeAll).toHaveBeenCalledWith(500);
      expect(mocks.db.update).toHaveBeenCalled();
      expect(mocks.db.set).toHaveBeenCalledWith(
        expect.objectContaining({ adHocStatus: 'ended' }),
      );
    });

    it('skips finalization when event is not in grace_period', async () => {
      mocks.db.returning.mockResolvedValueOnce([]);
      await service.finalizeEvent(501);
      expect(mocks.participantService.finalizeAll).not.toHaveBeenCalled();
    });

    it('skips finalization when event not found', async () => {
      mocks.db.returning.mockResolvedValueOnce([]);
      await service.finalizeEvent(999);
      expect(mocks.participantService.finalizeAll).not.toHaveBeenCalled();
    });

    it('removes binding from active events map', async () => {
      await createActiveEvent('binding-cleanup', 600);
      expect(service.getActiveState('binding-cleanup', 1)).toBeDefined();
      mocks.db.returning.mockResolvedValueOnce([
        {
          id: 600,
          adHocStatus: 'grace_period',
          channelBindingId: 'binding-cleanup',
          gameId: 1,
          duration: [new Date(), new Date()],
        },
      ]);
      mocks.db.limit.mockResolvedValueOnce([{ name: 'WoW' }]);
      await service.finalizeEvent(600);
      expect(service.getActiveState('binding-cleanup', 1)).toBeUndefined();
    });
  });

  describe('getAdHocRoster', () => {
    it('returns roster with active count', async () => {
      mocks.participantService.getRoster.mockResolvedValue([
        {
          id: 'uuid-1',
          eventId: 42,
          userId: 1,
          discordUserId: 'discord-1',
          discordUsername: 'Player1',
          discordAvatarHash: null,
          joinedAt: '2026-02-10T18:00:00Z',
          leftAt: null,
          totalDurationSeconds: null,
          sessionCount: 1,
        },
      ]);
      mocks.participantService.getActiveCount.mockResolvedValue(1);
      const result = await service.getAdHocRoster(42);
      expect(result).toMatchObject({
        eventId: 42,
        participants: expect.any(Array),
        activeCount: 1,
      });
      expect(result.participants).toHaveLength(1);
    });
  });

  describe('getActiveState', () => {
    it('returns undefined when no active event for binding', () => {
      expect(service.getActiveState('nonexistent')).toBeUndefined();
    });

    it('returns state after event creation', async () => {
      await createActiveEvent('binding-state', 700);
      const state = service.getActiveState('binding-state', 1);
      expect(state).toBeDefined();
      expect(state?.eventId).toBe(700);
      expect(state?.memberSet.has('discord-123')).toBe(true);
    });
  });

  describe('onModuleInit', () => {
    it('recovers live ad-hoc events from database', async () => {
      mocks.db.where.mockResolvedValueOnce([
        {
          id: 800,
          isAdHoc: true,
          adHocStatus: 'live',
          channelBindingId: 'binding-800',
        },
        {
          id: 801,
          isAdHoc: true,
          adHocStatus: 'live',
          channelBindingId: 'binding-801',
        },
      ]);
      await service.onModuleInit();
      expect(service.getActiveState('binding-800')).toBeDefined();
      expect(service.getActiveState('binding-800')?.eventId).toBe(800);
      expect(service.getActiveState('binding-801')).toBeDefined();
    });

    it('skips events without channelBindingId', async () => {
      mocks.db.where.mockResolvedValueOnce([
        { id: 900, isAdHoc: true, adHocStatus: 'live', channelBindingId: null },
      ]);
      await service.onModuleInit();
      expect(service.getActiveState('')).toBeUndefined();
    });

    it('handles no live events', async () => {
      mocks.db.where.mockResolvedValueOnce([]);
      await service.onModuleInit();
      expect(service.getActiveState('anything')).toBeUndefined();
    });
  });

  describe('onEventCancelled', () => {
    it('cleans up active state when a live ad-hoc event is cancelled', async () => {
      await createActiveEvent('binding-cancel', 800);
      expect(service.getActiveState('binding-cancel', 1)).toBeDefined();
      await service.onEventCancelled({ eventId: 800 });
      expect(service.getActiveState('binding-cancel', 1)).toBeUndefined();
      expect(mocks.gracePeriodQueue.cancel).toHaveBeenCalledWith(800);
    });

    it('does nothing when event ID has no active state', async () => {
      await service.onEventCancelled({ eventId: 999 });
      expect(mocks.gracePeriodQueue.cancel).not.toHaveBeenCalled();
    });
  });

  describe('onEventDeleted', () => {
    it('cleans up active state when a live ad-hoc event is deleted', async () => {
      await createActiveEvent('binding-delete', 850);
      expect(service.getActiveState('binding-delete', 1)).toBeDefined();
      await service.onEventDeleted({ eventId: 850 });
      expect(service.getActiveState('binding-delete', 1)).toBeUndefined();
      expect(mocks.gracePeriodQueue.cancel).toHaveBeenCalledWith(850);
    });
  });

  describe('scheduled event interaction', () => {
    it('extends scheduled event end time when members join during active event', async () => {
      mocks.settingsService.get.mockResolvedValue('true');
      const eventStart = new Date(Date.now() - 3600000);
      const eventEnd = new Date(Date.now() - 60000);
      mocks.db.limit.mockResolvedValueOnce([
        { id: 42, duration: [eventStart, eventEnd] },
      ]);
      await service.handleVoiceJoin('binding-extend', baseMember, baseBinding);
      expect(mocks.db.insert).not.toHaveBeenCalled();
      expect(mocks.db.update).toHaveBeenCalled();
      expect(mocks.db.set).toHaveBeenCalledWith(
        expect.objectContaining({ extendedUntil: expect.any(Date) }),
      );
    });

    it('allows ad-hoc creation when no scheduled event exists', async () => {
      mocks.settingsService.get.mockResolvedValue('true');
      mocks.db.limit.mockResolvedValueOnce([]);
      mocks.db.limit.mockResolvedValueOnce([{ name: 'WoW' }]);
      mocks.db.returning.mockResolvedValueOnce([{ id: 999 }]);
      mocks.db.limit.mockResolvedValueOnce([
        {
          id: 999,
          title: 'WoW — Quick Play',
          gameId: 1,
          channelBindingId: 'binding-new',
        },
      ]);
      mocks.db.limit.mockResolvedValueOnce([{ name: 'WoW' }]);
      await service.handleVoiceJoin('binding-new', baseMember, baseBinding);
      expect(mocks.db.insert).toHaveBeenCalled();
    });
  });
});
