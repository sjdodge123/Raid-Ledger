/**
 * AdHocEventService — isEnabled, handleVoiceJoin, handleVoiceLeave tests.
 */
import { SETTING_KEYS } from '../../drizzle/schema';
import {
  baseMember,
  baseBinding,
  setupAdHocTestModule,
  type AdHocMocks,
} from './ad-hoc-event.service.spec-helpers';
import type { AdHocEventService } from './ad-hoc-event.service';

describe('AdHocEventService — voice', () => {
  let service: AdHocEventService;
  let mocks: AdHocMocks;

  beforeEach(async () => {
    const setup = await setupAdHocTestModule();
    service = setup.service;
    mocks = setup.mocks;
  });

  afterEach(() => jest.clearAllMocks());

  describe('isEnabled', () => {
    it('returns true when setting is "true"', async () => {
      mocks.settingsService.get.mockResolvedValue('true');
      const result = await service.isEnabled();
      expect(result).toBe(true);
      expect(mocks.settingsService.get).toHaveBeenCalledWith(
        SETTING_KEYS.AD_HOC_EVENTS_ENABLED,
      );
    });

    it('returns false when setting is not "true"', async () => {
      mocks.settingsService.get.mockResolvedValue('false');
      expect(await service.isEnabled()).toBe(false);
    });

    it('returns false when setting is null', async () => {
      mocks.settingsService.get.mockResolvedValue(null);
      expect(await service.isEnabled()).toBe(false);
    });
  });

  describe('handleVoiceJoin', () => {
    it('does nothing when feature is disabled', async () => {
      mocks.settingsService.get.mockResolvedValue('false');
      await service.handleVoiceJoin('binding-1', baseMember, baseBinding);
      expect(mocks.db.insert).not.toHaveBeenCalled();
      expect(mocks.participantService.addParticipant).not.toHaveBeenCalled();
    });

    it('suppresses ad-hoc creation when a scheduled event is active on the binding', async () => {
      mocks.settingsService.get.mockResolvedValue('true');
      mocks.db.limit.mockResolvedValueOnce([
        {
          id: 42,
          duration: [
            new Date('2026-02-10T18:00:00Z'),
            new Date('2026-02-10T19:00:00Z'),
          ],
        },
      ]);
      await service.handleVoiceJoin(
        'binding-suppress',
        baseMember,
        baseBinding,
      );
      expect(mocks.db.insert).not.toHaveBeenCalled();
      expect(mocks.participantService.addParticipant).not.toHaveBeenCalled();
      expect(mocks.db.update).toHaveBeenCalled();
    });

    it('creates a new ad-hoc event when no active event exists', async () => {
      mocks.settingsService.get.mockResolvedValue('true');
      mocks.db.limit.mockResolvedValueOnce([]);
      mocks.db.limit.mockResolvedValueOnce([{ name: 'World of Warcraft' }]);
      mocks.db.returning.mockResolvedValueOnce([{ id: 100 }]);
      mocks.db.limit.mockResolvedValueOnce([
        {
          id: 100,
          title: 'World of Warcraft — Quick Play',
          gameId: 1,
          channelBindingId: 'binding-1',
        },
      ]);
      mocks.db.limit.mockResolvedValueOnce([{ name: 'World of Warcraft' }]);
      await service.handleVoiceJoin('binding-1', baseMember, baseBinding);
      expect(mocks.db.insert).toHaveBeenCalled();
      expect(mocks.participantService.addParticipant).toHaveBeenCalledWith(
        100,
        baseMember,
      );
    });

    it('creates event with "Gaming" title when no game is bound', async () => {
      mocks.settingsService.get.mockResolvedValue('true');
      const noGameBinding = { ...baseBinding, gameId: null };
      mocks.db.limit.mockResolvedValueOnce([]);
      mocks.db.returning.mockResolvedValueOnce([{ id: 101 }]);
      mocks.db.limit.mockResolvedValueOnce([
        {
          id: 101,
          title: 'Gaming — Quick Play',
          gameId: null,
          channelBindingId: 'binding-2',
        },
      ]);
      await service.handleVoiceJoin('binding-2', baseMember, noGameBinding);
      expect(mocks.db.values).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Gaming — Quick Play' }),
      );
    });

    it('falls back to admin user when member has no linked account', async () => {
      mocks.settingsService.get.mockResolvedValue('true');
      const anonymousMember = { ...baseMember, userId: null };
      mocks.db.limit.mockResolvedValueOnce([]);
      mocks.db.limit.mockResolvedValueOnce([{ id: 99 }]);
      mocks.db.limit.mockResolvedValueOnce([{ name: 'FFXIV' }]);
      mocks.db.returning.mockResolvedValueOnce([{ id: 102 }]);
      mocks.db.limit.mockResolvedValueOnce([
        {
          id: 102,
          title: 'FFXIV — Quick Play',
          gameId: 1,
          channelBindingId: 'binding-3',
        },
      ]);
      mocks.db.limit.mockResolvedValueOnce([{ name: 'FFXIV' }]);
      await service.handleVoiceJoin('binding-3', anonymousMember, baseBinding);
      expect(mocks.db.returning).toHaveBeenCalled();
      expect(mocks.participantService.addParticipant).toHaveBeenCalledWith(
        102,
        anonymousMember,
      );
    });

    it('returns null when no admin found and no linked user', async () => {
      mocks.settingsService.get.mockResolvedValue('true');
      const anonymousMember = { ...baseMember, userId: null };
      mocks.db.limit.mockResolvedValueOnce([]);
      mocks.db.limit.mockResolvedValueOnce([]);
      await service.handleVoiceJoin('binding-4', anonymousMember, baseBinding);
      expect(mocks.db.returning).not.toHaveBeenCalled();
      expect(mocks.participantService.addParticipant).not.toHaveBeenCalled();
    });

    it('adds joiner to existing live event and cancels grace period', async () => {
      mocks.settingsService.get.mockResolvedValue('true');
      mocks.db.limit.mockResolvedValueOnce([]);
      mocks.db.limit.mockResolvedValueOnce([{ name: 'WoW' }]);
      mocks.db.returning.mockResolvedValueOnce([{ id: 200 }]);
      mocks.db.limit.mockResolvedValueOnce([
        {
          id: 200,
          title: 'WoW — Quick Play',
          gameId: 1,
          channelBindingId: 'binding-5',
        },
      ]);
      mocks.db.limit.mockResolvedValueOnce([{ name: 'WoW' }]);
      await service.handleVoiceJoin('binding-5', baseMember, baseBinding);
      mocks.settingsService.get.mockResolvedValue('true');
      const secondMember = {
        ...baseMember,
        discordUserId: 'discord-456',
        discordUsername: 'Player2',
      };
      mocks.db.limit.mockResolvedValueOnce([
        { id: 200, adHocStatus: 'live', channelBindingId: 'binding-5' },
      ]);
      mocks.db.returning.mockResolvedValueOnce([]);
      await service.handleVoiceJoin('binding-5', secondMember, baseBinding);
      expect(mocks.gracePeriodQueue.cancel).toHaveBeenCalledWith(200);
      expect(mocks.participantService.addParticipant).toHaveBeenCalledWith(
        200,
        secondMember,
      );
    });

    it('sets event reminders to false for ad-hoc events', async () => {
      mocks.settingsService.get.mockResolvedValue('true');
      mocks.db.limit.mockResolvedValueOnce([]);
      mocks.db.limit.mockResolvedValueOnce([{ name: 'Game' }]);
      mocks.db.returning.mockResolvedValueOnce([{ id: 300 }]);
      mocks.db.limit.mockResolvedValueOnce([
        {
          id: 300,
          title: 'Game — Quick Play',
          gameId: 1,
          channelBindingId: 'binding-6',
        },
      ]);
      mocks.db.limit.mockResolvedValueOnce([{ name: 'Game' }]);
      await service.handleVoiceJoin('binding-6', baseMember, baseBinding);
      expect(mocks.db.values).toHaveBeenCalledWith(
        expect.objectContaining({
          isAdHoc: true,
          adHocStatus: 'live',
          reminder15min: false,
          reminder1hour: false,
          reminder24hour: false,
        }),
      );
    });
  });

  describe('handleVoiceLeave', () => {
    it('does nothing when no active event for binding', async () => {
      await service.handleVoiceLeave('nonexistent-binding', 'discord-123');
      expect(mocks.participantService.markLeave).not.toHaveBeenCalled();
    });

    it('marks participant as left and starts grace period when channel empties', async () => {
      mocks.settingsService.get.mockResolvedValue('true');
      mocks.db.limit.mockResolvedValueOnce([]);
      mocks.db.limit.mockResolvedValueOnce([{ name: 'WoW' }]);
      mocks.db.returning.mockResolvedValueOnce([{ id: 400 }]);
      mocks.db.limit.mockResolvedValueOnce([
        {
          id: 400,
          title: 'WoW — Quick Play',
          gameId: 1,
          channelBindingId: 'binding-leave',
        },
      ]);
      mocks.db.limit.mockResolvedValueOnce([{ name: 'WoW' }]);
      await service.handleVoiceJoin('binding-leave', baseMember, baseBinding);
      mocks.db.limit.mockResolvedValueOnce([
        { id: 400, adHocStatus: 'live', channelBindingId: 'binding-leave' },
      ]);
      mocks.channelBindingsService.getBindingById.mockResolvedValue({
        id: 'binding-leave',
        config: { gracePeriod: 5 },
      });
      await service.handleVoiceLeave('binding-leave', 'discord-123');
      expect(mocks.participantService.markLeave).toHaveBeenCalledWith(
        400,
        'discord-123',
      );
      expect(mocks.gracePeriodQueue.enqueue).toHaveBeenCalledWith(
        400,
        5 * 60 * 1000,
      );
    });

    it('uses default 5 minute grace period when not configured', async () => {
      mocks.settingsService.get.mockResolvedValue('true');
      mocks.db.limit.mockResolvedValueOnce([]);
      mocks.db.limit.mockResolvedValueOnce([{ name: 'WoW' }]);
      mocks.db.returning.mockResolvedValueOnce([{ id: 401 }]);
      mocks.db.limit.mockResolvedValueOnce([
        {
          id: 401,
          title: 'WoW — Quick Play',
          gameId: 1,
          channelBindingId: 'binding-default-grace',
        },
      ]);
      mocks.db.limit.mockResolvedValueOnce([{ name: 'WoW' }]);
      await service.handleVoiceJoin(
        'binding-default-grace',
        baseMember,
        baseBinding,
      );
      mocks.db.limit.mockResolvedValueOnce([
        {
          id: 401,
          adHocStatus: 'live',
          channelBindingId: 'binding-default-grace',
        },
      ]);
      mocks.channelBindingsService.getBindingById.mockResolvedValue({
        id: 'binding-default-grace',
        config: null,
      });
      await service.handleVoiceLeave('binding-default-grace', 'discord-123');
      expect(mocks.gracePeriodQueue.enqueue).toHaveBeenCalledWith(
        401,
        5 * 60 * 1000,
      );
    });
  });
});
