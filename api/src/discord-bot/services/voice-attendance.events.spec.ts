/**
 * voice-attendance.adversarial.spec.ts
 *
 * Adversarial tests for ROK-490: voice presence attendance tracking.
 * Focus areas:
 *  1. classifyVoiceSession — exact boundary conditions the dev tests missed
 *  2. In-memory session lifecycle with duration accumulation
 *  3. autoPopulateAttendance — manual overrides preserved, unlinked users
 *  4. flushToDb — dirty flag lifecycle, active-segment snapshot
 *  5. VoiceStateListener — scheduled event branch fires independently of ad-hoc
 *  6. EventsController voice endpoints — 403 for non-creator / non-admin
 */
import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { VoiceAttendanceService } from './voice-attendance.service';
import { ChannelBindingsService } from './channel-bindings.service';
import { ChannelResolverService } from './channel-resolver.service';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { VoiceStateListener } from '../listeners/voice-state.listener';
import { AdHocEventService } from './ad-hoc-event.service';
import { PresenceGameDetectorService } from './presence-game-detector.service';
import { GameActivityService } from './game-activity.service';
import { UsersService } from '../../users/users.service';
import { Events, Collection } from 'discord.js';
import { AdHocEventsGateway } from '../../events/ad-hoc-events.gateway';
import { DepartureGraceService } from '../services/departure-grace.service';
import { EventsAttendanceController } from '../../events/events-attendance.controller';
import { EventsService } from '../../events/events.service';
import { AttendanceService } from '../../events/attendance.service';
import { AnalyticsService } from '../../events/analytics.service';

import type { UserRole } from '@raid-ledger/contract';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeCollection<K, V>(entries: [K, V][] = []): Collection<K, V> {
  const col = new Collection<K, V>();
  for (const [key, val] of entries) {
    col.set(key, val);
  }
  return col;
}

// ─── 1. classifyVoiceSession — Boundary Conditions ────────────────────────────

