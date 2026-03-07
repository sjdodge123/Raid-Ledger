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

describe('VoiceStateListener — ROK-697 game activity spawn constraints — spawn', () => {
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

  function buildProvidersCore() {
    return [
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
    ];
  }

  function buildProviders() {
    return [...buildProvidersCore(), ...buildProvidersMocks()];
  }
  async function setupBlock() {
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
      providers: buildProviders(),
    }).compile();

    listener = module.get(VoiceStateListener);
  }

  beforeEach(async () => {
    await setupBlock();
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
    async function testSpawnseventimmediatelywhenallmembersaredetected() {
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
    }

    it('spawns event immediately when all members are detected playing the binding game', async () => {
      await testSpawnseventimmediatelywhenallmembersaredetected();
    });

    async function testDoesnotstartadelayedspawntimerwhen() {
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
    }

    it('does NOT start a delayed spawn timer when game activity is unanimous', async () => {
      await testDoesnotstartadelayedspawntimerwhen();
    });
  });

  // ─── AC2: Delayed spawn — no unanimous game activity ──────────────────────

  describe('AC2: delayed spawn — threshold met but no unanimous game activity (game-specific binding)', () => {
    async function testDoesnotspawnimmediatelywhennogameactivity() {
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
    }

    it('does NOT spawn immediately when no game activity is detected', async () => {
      await testDoesnotspawnimmediatelywhennogameactivity();
    });

    async function testSpawnseventafter15minutedelaywhennounanimous() {
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
    }

    it('spawns event after 15-minute delay when no unanimous game activity', async () => {
      await testSpawnseventafter15minutedelaywhennounanimous();
    });

    async function testDoesnotspawnimmediatelywhenplayersareplaying() {
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
    }

    it('does NOT spawn immediately when players are playing DIFFERENT games', async () => {
      await testDoesnotspawnimmediatelywhenplayersareplaying();
    });
  });

  // ─── AC3: Timer cancels on player count drop ───────────────────────────────

  describe('AC3: timer resets/cancels when count drops below threshold', () => {
    async function testCancelspendingspawntimerwhenaplayerleaves() {
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
    }

    it('cancels pending spawn timer when a player leaves and drops below threshold', async () => {
      await testCancelspendingspawntimerwhenaplayerleaves();
    });

    async function testDoesnotfirespawnafter15minuteswhen() {
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
    }

    it('does NOT fire spawn after 15 minutes when all players leave during the wait', async () => {
      await testDoesnotfirespawnafter15minuteswhen();
    });
  });

  // ─── AC4: Existing bound channel detection still applies ──────────────────

  describe('AC4: unbound channels do not trigger quick play or game activity checks', () => {
    async function testDoesnottriggergameactivitycheckorspawn() {
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
    }

    it('does not trigger game activity check or spawn for unbound channels', async () => {
      await testDoesnottriggergameactivitycheckorspawn();
    });
  });

  // ─── AC5: Game activity from presence data ────────────────────────────────

  describe('AC5: game activity is read from Discord presence data (detectGameForMember)', () => {
    async function testCallsdetectgameformembertodecidespawnpathandspawns() {
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
    }

    it('calls detectGameForMember to decide spawn path and spawns immediately when unanimous', async () => {
      await testCallsdetectgameformembertodecidespawnpathandspawns();
    });

    async function testRoutestodelayedpathwhendetectgameformemberreturnsnull() {
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
    }

    it('routes to delayed path when detectGameForMember returns null for any member', async () => {
      await testRoutestodelayedpathwhendetectgameformemberreturnsnull();
    });
  });

  // ─── Edge cases ────────────────────────────────────────────────────────────
});
