/**
 * Shared test helpers for voice-state general-lobby spec files.
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
import { Collection } from 'discord.js';

/** Create a typed discord.js Collection from entries. */
export function makeCollection<K, V>(entries: [K, V][] = []): Collection<K, V> {
  const col = new Collection<K, V>();
  for (const [key, val] of entries) {
    col.set(key, val);
  }
  return col;
}

export interface GeneralLobbyMocks {
  clientService: { getClient: jest.Mock; getGuildId: jest.Mock };
  adHocEventService: {
    handleVoiceJoin: jest.Mock;
    handleVoiceLeave: jest.Mock;
    getActiveState: jest.Mock;
    hasAnyActiveEvent: jest.Mock;
  };
  channelBindingsService: {
    getBindings: jest.Mock;
    getBindingsWithGameNames: jest.Mock;
  };
  presenceDetector: {
    detectGameForMember: jest.Mock;
    detectGames: jest.Mock;
  };
  usersService: { findByDiscordId: jest.Mock };
}

/** Create a mock Discord client with optional guild channels. */
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
    guilds: { cache: makeCollection([['guild-1', guild]]) },
  };
}

/** Create default general lobby mock objects. */
export function createGeneralLobbyMocks(): GeneralLobbyMocks {
  return {
    clientService: {
      getClient: jest.fn(),
      getGuildId: jest.fn().mockReturnValue('guild-1'),
    },
    adHocEventService: {
      handleVoiceJoin: jest.fn().mockResolvedValue(undefined),
      handleVoiceLeave: jest.fn().mockResolvedValue(undefined),
      getActiveState: jest.fn().mockReturnValue(undefined),
      hasAnyActiveEvent: jest.fn().mockReturnValue(false),
    },
    channelBindingsService: {
      getBindings: jest.fn().mockResolvedValue([]),
      getBindingsWithGameNames: jest.fn().mockResolvedValue([]),
    },
    presenceDetector: {
      detectGameForMember: jest.fn().mockResolvedValue({
        gameId: null,
        gameName: 'Untitled Gaming Session',
      }),
      detectGames: jest.fn().mockResolvedValue([]),
    },
    usersService: { findByDiscordId: jest.fn().mockResolvedValue(null) },
  };
}

/** Build the providers array for general lobby test module. */
function buildLobbyProvidersA(mocks: GeneralLobbyMocks) {
  return [
    VoiceStateListener,
    { provide: DiscordBotClientService, useValue: mocks.clientService },
    { provide: AdHocEventService, useValue: mocks.adHocEventService },
    {
      provide: VoiceAttendanceService,
      useValue: {
        findActiveScheduledEvents: jest.fn().mockResolvedValue([]),
        handleJoin: jest.fn(),
        handleLeave: jest.fn(),
        getActiveRoster: jest
          .fn()
          .mockReturnValue({ eventId: 0, participants: [], activeCount: 0 }),
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

function buildLobbyProvidersB(mocks: GeneralLobbyMocks) {
  return [
    { provide: ChannelBindingsService, useValue: mocks.channelBindingsService },
    { provide: PresenceGameDetectorService, useValue: mocks.presenceDetector },
    {
      provide: GameActivityService,
      useValue: { bufferStart: jest.fn(), bufferStop: jest.fn() },
    },
    { provide: UsersService, useValue: mocks.usersService },
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

function buildLobbyProviders(mocks: GeneralLobbyMocks) {
  return [...buildLobbyProvidersA(mocks), ...buildLobbyProvidersB(mocks)];
}

/** Set up the test module and return listener + mocks. */
export async function setupGeneralLobbyTestModule(): Promise<{
  listener: VoiceStateListener;
  mocks: GeneralLobbyMocks;
}> {
  const mocks = createGeneralLobbyMocks();
  const module: TestingModule = await Test.createTestingModule({
    providers: buildLobbyProviders(mocks),
  }).compile();

  return { listener: module.get(VoiceStateListener), mocks };
}
