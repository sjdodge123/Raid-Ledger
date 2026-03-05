/**
 * voice-state.rok-697.spec.ts
 *
 * Tests for ROK-697: Refine ad-hoc quick play spawn constraints with
 * game activity detection.
 *
 * Two spawn paths:
 * 1. With unanimous game activity → spawn immediately
 * 2. Without unanimous game activity → spawn after 15-minute delay
 *    - Timer resets if count drops below threshold during wait
 */
import { Test, TestingModule } from '@nestjs/testing';
import { VoiceStateListener } from './voice-state.listener';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { AdHocEventService } from '../services/ad-hoc-event.service';
import { VoiceAttendanceService } from '../services/voice-attendance.service';
import { ChannelBindingsService } from '../services/channel-bindings.service';
import { PresenceGameDetectorService } from '../services/presence-game-detector.service';
import { GameActivityService } from '../services/game-activity.service';
import { UsersService } from '../../users/users.service';
import { AdHocEventsGateway } from '../../events/ad-hoc-events.gateway';
import { DepartureGraceService } from '../services/departure-grace.service';
import { Events, Collection } from 'discord.js';

/** 15 minutes in ms — matches VoiceStateListener.SPAWN_DELAY_MS */
const SPAWN_DELAY_MS = 15 * 60 * 1000;

function makeCollection<K, V>(entries: [K, V][] = []): Collection<K, V> {
  const col = new Collection<K, V>();
  for (const [key, val] of entries) {
    col.set(key, val);
  }
  return col;
}