describe('VoiceStateListener — scheduled event branch (ROK-490)', () => {
  let listener: VoiceStateListener;
  let mockVoiceAttendanceService: {
    findActiveScheduledEvents: jest.Mock;
    handleJoin: jest.Mock;
    handleLeave: jest.Mock;
    recoverActiveSessions: jest.Mock;
    getActiveRoster: jest.Mock;
  };
  let mockAdHocEventService: {
    handleVoiceJoin: jest.Mock;
    handleVoiceLeave: jest.Mock;
    getActiveState: jest.Mock;
  };
  let mockChannelBindingsService: {
    getBindings: jest.Mock;
    getBindingsWithGameNames: jest.Mock;
  };
  let mockClientService: { getClient: jest.Mock; getGuildId: jest.Mock };
  let voiceHandler: (oldState: unknown, newState: unknown) => void;

  function buildProvidersCore() {
    return [
      VoiceStateListener,
      { provide: DiscordBotClientService, useValue: mockClientService },
      { provide: AdHocEventService, useValue: mockAdHocEventService },
      {
        provide: VoiceAttendanceService,
        useValue: mockVoiceAttendanceService,
      },
      {
        provide: DepartureGraceService,
        useValue: {
          onMemberLeave: jest.fn().mockResolvedValue(undefined),
          onMemberRejoin: jest.fn().mockResolvedValue(undefined),
        },
      },
    ];
  }

  function buildProvidersMocks() {
    return [
      {
        provide: ChannelBindingsService,
        useValue: mockChannelBindingsService,
      },
      {
        provide: PresenceGameDetectorService,
        useValue: {
          detectGameForMember: jest.fn().mockResolvedValue(null),
          detectGames: jest.fn().mockResolvedValue([]),
        },
      },
      {
        provide: GameActivityService,
        useValue: {
          bufferStart: jest.fn(),
          bufferStop: jest.fn(),
        },
      },
      {
        provide: UsersService,
        useValue: { findByDiscordId: jest.fn().mockResolvedValue(null) },
      },
      {
        provide: AdHocEventsGateway,
        useValue: { emitRosterUpdate: jest.fn() },
      },
    ];
  }

  function buildProviders() {
    return [...buildProvidersCore(), ...buildProvidersMocks()];
  }
  async function setupBlock() {
    jest.useFakeTimers();

    mockVoiceAttendanceService = {
      findActiveScheduledEvents: jest.fn().mockResolvedValue([]),
      handleJoin: jest.fn(),
      handleLeave: jest.fn(),
      recoverActiveSessions: jest.fn().mockResolvedValue(undefined),
      getActiveRoster: jest
        .fn()
        .mockReturnValue({ participants: [], activeCount: 0 }),
    };

    mockAdHocEventService = {
      handleVoiceJoin: jest.fn().mockResolvedValue(undefined),
      handleVoiceLeave: jest.fn().mockResolvedValue(undefined),
      getActiveState: jest.fn().mockReturnValue(undefined),
    };

    mockChannelBindingsService = {
      getBindings: jest.fn().mockResolvedValue([]),
      getBindingsWithGameNames: jest.fn().mockResolvedValue([]),
    };

    mockClientService = {
      getClient: jest.fn(),
      getGuildId: jest.fn().mockReturnValue('guild-1'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: buildProviders(),
    }).compile();

    listener = module.get(VoiceStateListener);

    // Set up client with handler capture
    const mockClient = {
      on: jest
        .fn()
        .mockImplementation(
          (event: string, handler: (...args: unknown[]) => void) => {
            if (event === (Events.VoiceStateUpdate as string)) {
              voiceHandler = handler;
            }
          },
        ),
      removeListener: jest.fn(),
      guilds: {
        cache: makeCollection([
          [
            'guild-1',
            {
              channels: {
                cache: makeCollection([]),
              },
            },
          ],
        ]),
      },
    };
    mockClientService.getClient.mockReturnValue(mockClient);
    await listener.onBotConnected();
  }

  beforeEach(async () => {
    await setupBlock();
  });

  afterEach(() => {
    listener.onBotDisconnected();
    jest.useRealTimers();
  });

  it('calls voiceAttendanceService.handleJoin when there are active scheduled events on channel join', async () => {
    mockVoiceAttendanceService.findActiveScheduledEvents.mockResolvedValue([
      { eventId: 101, gameId: 1 },
    ]);

    voiceHandler(
      { channelId: null, id: 'user-scheduled' },
      {
        channelId: 'voice-ch-scheduled',
        id: 'user-scheduled',
        member: {
          displayName: 'ScheduledPlayer',
          user: { username: 'ScheduledPlayer', avatar: null },
        },
      },
    );

    await jest.advanceTimersByTimeAsync(2100);

    expect(mockVoiceAttendanceService.handleJoin).toHaveBeenCalledWith(
      101,
      'user-scheduled',
      'ScheduledPlayer',
      null,
      null,
    );
  });

  it('calls voiceAttendanceService.handleLeave on channel leave with active scheduled events', async () => {
    mockVoiceAttendanceService.findActiveScheduledEvents.mockResolvedValue([
      { eventId: 202, gameId: 2 },
    ]);

    // Set up a binding so the ad-hoc path also fires
    mockChannelBindingsService.getBindingsWithGameNames.mockResolvedValue([
      {
        id: 'bind-1',
        channelId: 'voice-ch-leave2',
        bindingPurpose: 'game-voice-monitor',
        gameId: 2,
        gameName: 'TestGame',
        config: {},
      },
    ]);

    voiceHandler(
      { channelId: 'voice-ch-leave2', id: 'user-leave2' },
      { channelId: null, id: 'user-leave2', member: null },
    );

    await jest.advanceTimersByTimeAsync(2100);

    expect(mockVoiceAttendanceService.handleLeave).toHaveBeenCalledWith(
      202,
      'user-leave2',
    );
  });

  it('voice attendance join fires independently of the ad-hoc binding (no binding needed)', async () => {
    // No channel binding for the channel, but there IS an active scheduled event
    mockChannelBindingsService.getBindingsWithGameNames.mockResolvedValue([]);
    mockVoiceAttendanceService.findActiveScheduledEvents.mockResolvedValue([
      { eventId: 303, gameId: null },
    ]);

    voiceHandler(
      { channelId: null, id: 'user-no-binding' },
      {
        channelId: 'voice-ch-no-binding',
        id: 'user-no-binding',
        member: {
          displayName: 'UnboundPlayer',
          user: { username: 'UnboundPlayer', avatar: null },
        },
      },
    );

    await jest.advanceTimersByTimeAsync(2100);

    // VoiceAttendance SHOULD fire even without a channel binding
    expect(mockVoiceAttendanceService.handleJoin).toHaveBeenCalledWith(
      303,
      'user-no-binding',
      'UnboundPlayer',
      null,
      null,
    );
    // Ad-hoc service should NOT fire (no binding)
    expect(mockAdHocEventService.handleVoiceJoin).not.toHaveBeenCalled();
  });

  async function testVoiceattendancetracksmultipleactivescheduledeventsfor() {
    // Edge case: two scheduled events active at the same time in the same channel
    mockVoiceAttendanceService.findActiveScheduledEvents.mockResolvedValue([
      { eventId: 401, gameId: 1 },
      { eventId: 402, gameId: 1 },
    ]);

    voiceHandler(
      { channelId: null, id: 'user-multi-event' },
      {
        channelId: 'voice-ch-multi',
        id: 'user-multi-event',
        member: {
          displayName: 'MultiPlayer',
          user: { username: 'MultiPlayer', avatar: null },
        },
      },
    );

    await jest.advanceTimersByTimeAsync(2100);

    expect(mockVoiceAttendanceService.handleJoin).toHaveBeenCalledTimes(2);
    expect(mockVoiceAttendanceService.handleJoin).toHaveBeenCalledWith(
      401,
      'user-multi-event',
      'MultiPlayer',
      null,
      null,
    );
    expect(mockVoiceAttendanceService.handleJoin).toHaveBeenCalledWith(
      402,
      'user-multi-event',
      'MultiPlayer',
      null,
      null,
    );
  }

  it('voice attendance tracks multiple active scheduled events for the same channel join', async () => {
    await testVoiceattendancetracksmultipleactivescheduledeventsfor();
  });

  async function testVoiceattendancejoinerrordoesnotbreakthe() {
    // Even if findActiveScheduledEvents throws, the ad-hoc path should continue
    mockVoiceAttendanceService.findActiveScheduledEvents.mockRejectedValue(
      new Error('DB connection lost'),
    );
    mockChannelBindingsService.getBindingsWithGameNames.mockResolvedValue([
      {
        id: 'bind-fallback',
        channelId: 'voice-ch-fallback',
        bindingPurpose: 'game-voice-monitor',
        gameId: 1,
        gameName: 'TestGame',
        config: { minPlayers: 1 },
      },
    ]);
    mockAdHocEventService.getActiveState.mockReturnValue({
      eventId: 500,
      memberSet: new Set(),
      lastExtendedAt: 0,
    });

    voiceHandler(
      { channelId: null, id: 'user-fallback' },
      {
        channelId: 'voice-ch-fallback',
        id: 'user-fallback',
        member: {
          displayName: 'FallbackPlayer',
          user: { username: 'FallbackPlayer', avatar: null },
        },
      },
    );

    // Should not throw — error is caught and logged
    await jest.advanceTimersByTimeAsync(2100);

    // Ad-hoc path continues despite voice attendance error
    expect(mockAdHocEventService.handleVoiceJoin).toHaveBeenCalled();
  }

  it('voice attendance join error does not break the ad-hoc path', async () => {
    await testVoiceattendancejoinerrordoesnotbreakthe();
  });

  it('voice attendance leave error does not break the ad-hoc path', async () => {
    mockVoiceAttendanceService.findActiveScheduledEvents.mockRejectedValue(
      new Error('DB connection lost'),
    );
    mockChannelBindingsService.getBindingsWithGameNames.mockResolvedValue([
      {
        id: 'bind-leave-err',
        channelId: 'voice-ch-leave-err',
        bindingPurpose: 'game-voice-monitor',
        gameId: 1,
        gameName: 'TestGame',
        config: {},
      },
    ]);

    voiceHandler(
      { channelId: 'voice-ch-leave-err', id: 'user-leave-err' },
      { channelId: null, id: 'user-leave-err', member: null },
    );

    await jest.advanceTimersByTimeAsync(2100);

    expect(mockAdHocEventService.handleVoiceLeave).toHaveBeenCalled();
  });

  it('recoverActiveSessions is called on bot connect', () => {
    // Already called in beforeEach, just verify it was invoked
    expect(mockVoiceAttendanceService.recoverActiveSessions).toHaveBeenCalled();
  });
});

