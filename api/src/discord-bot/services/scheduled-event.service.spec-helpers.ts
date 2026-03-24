import { Test, TestingModule } from '@nestjs/testing';
import { GuildScheduledEventStatus, DiscordAPIError } from 'discord.js';
import { ScheduledEventService } from './scheduled-event.service';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { ChannelResolverService } from './channel-resolver.service';
import { SettingsService } from '../../settings/settings.service';
import { CronJobService } from '../../cron-jobs/cron-job.service';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import type { ScheduledEventData } from './scheduled-event.service';

/** Build a DiscordAPIError mock that satisfies `instanceof DiscordAPIError` checks. */
export function makeDiscordApiError(
  code: number,
  message = 'Discord API error',
): DiscordAPIError {
  const err = Object.create(DiscordAPIError.prototype) as DiscordAPIError;
  Object.defineProperty(err, 'code', {
    value: code,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(err, 'message', {
    value: message,
    writable: true,
    configurable: true,
  });
  return err;
}

export const FUTURE = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
export const FUTURE_END = new Date(FUTURE.getTime() + 3 * 60 * 60 * 1000);
export const PAST = new Date(Date.now() - 1000);

export const baseEventData: ScheduledEventData = {
  title: 'Raid Night',
  description: 'Come raid with us!',
  startTime: FUTURE.toISOString(),
  endTime: FUTURE_END.toISOString(),
  signupCount: 5,
  maxAttendees: 25,
  game: { name: 'World of Warcraft' },
};

/** Shared mock types for scheduled event service tests. */
export interface ScheduledEventMocks {
  service: ScheduledEventService;
  clientService: jest.Mocked<DiscordBotClientService>;
  channelResolver: jest.Mocked<ChannelResolverService>;
  settingsService: jest.Mocked<SettingsService>;
  mockDb: { select: jest.Mock; update: jest.Mock };
  mockGuild: {
    scheduledEvents: {
      create: jest.Mock;
      edit: jest.Mock;
      delete: jest.Mock;
      fetch: jest.Mock;
    };
  };
  createSelectChain: (rows?: unknown[]) => Record<string, jest.Mock>;
  createUpdateChain: () => Record<string, jest.Mock>;
}

/** Helper to build a chainable Drizzle select mock (terminates at .limit()). */
export function createSelectChain(
  rows: unknown[] = [],
): Record<string, jest.Mock> {
  const chain: Record<string, jest.Mock> = {};
  chain.select = jest.fn().mockReturnValue(chain);
  chain.from = jest.fn().mockReturnValue(chain);
  chain.where = jest.fn().mockReturnValue(chain);
  chain.limit = jest.fn().mockResolvedValue(rows);
  return chain;
}

/** Helper to build a chainable Drizzle select mock (terminates at .where(), no .limit()). */
export function createSelectChainNoLimit(
  rows: unknown[] = [],
): Record<string, jest.Mock> {
  const chain: Record<string, jest.Mock> = {};
  chain.select = jest.fn().mockReturnValue(chain);
  chain.from = jest.fn().mockReturnValue(chain);
  chain.where = jest.fn().mockResolvedValue(rows);
  return chain;
}

/** Helper to build a chainable Drizzle update mock. */
export function createUpdateChain(): Record<string, jest.Mock> {
  const chain: Record<string, jest.Mock> = {};
  chain.set = jest.fn().mockReturnValue(chain);
  chain.where = jest.fn().mockResolvedValue(undefined);
  return chain;
}

/** Create the mock guild with scheduled event operations. */
export function createMockGuild() {
  return {
    scheduledEvents: {
      create: jest.fn().mockResolvedValue({ id: 'discord-se-id-1' }),
      edit: jest.fn().mockResolvedValue({ id: 'discord-se-id-1' }),
      delete: jest.fn().mockResolvedValue(undefined),
      fetch: jest.fn().mockResolvedValue({
        id: 'discord-se-id-1',
        status: GuildScheduledEventStatus.Active,
        setStatus: jest.fn().mockResolvedValue(undefined),
      }),
    },
  };
}

/** Build providers array for scheduled event test module. */
function buildScheduledEventProviders(
  mockDb: Record<string, jest.Mock>,
  mockGuild: ReturnType<typeof createMockGuild>,
) {
  return [
    ScheduledEventService,
    { provide: DrizzleAsyncProvider, useValue: mockDb },
    {
      provide: DiscordBotClientService,
      useValue: {
        isConnected: jest.fn().mockReturnValue(true),
        getGuild: jest.fn().mockReturnValue(mockGuild),
      },
    },
    {
      provide: ChannelResolverService,
      useValue: {
        resolveVoiceChannelForScheduledEvent: jest
          .fn()
          .mockResolvedValue('voice-channel-123'),
      },
    },
    {
      provide: SettingsService,
      useValue: {
        getClientUrl: jest.fn().mockResolvedValue('https://raidledger.app'),
      },
    },
    {
      provide: CronJobService,
      useValue: {
        executeWithTracking: jest
          .fn()
          .mockImplementation((_n: string, fn: () => Promise<void>) => fn()),
      },
    },
  ];
}

/**
 * Optional mocks to inject into the service after module creation.
 *
 * NestJS @Optional() with union types (e.g. `ActiveEventCacheService | null`)
 * causes TypeScript to emit `Object` as the design type, preventing automatic
 * token resolution. We work around this by setting the private field directly
 * after module creation -- matching how production DI wires it.
 */
export interface OptionalMocks {
  eventCache?: { getRecentlyEndedEvents: jest.Mock };
  embedSyncQueue?: { enqueue: jest.Mock };
}

/** Set up the shared test module and return all mocks. */
export async function setupScheduledEventTestModule(
  optionalMocks?: OptionalMocks,
): Promise<ScheduledEventMocks> {
  const mockGuild = createMockGuild();
  const selectChain = createSelectChain();
  const updateChain = createUpdateChain();
  const mockDb = {
    select: jest.fn().mockReturnValue(selectChain),
    update: jest.fn().mockReturnValue(updateChain),
  };

  const module: TestingModule = await Test.createTestingModule({
    providers: buildScheduledEventProviders(mockDb, mockGuild),
  }).compile();

  const service = module.get(ScheduledEventService);
  if (optionalMocks?.eventCache) {
    (service as any).eventCache = optionalMocks.eventCache;
  }
  if (optionalMocks?.embedSyncQueue) {
    (service as any).embedSyncQueue = optionalMocks.embedSyncQueue;
  }

  return {
    service,
    clientService: module.get(DiscordBotClientService),
    channelResolver: module.get(ChannelResolverService),
    settingsService: module.get(SettingsService),
    mockDb,
    mockGuild,
    createSelectChain,
    createUpdateChain,
  };
}