describe('VoiceStateListener — ROK-697 game activity spawn constraints', () => {
  let listener: VoiceStateListener;
  let mockClientService: { getClient: jest.Mock; getGuildId: jest.Mock };
  let mockAdHocEventService: {
    handleVoiceJoin: jest.Mock;
    handleVoiceLeave: jest.Mock;
    getActiveState: jest.Mock;
  };
  let mockChannelBindingsService: {
    getBindings: jest.Mock;
    getBindingsWithGameNames: jest.Mock;
  };
  let mockPresenceDetector: {
    detectGameForMember: jest.Mock;
    detectGames: jest.Mock;
    setManualOverride: jest.Mock;
  };
  let mockGameActivityService: {
    bufferStart: jest.Mock;
    bufferStop: jest.Mock;
  };
  let mockUsersService: { findByDiscordId: jest.Mock };

  function createVoiceChannel(
    members: Array<{ id: string; displayName: string; avatar?: string | null }>,
  ) {
    const memberEntries = members.map((m) => [
      m.id,
      {
        id: m.id,
        displayName: m.displayName,
        user: { username: m.displayName, avatar: m.avatar ?? null },
        presence: null,
      },
    ]) as [string, unknown][];

    return {
      isVoiceBased: () => true,
      members: makeCollection(memberEntries),
    };
  }

  function createMockClient(guildChannels: Map<string, unknown> = new Map()) {
    const guild = {
      channels: {
        cache: makeCollection(
          Array.from(guildChannels.entries()).map(([id, ch]) => [id, ch]),
        ),
      },
    };

    return {
      on: jest.fn(),
      removeListener: jest.fn(),
      guilds: {
        cache: makeCollection([['guild-1', guild]]),
      },
    };
  }

  beforeEach(async () => {
    jest.useFakeTimers();

    mockClientService = {
      getClient: jest.fn(),
      getGuildId: jest.fn().mockReturnValue('guild-1'),
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

    mockPresenceDetector = {
      detectGameForMember: jest.fn().mockResolvedValue({
        gameId: null,
        gameName: 'Untitled Gaming Session',
      }),
      detectGames: jest.fn().mockResolvedValue([]),
      setManualOverride: jest.fn(),
    };

    mockGameActivityService = {
      bufferStart: jest.fn(),
      bufferStop: jest.fn(),
    };

    mockUsersService = {
      findByDiscordId: jest.fn().mockResolvedValue(null),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VoiceStateListener,
        { provide: DiscordBotClientService, useValue: mockClientService },
        { provide: AdHocEventService, useValue: mockAdHocEventService },
        {
          provide: VoiceAttendanceService,
          useValue: {
            findActiveScheduledEvents: jest.fn().mockResolvedValue([]),
            handleJoin: jest.fn(),
            handleLeave: jest.fn(),
            getActiveRoster: jest.fn().mockReturnValue({
              eventId: 0,
              participants: [],
              activeCount: 0,
            }),
            recoverActiveSessions: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: DepartureGraceService,
          useValue: {
            onMemberLeave: jest.fn().mockResolvedValue(undefined),
            onMemberRejoin: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: ChannelBindingsService,
          useValue: mockChannelBindingsService,
        },
        {
          provide: PresenceGameDetectorService,
          useValue: mockPresenceDetector,
        },
        {
          provide: GameActivityService,
          useValue: mockGameActivityService,
        },
        { provide: UsersService, useValue: mockUsersService },
        {
          provide: AdHocEventsGateway,
          useValue: {
            emitRosterUpdate: jest.fn(),
            emitStatusChange: jest.fn(),
            emitEndTimeExtended: jest.fn(),
          },
        },
      ],
    }).compile();

    listener = module.get(VoiceStateListener);
  });

  afterEach(() => {
    listener.onBotDisconnected();
    jest.useRealTimers();
  });

  /**
   * Sets up client + binding, calls onBotConnected, returns the captured
   * voiceStateUpdate handler. Bindings are set BEFORE onBotConnected so
   * they are cached correctly during startup recovery.
   */
  async function setupWithBinding(
    channelId: string,
    binding: object,
    channelMembers: Array<{ id: string; displayName: string }> = [
      { id: 'user-1', displayName: 'Player1' },
      { id: 'user-2', displayName: 'Player2' },
    ],
  ): Promise<(oldState: unknown, newState: unknown) => void> {
    let handler!: (oldState: unknown, newState: unknown) => void;

    const mockClient = createMockClient(
      new Map([[channelId, createVoiceChannel(channelMembers)]]),
    );
    mockClient.on.mockImplementation(
      (event: string, h: (...args: unknown[]) => void) => {
        if (event === (Events.VoiceStateUpdate as string)) handler = h;
      },
    );
    mockClientService.getClient.mockReturnValue(mockClient);
    mockChannelBindingsService.getBindingsWithGameNames.mockResolvedValue([
      binding,
    ]);

    await listener.onBotConnected();
    return handler;
  }

  const gameBinding = {
    id: 'bind-game',
    channelId: 'voice-ch',
    bindingPurpose: 'game-voice-monitor' as const,
    gameId: 1,
    gameName: 'Rise of Kingdoms',
    config: { minPlayers: 2 },
  };

  // ─── AC1: Spawn immediately with unanimous game activity ───────────────────

  describe('AC1: immediate spawn — all threshold players share same game (game-specific binding)', () => {
    it('spawns event immediately when all members are detected playing the binding game', async () => {
      const handler = await setupWithBinding('voice-ch', gameBinding);

      // Both members playing gameId=1 → unanimous
      mockPresenceDetector.detectGameForMember.mockResolvedValue({
        gameId: 1,
        gameName: 'Rise of Kingdoms',
      });
      mockAdHocEventService.getActiveState.mockReturnValue(undefined);

      // First join — below threshold
      handler(
        { channelId: null, id: 'user-1' },
        {
          channelId: 'voice-ch',
          id: 'user-1',
          member: {
            displayName: 'Player1',
            user: { username: 'Player1', avatar: null },
          },
        },
      );
      await jest.advanceTimersByTimeAsync(2100);

      // Second join — threshold met (2/2), unanimous → spawn immediately
      handler(
        { channelId: null, id: 'user-2' },
        {
          channelId: 'voice-ch',
          id: 'user-2',
          member: {
            displayName: 'Player2',
            user: { username: 'Player2', avatar: null },
          },
        },
      );
      await jest.advanceTimersByTimeAsync(2100);

      expect(mockAdHocEventService.handleVoiceJoin).toHaveBeenCalled();
    });

    it('does NOT start a delayed spawn timer when game activity is unanimous', async () => {
      const handler = await setupWithBinding('voice-ch', gameBinding);

      mockPresenceDetector.detectGameForMember.mockResolvedValue({
        gameId: 1,
        gameName: 'Rise of Kingdoms',
      });
      mockAdHocEventService.getActiveState.mockReturnValue(undefined);

      handler(
        { channelId: null, id: 'user-1' },
        {
          channelId: 'voice-ch',
          id: 'user-1',
          member: {
            displayName: 'Player1',
            user: { username: 'Player1', avatar: null },
          },
        },
      );
      await jest.advanceTimersByTimeAsync(2100);

      handler(
        { channelId: null, id: 'user-2' },
        {
          channelId: 'voice-ch',
          id: 'user-2',
          member: {
            displayName: 'Player2',
            user: { username: 'Player2', avatar: null },
          },
        },
      );
      await jest.advanceTimersByTimeAsync(2100);

      const callCountAfterImmediateSpawn =
        mockAdHocEventService.handleVoiceJoin.mock.calls.length;
      expect(callCountAfterImmediateSpawn).toBeGreaterThan(0);

      // Advance 15 minutes — no additional calls
      await jest.advanceTimersByTimeAsync(SPAWN_DELAY_MS + 100);

      expect(mockAdHocEventService.handleVoiceJoin.mock.calls.length).toBe(
        callCountAfterImmediateSpawn,
      );
    });
  });

  // ─── AC2: Delayed spawn — no unanimous game activity ──────────────────────

  describe('AC2: delayed spawn — threshold met but no unanimous game activity (game-specific binding)', () => {
    it('does NOT spawn immediately when no game activity is detected', async () => {
      const handler = await setupWithBinding('voice-ch', gameBinding);

      // No game activity detected
      mockPresenceDetector.detectGameForMember.mockResolvedValue({
        gameId: null,
        gameName: 'Untitled Gaming Session',
      });
      mockAdHocEventService.getActiveState.mockReturnValue(undefined);

      handler(
        { channelId: null, id: 'user-1' },
        {
          channelId: 'voice-ch',
          id: 'user-1',
          member: {
            displayName: 'Player1',
            user: { username: 'Player1', avatar: null },
          },
        },
      );
      await jest.advanceTimersByTimeAsync(2100);

      handler(
        { channelId: null, id: 'user-2' },
        {
          channelId: 'voice-ch',
          id: 'user-2',
          member: {
            displayName: 'Player2',
            user: { username: 'Player2', avatar: null },
          },
        },
      );
      await jest.advanceTimersByTimeAsync(2100);

      // Not spawned immediately
      expect(mockAdHocEventService.handleVoiceJoin).not.toHaveBeenCalled();
    });

    it('spawns event after 15-minute delay when no unanimous game activity', async () => {
      const handler = await setupWithBinding('voice-ch', gameBinding);

      // No game activity → delayed spawn path
      mockPresenceDetector.detectGameForMember.mockResolvedValue({
        gameId: null,
        gameName: 'Untitled Gaming Session',
      });
      mockAdHocEventService.getActiveState.mockReturnValue(undefined);

      handler(
        { channelId: null, id: 'user-1' },
        {
          channelId: 'voice-ch',
          id: 'user-1',
          member: {
            displayName: 'Player1',
            user: { username: 'Player1', avatar: null },
          },
        },
      );
      await jest.advanceTimersByTimeAsync(2100);

      handler(
        { channelId: null, id: 'user-2' },
        {
          channelId: 'voice-ch',
          id: 'user-2',
          member: {
            displayName: 'Player2',
            user: { username: 'Player2', avatar: null },
          },
        },
      );
      await jest.advanceTimersByTimeAsync(2100);

      // Not yet — the 15-minute timer has not fired
      expect(mockAdHocEventService.handleVoiceJoin).not.toHaveBeenCalled();

      // Advance 15 minutes — delayed spawn fires
      await jest.advanceTimersByTimeAsync(SPAWN_DELAY_MS + 100);

      expect(mockAdHocEventService.handleVoiceJoin).toHaveBeenCalled();
    });

    it('does NOT spawn immediately when players are playing DIFFERENT games', async () => {
      const handler = await setupWithBinding('voice-ch', gameBinding);

      // First member plays binding game, second plays a different game → not unanimous
      mockPresenceDetector.detectGameForMember
        .mockResolvedValueOnce({ gameId: 1, gameName: 'Rise of Kingdoms' })
        .mockResolvedValueOnce({ gameId: 2, gameName: 'Other Game' });

      mockAdHocEventService.getActiveState.mockReturnValue(undefined);

      handler(
        { channelId: null, id: 'user-1' },
        {
          channelId: 'voice-ch',
          id: 'user-1',
          member: {
            displayName: 'Player1',
            user: { username: 'Player1', avatar: null },
          },
        },
      );
      await jest.advanceTimersByTimeAsync(2100);

      handler(
        { channelId: null, id: 'user-2' },
        {
          channelId: 'voice-ch',
          id: 'user-2',
          member: {
            displayName: 'Player2',
            user: { username: 'Player2', avatar: null },
          },
        },
      );
      await jest.advanceTimersByTimeAsync(2100);

      // Not spawned immediately
      expect(mockAdHocEventService.handleVoiceJoin).not.toHaveBeenCalled();
    });
  });

  // ─── AC3: Timer cancels on player count drop ───────────────────────────────

  describe('AC3: timer resets/cancels when count drops below threshold', () => {
    it('cancels pending spawn timer when a player leaves and drops below threshold', async () => {
      const handler = await setupWithBinding('voice-ch', gameBinding);

      // No game detected → delayed spawn
      mockPresenceDetector.detectGameForMember.mockResolvedValue({
        gameId: null,
        gameName: 'Untitled Gaming Session',
      });
      mockAdHocEventService.getActiveState.mockReturnValue(undefined);

      // Two members join — threshold met, delayed spawn scheduled
      handler(
        { channelId: null, id: 'user-1' },
        {
          channelId: 'voice-ch',
          id: 'user-1',
          member: {
            displayName: 'Player1',
            user: { username: 'Player1', avatar: null },
          },
        },
      );
      await jest.advanceTimersByTimeAsync(2100);

      handler(
        { channelId: null, id: 'user-2' },
        {
          channelId: 'voice-ch',
          id: 'user-2',
          member: {
            displayName: 'Player2',
            user: { username: 'Player2', avatar: null },
          },
        },
      );
      await jest.advanceTimersByTimeAsync(2100);

      // Not yet spawned
      expect(mockAdHocEventService.handleVoiceJoin).not.toHaveBeenCalled();

      // One player leaves — count drops below threshold → cancel timer
      handler(
        { channelId: 'voice-ch', id: 'user-2' },
        { channelId: null, id: 'user-2', member: null },
      );
      await jest.advanceTimersByTimeAsync(2100);

      // Advance 15 minutes — timer was cancelled, no spawn
      await jest.advanceTimersByTimeAsync(SPAWN_DELAY_MS + 100);

      // handleVoiceJoin should NOT have been called (spawn was cancelled)
      expect(mockAdHocEventService.handleVoiceJoin).not.toHaveBeenCalled();
    });

    it('does NOT fire spawn after 15 minutes when all players leave during the wait', async () => {
      const handler = await setupWithBinding('voice-ch', gameBinding);

      mockPresenceDetector.detectGameForMember.mockResolvedValue({
        gameId: null,
        gameName: 'Untitled Gaming Session',
      });
      mockAdHocEventService.getActiveState.mockReturnValue(undefined);

      // Two join, triggering delayed spawn timer
      handler(
        { channelId: null, id: 'user-1' },
        {
          channelId: 'voice-ch',
          id: 'user-1',
          member: {
            displayName: 'Player1',
            user: { username: 'Player1', avatar: null },
          },
        },
      );
      await jest.advanceTimersByTimeAsync(2100);
      handler(
        { channelId: null, id: 'user-2' },
        {
          channelId: 'voice-ch',
          id: 'user-2',
          member: {
            displayName: 'Player2',
            user: { username: 'Player2', avatar: null },
          },
        },
      );
      await jest.advanceTimersByTimeAsync(2100);

      // Both leave — below threshold, timer cancelled
      handler(
        { channelId: 'voice-ch', id: 'user-1' },
        { channelId: null, id: 'user-1', member: null },
      );
      await jest.advanceTimersByTimeAsync(2100);
      handler(
        { channelId: 'voice-ch', id: 'user-2' },
        { channelId: null, id: 'user-2', member: null },
      );
      await jest.advanceTimersByTimeAsync(2100);

      // No spawn even after 15 minutes
      await jest.advanceTimersByTimeAsync(SPAWN_DELAY_MS + 100);
      expect(mockAdHocEventService.handleVoiceJoin).not.toHaveBeenCalled();
    });
  });

  // ─── AC4: Existing bound channel detection still applies ──────────────────

  describe('AC4: unbound channels do not trigger quick play or game activity checks', () => {
    it('does not trigger game activity check or spawn for unbound channels', async () => {
      // No bindings
      mockChannelBindingsService.getBindingsWithGameNames.mockResolvedValue([]);

      let handler!: (oldState: unknown, newState: unknown) => void;
      const mockClient = createMockClient(
        new Map([
          [
            'unbound-ch',
            createVoiceChannel([{ id: 'user-1', displayName: 'P1' }]),
          ],
        ]),
      );
      mockClient.on.mockImplementation(
        (event: string, h: (...args: unknown[]) => void) => {
          if (event === (Events.VoiceStateUpdate as string)) handler = h;
        },
      );
      mockClientService.getClient.mockReturnValue(mockClient);
      await listener.onBotConnected();

      handler(
        { channelId: null, id: 'user-1' },
        {
          channelId: 'unbound-ch',
          id: 'user-1',
          member: {
            displayName: 'Player1',
            user: { username: 'Player1', avatar: null },
          },
        },
      );
      await jest.advanceTimersByTimeAsync(2100);
      await jest.advanceTimersByTimeAsync(SPAWN_DELAY_MS + 100);

      expect(mockAdHocEventService.handleVoiceJoin).not.toHaveBeenCalled();
      // detectGameForMember should not have been called for presence check
      // (only binding resolution happens, not game detection)
      expect(mockPresenceDetector.detectGameForMember).not.toHaveBeenCalled();
    });
  });

  // ─── AC5: Game activity from presence data ────────────────────────────────

  describe('AC5: game activity is read from Discord presence data (detectGameForMember)', () => {
    it('calls detectGameForMember to decide spawn path and spawns immediately when unanimous', async () => {
      const handler = await setupWithBinding('voice-ch', gameBinding);

      // Both playing binding game → unanimous, spawn immediately
      mockPresenceDetector.detectGameForMember.mockResolvedValue({
        gameId: 1,
        gameName: 'Rise of Kingdoms',
      });
      mockAdHocEventService.getActiveState.mockReturnValue(undefined);

      handler(
        { channelId: null, id: 'user-1' },
        {
          channelId: 'voice-ch',
          id: 'user-1',
          member: {
            displayName: 'Player1',
            user: { username: 'Player1', avatar: null },
          },
        },
      );
      await jest.advanceTimersByTimeAsync(2100);

      handler(
        { channelId: null, id: 'user-2' },
        {
          channelId: 'voice-ch',
          id: 'user-2',
          member: {
            displayName: 'Player2',
            user: { username: 'Player2', avatar: null },
          },
        },
      );
      await jest.advanceTimersByTimeAsync(2100);

      expect(mockPresenceDetector.detectGameForMember).toHaveBeenCalled();
      expect(mockAdHocEventService.handleVoiceJoin).toHaveBeenCalled();
    });

    it('routes to delayed path when detectGameForMember returns null for any member', async () => {
      const handler = await setupWithBinding('voice-ch', gameBinding);

      // First member playing the game, second has null gameId → not unanimous
      mockPresenceDetector.detectGameForMember
        .mockResolvedValueOnce({ gameId: 1, gameName: 'Rise of Kingdoms' })
        .mockResolvedValueOnce({
          gameId: null,
          gameName: 'Untitled Gaming Session',
        });

      mockAdHocEventService.getActiveState.mockReturnValue(undefined);

      handler(
        { channelId: null, id: 'user-1' },
        {
          channelId: 'voice-ch',
          id: 'user-1',
          member: {
            displayName: 'Player1',
            user: { username: 'Player1', avatar: null },
          },
        },
      );
      await jest.advanceTimersByTimeAsync(2100);

      handler(
        { channelId: null, id: 'user-2' },
        {
          channelId: 'voice-ch',
          id: 'user-2',
          member: {
            displayName: 'Player2',
            user: { username: 'Player2', avatar: null },
          },
        },
      );
      await jest.advanceTimersByTimeAsync(2100);

      // No immediate spawn
      expect(mockAdHocEventService.handleVoiceJoin).not.toHaveBeenCalled();

      // Spawn happens after delay
      await jest.advanceTimersByTimeAsync(SPAWN_DELAY_MS + 100);
      expect(mockAdHocEventService.handleVoiceJoin).toHaveBeenCalled();
    });
  });

  // ─── Edge cases ────────────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('does not schedule a second delayed spawn timer when a third player joins during the wait', async () => {
      const handler = await setupWithBinding('voice-ch', gameBinding, [
        { id: 'user-1', displayName: 'Player1' },
        { id: 'user-2', displayName: 'Player2' },
        { id: 'user-3', displayName: 'Player3' },
      ]);

      // No game activity → delayed spawn
      mockPresenceDetector.detectGameForMember.mockResolvedValue({
        gameId: null,
        gameName: 'Untitled Gaming Session',
      });
      mockAdHocEventService.getActiveState.mockReturnValue(undefined);

      handler(
        { channelId: null, id: 'user-1' },
        {
          channelId: 'voice-ch',
          id: 'user-1',
          member: {
            displayName: 'Player1',
            user: { username: 'Player1', avatar: null },
          },
        },
      );
      await jest.advanceTimersByTimeAsync(2100);

      // Second join — threshold met, timer set
      handler(
        { channelId: null, id: 'user-2' },
        {
          channelId: 'voice-ch',
          id: 'user-2',
          member: {
            displayName: 'Player2',
            user: { username: 'Player2', avatar: null },
          },
        },
      );
      await jest.advanceTimersByTimeAsync(2100);

      // Third join during wait — should be a no-op for timer logic
      handler(
        { channelId: null, id: 'user-3' },
        {
          channelId: 'voice-ch',
          id: 'user-3',
          member: {
            displayName: 'Player3',
            user: { username: 'Player3', avatar: null },
          },
        },
      );
      await jest.advanceTimersByTimeAsync(2100);

      // No immediate spawn
      expect(mockAdHocEventService.handleVoiceJoin).not.toHaveBeenCalled();

      // Spawn fires after delay
      await jest.advanceTimersByTimeAsync(SPAWN_DELAY_MS + 100);
      expect(mockAdHocEventService.handleVoiceJoin).toHaveBeenCalled();
    });

    it('skips spawn if active event already exists when delayed timer fires', async () => {
      const handler = await setupWithBinding('voice-ch', gameBinding);

      mockPresenceDetector.detectGameForMember.mockResolvedValue({
        gameId: null,
        gameName: 'Untitled Gaming Session',
      });

      // No event initially → delayed spawn scheduled
      mockAdHocEventService.getActiveState.mockReturnValue(undefined);

      handler(
        { channelId: null, id: 'user-1' },
        {
          channelId: 'voice-ch',
          id: 'user-1',
          member: {
            displayName: 'Player1',
            user: { username: 'Player1', avatar: null },
          },
        },
      );
      await jest.advanceTimersByTimeAsync(2100);

      handler(
        { channelId: null, id: 'user-2' },
        {
          channelId: 'voice-ch',
          id: 'user-2',
          member: {
            displayName: 'Player2',
            user: { username: 'Player2', avatar: null },
          },
        },
      );
      await jest.advanceTimersByTimeAsync(2100);

      expect(mockAdHocEventService.handleVoiceJoin).not.toHaveBeenCalled();

      // Simulate an event becoming active before timer fires
      mockAdHocEventService.getActiveState.mockReturnValue({
        eventId: 999,
        memberSet: new Set(['user-1', 'user-2']),
        lastExtendedAt: 0,
      });

      // Timer fires — but active event exists, no second spawn
      await jest.advanceTimersByTimeAsync(SPAWN_DELAY_MS + 100);

      expect(mockAdHocEventService.handleVoiceJoin).not.toHaveBeenCalled();
    });

    it('clears all pending spawn timers on bot disconnect', async () => {
      const handler = await setupWithBinding('voice-ch', gameBinding);

      mockPresenceDetector.detectGameForMember.mockResolvedValue({
        gameId: null,
        gameName: 'Untitled Gaming Session',
      });
      mockAdHocEventService.getActiveState.mockReturnValue(undefined);

      handler(
        { channelId: null, id: 'user-1' },
        {
          channelId: 'voice-ch',
          id: 'user-1',
          member: {
            displayName: 'Player1',
            user: { username: 'Player1', avatar: null },
          },
        },
      );
      await jest.advanceTimersByTimeAsync(2100);

      handler(
        { channelId: null, id: 'user-2' },
        {
          channelId: 'voice-ch',
          id: 'user-2',
          member: {
            displayName: 'Player2',
            user: { username: 'Player2', avatar: null },
          },
        },
      );
      await jest.advanceTimersByTimeAsync(2100);

      // Timer is pending — disconnect clears it
      listener.onBotDisconnected();

      // Advance past the delay — no spawn should fire (timer was cleared)
      await jest.advanceTimersByTimeAsync(SPAWN_DELAY_MS + 100);

      expect(mockAdHocEventService.handleVoiceJoin).not.toHaveBeenCalled();
    });

    it('falls back to delayed spawn when shouldSpawnImmediately cannot get client', async () => {
      const handler = await setupWithBinding('voice-ch', gameBinding);

      mockAdHocEventService.getActiveState.mockReturnValue(undefined);

      handler(
        { channelId: null, id: 'user-1' },
        {
          channelId: 'voice-ch',
          id: 'user-1',
          member: {
            displayName: 'Player1',
            user: { username: 'Player1', avatar: null },
          },
        },
      );
      await jest.advanceTimersByTimeAsync(2100);

      // Null out the client BEFORE second join so shouldSpawnImmediately returns false
      mockClientService.getClient.mockReturnValue(null);

      handler(
        { channelId: null, id: 'user-2' },
        {
          channelId: 'voice-ch',
          id: 'user-2',
          member: {
            displayName: 'Player2',
            user: { username: 'Player2', avatar: null },
          },
        },
      );
      await jest.advanceTimersByTimeAsync(2100);

      // No immediate spawn
      expect(mockAdHocEventService.handleVoiceJoin).not.toHaveBeenCalled();

      // After delay, client still null → group roster also cannot run → no spawn
      await jest.advanceTimersByTimeAsync(SPAWN_DELAY_MS + 100);
      expect(mockAdHocEventService.handleVoiceJoin).not.toHaveBeenCalled();
    });
  });

  // ─── AC6: Game-specific binding — filtered threshold logic ─────────────────

  describe('AC6: game-specific binding — different-game members excluded from threshold', () => {
    it('excludes members playing a different game from threshold count', async () => {
      // 2 members in channel, minPlayers=2, but one plays a different game
      // → only 1 counted member → below threshold → no spawn at all
      const handler = await setupWithBinding('voice-ch', gameBinding);

      // user-1 plays the bound game, user-2 plays a different game
      mockPresenceDetector.detectGameForMember.mockImplementation(
        async (member: { id: string }) => {
          if (member.id === 'user-1') return { gameId: 1, gameName: 'Rise of Kingdoms' };
          return { gameId: 99, gameName: 'Completely Different Game' };
        },
      );
      mockAdHocEventService.getActiveState.mockReturnValue(undefined);

      handler(
        { channelId: null, id: 'user-1' },
        {
          channelId: 'voice-ch',
          id: 'user-1',
          member: {
            displayName: 'Player1',
            user: { username: 'Player1', avatar: null },
          },
        },
      );
      await jest.advanceTimersByTimeAsync(2100);

      handler(
        { channelId: null, id: 'user-2' },
        {
          channelId: 'voice-ch',
          id: 'user-2',
          member: {
            displayName: 'Player2',
            user: { username: 'Player2', avatar: null },
          },
        },
      );
      await jest.advanceTimersByTimeAsync(2100);

      // No immediate spawn — filtered count is 1 (below minPlayers=2)
      expect(mockAdHocEventService.handleVoiceJoin).not.toHaveBeenCalled();

      // No delayed spawn either — threshold was never met
      await jest.advanceTimersByTimeAsync(SPAWN_DELAY_MS + 100);
      expect(mockAdHocEventService.handleVoiceJoin).not.toHaveBeenCalled();
    });

    it('counts no-game members toward threshold but triggers delayed path', async () => {
      // 2 members, both have no game detected → counted=2, allConfirmed=false → delayed
      const handler = await setupWithBinding('voice-ch', gameBinding);

      mockPresenceDetector.detectGameForMember.mockResolvedValue({
        gameId: null,
        gameName: 'Untitled Gaming Session',
      });
      mockAdHocEventService.getActiveState.mockReturnValue(undefined);

      handler(
        { channelId: null, id: 'user-1' },
        {
          channelId: 'voice-ch',
          id: 'user-1',
          member: {
            displayName: 'Player1',
            user: { username: 'Player1', avatar: null },
          },
        },
      );
      await jest.advanceTimersByTimeAsync(2100);

      handler(
        { channelId: null, id: 'user-2' },
        {
          channelId: 'voice-ch',
          id: 'user-2',
          member: {
            displayName: 'Player2',
            user: { username: 'Player2', avatar: null },
          },
        },
      );
      await jest.advanceTimersByTimeAsync(2100);

      // No immediate spawn — no-game members trigger delay
      expect(mockAdHocEventService.handleVoiceJoin).not.toHaveBeenCalled();

      // Spawns after 15-min delay
      await jest.advanceTimersByTimeAsync(SPAWN_DELAY_MS + 100);
      expect(mockAdHocEventService.handleVoiceJoin).toHaveBeenCalled();
    });

    it('spawns immediately when 2 play bound game + 1 plays different game (minPlayers=2)', async () => {
      // 3 members: user-1 and user-2 play bound game, user-3 plays a different game
      // Filtered count: 2 (user-1 + user-2), allConfirmed=true → immediate spawn
      const handler = await setupWithBinding('voice-ch', gameBinding, [
        { id: 'user-1', displayName: 'Player1' },
        { id: 'user-2', displayName: 'Player2' },
        { id: 'user-3', displayName: 'Player3' },
      ]);

      mockPresenceDetector.detectGameForMember.mockImplementation(
        async (member: { id: string }) => {
          if (member.id === 'user-3') return { gameId: 99, gameName: 'Other Game' };
          return { gameId: 1, gameName: 'Rise of Kingdoms' };
        },
      );
      mockAdHocEventService.getActiveState.mockReturnValue(undefined);

      handler(
        { channelId: null, id: 'user-1' },
        {
          channelId: 'voice-ch',
          id: 'user-1',
          member: {
            displayName: 'Player1',
            user: { username: 'Player1', avatar: null },
          },
        },
      );
      await jest.advanceTimersByTimeAsync(2100);

      handler(
        { channelId: null, id: 'user-2' },
        {
          channelId: 'voice-ch',
          id: 'user-2',
          member: {
            displayName: 'Player2',
            user: { username: 'Player2', avatar: null },
          },
        },
      );
      await jest.advanceTimersByTimeAsync(2100);

      handler(
        { channelId: null, id: 'user-3' },
        {
          channelId: 'voice-ch',
          id: 'user-3',
          member: {
            displayName: 'Player3',
            user: { username: 'Player3', avatar: null },
          },
        },
      );
      await jest.advanceTimersByTimeAsync(2100);

      // Different-game player excluded → 2 confirmed bound-game players → immediate
      expect(mockAdHocEventService.handleVoiceJoin).toHaveBeenCalled();
    });

    it('delays spawn when 1 plays bound game + 1 has no game (minPlayers=2)', async () => {
      // user-1 plays bound game, user-2 has no game → counted=2, allConfirmed=false → delayed
      const handler = await setupWithBinding('voice-ch', gameBinding);

      mockPresenceDetector.detectGameForMember.mockImplementation(
        async (member: { id: string }) => {
          if (member.id === 'user-1') return { gameId: 1, gameName: 'Rise of Kingdoms' };
          return { gameId: null, gameName: 'Untitled Gaming Session' };
        },
      );
      mockAdHocEventService.getActiveState.mockReturnValue(undefined);

      handler(
        { channelId: null, id: 'user-1' },
        {
          channelId: 'voice-ch',
          id: 'user-1',
          member: {
            displayName: 'Player1',
            user: { username: 'Player1', avatar: null },
          },
        },
      );
      await jest.advanceTimersByTimeAsync(2100);

      handler(
        { channelId: null, id: 'user-2' },
        {
          channelId: 'voice-ch',
          id: 'user-2',
          member: {
            displayName: 'Player2',
            user: { username: 'Player2', avatar: null },
          },
        },
      );
      await jest.advanceTimersByTimeAsync(2100);

      // No immediate spawn — no-game member triggers delay
      expect(mockAdHocEventService.handleVoiceJoin).not.toHaveBeenCalled();

      // Spawns after delay
      await jest.advanceTimersByTimeAsync(SPAWN_DELAY_MS + 100);
      expect(mockAdHocEventService.handleVoiceJoin).toHaveBeenCalled();
    });
  });

  // ─── General-lobby binding: game activity constraints ─────────────────────

  describe('general-lobby binding: game activity spawn constraints', () => {
    const lobbyBinding = {
      id: 'bind-lobby',
      channelId: 'lobby-ch',
      bindingPurpose: 'general-lobby' as const,
      gameId: null,
      gameName: null,
      config: { minPlayers: 2 },
    };

    it('spawns immediately in general-lobby when all members share the same game', async () => {
      const handler = await setupWithBinding('lobby-ch', lobbyBinding);

      // Both playing the same game (gameId=5) → unanimous
      mockPresenceDetector.detectGameForMember.mockResolvedValue({
        gameId: 5,
        gameName: 'Valorant',
      });
      mockPresenceDetector.detectGames.mockResolvedValue([
        { gameId: 5, gameName: 'Valorant', memberIds: ['user-1', 'user-2'] },
      ]);
      mockAdHocEventService.getActiveState.mockReturnValue(undefined);

      handler(
        { channelId: null, id: 'user-1' },
        {
          channelId: 'lobby-ch',
          id: 'user-1',
          member: {
            id: 'user-1',
            displayName: 'Player1',
            user: { username: 'Player1', avatar: null },
          },
        },
      );
      await jest.advanceTimersByTimeAsync(2100);

      handler(
        { channelId: null, id: 'user-2' },
        {
          channelId: 'lobby-ch',
          id: 'user-2',
          member: {
            id: 'user-2',
            displayName: 'Player2',
            user: { username: 'Player2', avatar: null },
          },
        },
      );
      await jest.advanceTimersByTimeAsync(2100);

      // Unanimous game — should spawn immediately
      expect(mockAdHocEventService.handleVoiceJoin).toHaveBeenCalled();
    });

    it('uses delayed spawn in general-lobby when members play different games', async () => {
      const handler = await setupWithBinding('lobby-ch', lobbyBinding);

      // Different games → not unanimous
      mockPresenceDetector.detectGameForMember
        .mockResolvedValueOnce({ gameId: 5, gameName: 'Valorant' })
        .mockResolvedValueOnce({ gameId: 6, gameName: 'Minecraft' });

      mockPresenceDetector.detectGames.mockResolvedValue([
        { gameId: 5, gameName: 'Valorant', memberIds: ['user-1'] },
        { gameId: 6, gameName: 'Minecraft', memberIds: ['user-2'] },
      ]);

      mockAdHocEventService.getActiveState.mockReturnValue(undefined);

      handler(
        { channelId: null, id: 'user-1' },
        {
          channelId: 'lobby-ch',
          id: 'user-1',
          member: {
            id: 'user-1',
            displayName: 'Player1',
            user: { username: 'Player1', avatar: null },
          },
        },
      );
      await jest.advanceTimersByTimeAsync(2100);

      handler(
        { channelId: null, id: 'user-2' },
        {
          channelId: 'lobby-ch',
          id: 'user-2',
          member: {
            id: 'user-2',
            displayName: 'Player2',
            user: { username: 'Player2', avatar: null },
          },
        },
      );
      await jest.advanceTimersByTimeAsync(2100);

      // No immediate spawn
      expect(mockAdHocEventService.handleVoiceJoin).not.toHaveBeenCalled();

      // After 15 minutes, the delayed spawn fires
      await jest.advanceTimersByTimeAsync(SPAWN_DELAY_MS + 100);
      expect(mockAdHocEventService.handleVoiceJoin).toHaveBeenCalled();
    });

    it('cancels general-lobby delayed spawn when player count drops below threshold', async () => {
      const handler = await setupWithBinding('lobby-ch', lobbyBinding);

      // Different games → delayed spawn
      mockPresenceDetector.detectGameForMember
        .mockResolvedValueOnce({ gameId: 5, gameName: 'Valorant' })
        .mockResolvedValueOnce({ gameId: 6, gameName: 'Minecraft' });

      mockAdHocEventService.getActiveState.mockReturnValue(undefined);

      handler(
        { channelId: null, id: 'user-1' },
        {
          channelId: 'lobby-ch',
          id: 'user-1',
          member: {
            id: 'user-1',
            displayName: 'Player1',
            user: { username: 'Player1', avatar: null },
          },
        },
      );
      await jest.advanceTimersByTimeAsync(2100);

      handler(
        { channelId: null, id: 'user-2' },
        {
          channelId: 'lobby-ch',
          id: 'user-2',
          member: {
            id: 'user-2',
            displayName: 'Player2',
            user: { username: 'Player2', avatar: null },
          },
        },
      );
      await jest.advanceTimersByTimeAsync(2100);

      // Not yet spawned
      expect(mockAdHocEventService.handleVoiceJoin).not.toHaveBeenCalled();

      // Player leaves — drop below threshold → cancel timer
      handler(
        { channelId: 'lobby-ch', id: 'user-2' },
        { channelId: null, id: 'user-2', member: null },
      );
      await jest.advanceTimersByTimeAsync(2100);

      // Advance 15 minutes — timer was cancelled
      await jest.advanceTimersByTimeAsync(SPAWN_DELAY_MS + 100);
      expect(mockAdHocEventService.handleVoiceJoin).not.toHaveBeenCalled();
    });
  });
});