// ─── 5. EventsController — voice endpoint auth (403 for non-creator/non-admin) ─

describe('EventsController — voice endpoint authorization', () => {
  let controller: EventsAttendanceController;
  let module: TestingModule;
  let mockEventsService: Partial<EventsService>;
  let mockVoiceAttendanceService: {
    getVoiceSessions: jest.Mock;
    getVoiceAttendanceSummary: jest.Mock;
  };

  const creatorId = 1;
  const otherUserId = 2;
  const adminUser = {
    id: 3,
    role: 'admin' as UserRole,
    username: 'admin',
    discordId: null,
    impersonatedBy: null,
  };
  const operatorUser = {
    id: 4,
    role: 'operator' as UserRole,
    username: 'operator',
    discordId: null,
    impersonatedBy: null,
  };
  const memberUser = {
    id: otherUserId,
    role: 'member' as UserRole,
    username: 'member',
    discordId: null,
    impersonatedBy: null,
  };

  const mockEvent = {
    id: 10,
    title: 'Test Event',
    creator: {
      id: creatorId,
      discordId: '111',
      username: 'creator',
      avatar: null,
    },
    game: null,
    createdAt: '2026-02-01T00:00:00.000Z',
    updatedAt: '2026-02-01T00:00:00.000Z',
  };

  function buildProviders2() {
    return [
      { provide: EventsService, useValue: mockEventsService },
      {
        provide: AttendanceService,
        useValue: {
          recordAttendance: jest.fn(),
          getAttendanceSummary: jest.fn(),
        },
      },
      {
        provide: AdHocEventService,
        useValue: { getAdHocRoster: jest.fn() },
      },
      {
        provide: VoiceAttendanceService,
        useValue: mockVoiceAttendanceService,
      },
      {
        provide: AnalyticsService,
        useValue: { getEventMetrics: jest.fn() },
      },
      {
        provide: ChannelResolverService,
        useValue: { resolveVoiceChannelForScheduledEvent: jest.fn() },
      },
      {
        provide: DiscordBotClientService,
        useValue: { getGuildId: jest.fn(), getClient: jest.fn() },
      },
    ];
  }
  async function setupBlock2() {
    mockEventsService = {
      findOne: jest.fn().mockResolvedValue(mockEvent),
    };

    mockVoiceAttendanceService = {
      getVoiceSessions: jest
        .fn()
        .mockResolvedValue({ eventId: 10, sessions: [] }),
      getVoiceAttendanceSummary: jest.fn().mockResolvedValue({
        eventId: 10,
        totalTracked: 0,
        full: 0,
        partial: 0,
        late: 0,
        earlyLeaver: 0,
        noShow: 0,
        unclassified: 0,
        sessions: [],
      }),
    };

    module = await Test.createTestingModule({
      controllers: [EventsAttendanceController],
      providers: buildProviders2(),
    }).compile();

    controller = module.get<EventsAttendanceController>(
      EventsAttendanceController,
    );
  }

  beforeEach(async () => {
    await setupBlock2();
  });

  describe('GET :id/voice-sessions', () => {
    it('allows event creator to view voice sessions', async () => {
      const result = await controller.getVoiceSessions(10, {
        user: {
          id: creatorId,
          role: 'member' as UserRole,
          username: 'creator',
          discordId: null,
          impersonatedBy: null,
        },
      });

      expect(result).toMatchObject({ eventId: 10 });
      expect(mockVoiceAttendanceService.getVoiceSessions).toHaveBeenCalledWith(
        10,
      );
    });

    it('allows admin to view voice sessions for any event', async () => {
      const result = await controller.getVoiceSessions(10, { user: adminUser });

      expect(result).toMatchObject({ eventId: 10 });
    });

    it('allows operator to view voice sessions for any event', async () => {
      const result = await controller.getVoiceSessions(10, {
        user: operatorUser,
      });

      expect(result).toMatchObject({ eventId: 10 });
    });

    it('throws ForbiddenException for a non-creator member user', async () => {
      await expect(
        controller.getVoiceSessions(10, { user: memberUser }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws ForbiddenException with descriptive message for unauthorized user', async () => {
      await expect(
        controller.getVoiceSessions(10, { user: memberUser }),
      ).rejects.toMatchObject({
        message: expect.stringContaining('creator'),
      });
    });
  });

  describe('GET :id/voice-attendance', () => {
    it('allows event creator to view voice attendance', async () => {
      const result = await controller.getVoiceAttendance(10, {
        user: {
          id: creatorId,
          role: 'member' as UserRole,
          username: 'creator',
          discordId: null,
          impersonatedBy: null,
        },
      });

      expect(result).toMatchObject({ eventId: 10 });
      expect(
        mockVoiceAttendanceService.getVoiceAttendanceSummary,
      ).toHaveBeenCalledWith(10);
    });

    it('allows admin to view voice attendance for any event', async () => {
      const result = await controller.getVoiceAttendance(10, {
        user: adminUser,
      });

      expect(result).toMatchObject({ eventId: 10, totalTracked: 0 });
    });

    it('allows operator to view voice attendance for any event', async () => {
      const result = await controller.getVoiceAttendance(10, {
        user: operatorUser,
      });

      expect(result).toMatchObject({ eventId: 10 });
    });

    it('throws ForbiddenException for a non-creator member user', async () => {
      await expect(
        controller.getVoiceAttendance(10, { user: memberUser }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws ForbiddenException with descriptive message for unauthorized user', async () => {
      await expect(
        controller.getVoiceAttendance(10, { user: memberUser }),
      ).rejects.toMatchObject({
        message: expect.stringContaining('creator'),
      });
    });

    it('returns summary with correct shape including all classification counts', async () => {
      mockVoiceAttendanceService.getVoiceAttendanceSummary.mockResolvedValue({
        eventId: 10,
        totalTracked: 5,
        full: 2,
        partial: 1,
        late: 1,
        earlyLeaver: 0,
        noShow: 1,
        unclassified: 0,
        sessions: [],
      });

      const result = await controller.getVoiceAttendance(10, {
        user: {
          id: creatorId,
          role: 'member' as UserRole,
          username: 'creator',
          discordId: null,
          impersonatedBy: null,
        },
      });

      expect(result).toMatchObject({
        eventId: expect.any(Number),
        totalTracked: expect.any(Number),
        full: expect.any(Number),
        partial: expect.any(Number),
        late: expect.any(Number),
        earlyLeaver: expect.any(Number),
        noShow: expect.any(Number),
        unclassified: expect.any(Number),
      });
    });
  });

  describe('GET :id/metrics', () => {
    it('allows event creator to view event metrics', async () => {
      const mockMetrics = { eventId: 10, title: 'Test Event' };
      const analyticsService = module.get(AnalyticsService);
      (analyticsService.getEventMetrics as jest.Mock).mockResolvedValue(
        mockMetrics,
      );

      const result = await controller.getEventMetrics(10, {
        user: {
          id: creatorId,
          role: 'member' as UserRole,
          username: 'creator',
          discordId: null,
          impersonatedBy: null,
        },
      });

      expect(result).toMatchObject({ eventId: 10 });
    });

    it('allows admin to view event metrics for any event', async () => {
      const analyticsService = module.get(AnalyticsService);
      (analyticsService.getEventMetrics as jest.Mock).mockResolvedValue({
        eventId: 10,
      });

      const result = await controller.getEventMetrics(10, { user: adminUser });
      expect(result).toMatchObject({ eventId: 10 });
    });

    it('allows operator to view event metrics for any event', async () => {
      const analyticsService = module.get(AnalyticsService);
      (analyticsService.getEventMetrics as jest.Mock).mockResolvedValue({
        eventId: 10,
      });

      const result = await controller.getEventMetrics(10, {
        user: operatorUser,
      });
      expect(result).toMatchObject({ eventId: 10 });
    });

    it('throws ForbiddenException for a non-creator member user', async () => {
      await expect(
        controller.getEventMetrics(10, { user: memberUser }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws ForbiddenException with descriptive message for unauthorized user', async () => {
      await expect(
        controller.getEventMetrics(10, { user: memberUser }),
      ).rejects.toMatchObject({
        message: expect.stringContaining('creator'),
      });
    });
  });
});
