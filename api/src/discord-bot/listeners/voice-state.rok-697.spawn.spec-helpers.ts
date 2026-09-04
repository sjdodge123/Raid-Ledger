/**
 * Shared test-module harness for the ROK-697 spawn-constraint spec.
 *
 * Extracted verbatim from voice-state.rok-697.spawn.spec.ts when the ROK-1415
 * tolerance describe pushed that file past the 750-line spec cap (TESTING.md
 * split pattern: shared setup moves to `{name}.spec-helpers.ts`). No behaviour
 * change — the spec re-assembles the exact same TestingModule per test.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { Collection } from 'discord.js';
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
import { ChannelPresenceEmbedService } from '../services/channel-presence-embed.service';

export function makeCollection<K, V>(entries: [K, V][] = []): Collection<K, V> {
  const col = new Collection<K, V>();
  for (const [key, val] of entries) {
    col.set(key, val);
  }
  return col;
}

export function createVoiceChannel(
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

export function createMockClient(
  guildChannels: Map<string, unknown> = new Map(),
) {
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

export interface SpawnSpecHarness {
  listener: VoiceStateListener;
  mockClientService: { getClient: jest.Mock; getGuildId: jest.Mock };
  mockAdHocEventService: {
    handleVoiceJoin: jest.Mock;
    handleVoiceLeave: jest.Mock;
    getActiveState: jest.Mock;
    getActiveBindingEventGameId: jest.Mock;
    trySuppressForScheduled: jest.Mock;
  };
  mockChannelBindingsService: {
    getBindings: jest.Mock;
    getBindingsWithGameNames: jest.Mock;
  };
  mockPresenceDetector: {
    detectGameForMember: jest.Mock;
    detectGames: jest.Mock;
    setManualOverride: jest.Mock;
  };
  mockGameActivityService: { bufferStart: jest.Mock; bufferStop: jest.Mock };
  mockUsersService: { findByDiscordId: jest.Mock };
}

/** Build all mocks + the compiled listener exactly as the spec's old setupBlock did. */
export async function createSpawnTestModule(): Promise<SpawnSpecHarness> {
  const mockClientService = {
    getClient: jest.fn(),
    getGuildId: jest.fn().mockReturnValue('guild-1'),
  };
  const mockAdHocEventService = {
    // ROK-1417 P2 contract: resolves true when the join was actually
    // processed (joined/spawned), false when kill-switch/suppression gated it.
    handleVoiceJoin: jest.fn().mockResolvedValue(true),
    handleVoiceLeave: jest.fn().mockResolvedValue(undefined),
    getActiveState: jest.fn().mockReturnValue(undefined),
    getActiveBindingEventGameId: jest.fn().mockReturnValue(undefined),
    trySuppressForScheduled: jest.fn().mockResolvedValue(false),
  };
  const mockChannelBindingsService = {
    getBindings: jest.fn().mockResolvedValue([]),
    getBindingsWithGameNames: jest.fn().mockResolvedValue([]),
  };
  const mockPresenceDetector = {
    detectGameForMember: jest.fn().mockResolvedValue({
      gameId: null,
      gameName: 'Untitled Gaming Session',
    }),
    detectGames: jest.fn().mockResolvedValue([]),
    setManualOverride: jest.fn(),
  };
  const mockGameActivityService = {
    bufferStart: jest.fn(),
    bufferStop: jest.fn(),
  };
  const mockUsersService = {
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
      { provide: ChannelBindingsService, useValue: mockChannelBindingsService },
      { provide: PresenceGameDetectorService, useValue: mockPresenceDetector },
      { provide: GameActivityService, useValue: mockGameActivityService },
      { provide: UsersService, useValue: mockUsersService },
      {
        provide: AdHocEventsGateway,
        useValue: {
          emitRosterUpdate: jest.fn(),
          emitStatusChange: jest.fn(),
          emitEndTimeExtended: jest.fn(),
        },
      },
      {
        provide: ChannelPresenceEmbedService,
        useValue: {
          markDirty: jest.fn(),
          onEventEnded: jest.fn(),
          recover: jest.fn().mockResolvedValue(undefined),
          clear: jest.fn(),
        },
      },
    ],
  }).compile();

  return {
    listener: module.get(VoiceStateListener),
    mockClientService,
    mockAdHocEventService,
    mockChannelBindingsService,
    mockPresenceDetector,
    mockGameActivityService,
    mockUsersService,
  };
}

/** Fire a voice-join through the captured handler, then let debounce settle. */
export async function join(
  handler: (o: unknown, n: unknown) => void,
  channelId: string,
  userId: string,
): Promise<void> {
  handler(
    { channelId: null, id: userId },
    {
      channelId,
      id: userId,
      member: {
        displayName: userId,
        user: { username: userId, avatar: null },
      },
    },
  );
  await jest.advanceTimersByTimeAsync(2100);
}
