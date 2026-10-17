/**
 * Shared, non-mock harness for the ChannelPresenceEmbedService specs (ROK-1446
 * flush loop, restart adoption and close ladder; ROK-1498 rejoin after grace).
 *
 * The `jest.mock` blocks are NOT here and cannot be: `jest.mock` hoists per
 * spec file, so each spec declares its own boundary mocks and then imports this
 * module. The imports below therefore resolve to that spec's mocks, which is
 * what `mocked` wraps. See `channel-presence-embed.service.spec.ts` for why only
 * the boundary is mocked and the render runs for real.
 */
import type { Logger } from '@nestjs/common';
import { DiscordAPIError } from 'discord.js';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import { ChannelPresenceEmbedService } from './channel-presence-embed.service';
import type { EmbedContext, EmbedEventData } from './discord-embed.factory';
import type { ResolvedRoom, RoomGroup } from './channel-presence-room.helpers';
import type { PresenceRow } from './channel-presence-store.helpers';
import {
  findLinkedEvents,
  recapEvents,
  resolveRoom,
} from './channel-presence-room.helpers';
import {
  editEmbeds,
  fetchMessageOrNull,
  sendEmbeds,
} from '../discord-bot-client.messages.helpers';
import {
  buildContext,
  buildEmbedEventData,
  resolveNotificationChannel,
} from './ad-hoc-notification.helpers';
import {
  clearEmpty,
  closeRow,
  findOpenRow,
  listOpenRows,
  markEmpty,
  openRow,
  savePayloadHash,
} from './channel-presence-store.helpers';

export const mocked = {
  resolveRoom: jest.mocked(resolveRoom),
  findLinkedEvents: jest.mocked(findLinkedEvents),
  recapEvents: jest.mocked(recapEvents),
  sendEmbeds: jest.mocked(sendEmbeds),
  editEmbeds: jest.mocked(editEmbeds),
  fetchMessageOrNull: jest.mocked(fetchMessageOrNull),
  buildContext: jest.mocked(buildContext),
  resolveNotificationChannel: jest.mocked(resolveNotificationChannel),
  buildEmbedEventData: jest.mocked(buildEmbedEventData),
  findOpenRow: jest.mocked(findOpenRow),
  openRow: jest.mocked(openRow),
  markEmpty: jest.mocked(markEmpty),
  clearEmpty: jest.mocked(clearEmpty),
  closeRow: jest.mocked(closeRow),
  savePayloadHash: jest.mocked(savePayloadHash),
  listOpenRows: jest.mocked(listOpenRows),
};

export const ANA = { displayName: 'ana', gameId: null, activityName: null };
export const GUILD = 'g-1';
export const VOICE = 'vc-1';
export const TEXT = 'tc-1';
export const MESSAGE = 'msg-1';
export const BINDING = 'b-1';
export const NOW = Date.parse('2026-09-02T18:00:00Z');
export const OPENED_AT = new Date('2026-09-02T17:30:00Z');

export const CONTEXT: EmbedContext = {
  communityName: 'Gamer Saloon',
  clientUrl: 'https://rl.example',
  timezone: 'UTC',
};

/**
 * Discord's "Unknown Message". Built via the prototype because the transport's
 * predicate is `instanceof DiscordAPIError`, not a duck-typed `code` read.
 */
export function unknownMessage(): DiscordAPIError {
  return Object.assign(Object.create(DiscordAPIError.prototype) as object, {
    code: 10008,
    message: 'Unknown Message',
  }) as DiscordAPIError;
}

/** A group below `minPlayers` with no event — the amber render. */
export function short(gameName: string, names: string[]): RoomGroup {
  return {
    gameId: 7,
    gameName,
    memberIds: names.map((n) => `u-${n}`),
    memberNames: names,
    qualifying: false,
    eventId: null,
    eventData: null,
    game: null,
  };
}

export function room(overrides: Partial<ResolvedRoom> = {}): ResolvedRoom & {
  channelResolved: boolean;
  members: NonNullable<ResolvedRoom['members']>;
} {
  return {
    channelId: VOICE,
    channelName: 'General',
    memberCount: 2,
    minPlayers: 3,
    groups: [short('Valheim', ['ana', 'bo'])],
    undetectedNames: [],
    members: new Map([['ana', ANA]]),
    channelResolved: true,
    ...overrides,
  };
}

export function presenceRow(overrides: Partial<PresenceRow> = {}): PresenceRow {
  return {
    id: 'row-1',
    guildId: GUILD,
    voiceChannelId: VOICE,
    bindingId: BINDING,
    textChannelId: TEXT,
    messageId: MESSAGE,
    status: 'open',
    payloadHash: null,
    openedAt: OPENED_AT,
    emptySince: null,
    closedAt: null,
    closeReason: null,
    createdAt: OPENED_AT,
    updatedAt: OPENED_AT,
    ...overrides,
  };
}

export function eventData(id: number): EmbedEventData {
  return {
    id,
    title: 'Valheim — Quick Play',
    startTime: '2026-09-02T17:00:00Z',
    endTime: '2026-09-02T19:00:00Z',
    signupCount: 2,
    signupMentions: [
      {
        displayName: 'ana',
        role: null,
        preferredRoles: null,
        status: 'confirmed',
      },
      {
        displayName: 'bo',
        role: null,
        preferredRoles: null,
        status: 'confirmed',
      },
    ],
    game: { id: 7, name: 'Valheim' },
  };
}

/** Only the two calls the flush actually issues against the DB directly. */
export function fakeDb(): PostgresJsDatabase<typeof schema> {
  return {
    select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }),
  } as unknown as PostgresJsDatabase<typeof schema>;
}

export interface Harness {
  service: ChannelPresenceEmbedService;
  getBindingById: jest.Mock;
  getBindingsWithGameNames: jest.Mock;
  clientService: { getClient: jest.Mock; getGuildId: jest.Mock };
}

/**
 * Watch the service's own logger.
 *
 * Reaching for the private field is deliberate: the whole point of the S-4
 * `.catch()` is that the rejection is HANDLED, and "handled" is only
 * observable as this log line.
 */
export function loggerErrors(
  service: ChannelPresenceEmbedService,
): jest.SpyInstance {
  const { logger } = service as unknown as { logger: Logger };
  return jest.spyOn(logger, 'error').mockImplementation(() => undefined);
}

/** The same reach for the private logger, for the lines warn-level carries. */
export function loggerWarnings(
  service: ChannelPresenceEmbedService,
): jest.SpyInstance {
  const { logger } = service as unknown as { logger: Logger };
  return jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
}

export function lobbyBindingRecord(): Record<string, unknown> {
  return {
    id: BINDING,
    channelId: VOICE,
    gameId: null,
    gameName: null,
    bindingPurpose: 'general-lobby',
    recurrenceGroupId: null,
    config: { minPlayers: 3, gracePeriod: 5 },
  };
}

export function build(
  bindings: Record<string, unknown>[] = [lobbyBindingRecord()],
): Harness {
  const getBindingsWithGameNames = jest.fn().mockResolvedValue(bindings);
  const getBindingById = jest.fn().mockResolvedValue(bindings[0] ?? null);
  const clientService = {
    // A shape `resolveVoiceChannel` can actually walk: the unbound close path
    // now asks Discord for the channel's name instead of hard-coding null.
    getClient: jest.fn().mockReturnValue({ guilds: { cache: new Map() } }),
    getGuildId: jest.fn().mockReturnValue(GUILD),
  };
  const service = new ChannelPresenceEmbedService(
    fakeDb(),
    clientService as never,
    {} as never,
    { getBindingsWithGameNames, getBindingById } as never,
    {} as never,
    {} as never,
    { executeWithTracking: jest.fn() } as never,
  );
  return { service, getBindingById, getBindingsWithGameNames, clientService };
}

/** A service that has already adopted its open rows, so flushes may post. */
export async function ready(
  bindings?: Record<string, unknown>[],
): Promise<Harness> {
  const harness = build(bindings);
  mocked.listOpenRows.mockResolvedValue([]);
  await harness.service.recover();
  return harness;
}

/** The per-test reset every spec built on this harness installs at top level. */
export function installPresenceHooks(): void {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
    mocked.buildContext.mockResolvedValue(CONTEXT);
    mocked.resolveNotificationChannel.mockResolvedValue(TEXT);
    mocked.resolveRoom.mockResolvedValue(room());
    mocked.findLinkedEvents.mockResolvedValue([]);
    mocked.recapEvents.mockResolvedValue([]);
    mocked.listOpenRows.mockResolvedValue([]);
    mocked.findOpenRow.mockResolvedValue(null);
    mocked.buildEmbedEventData.mockResolvedValue(eventData(900));
    mocked.sendEmbeds.mockResolvedValue({ id: MESSAGE } as never);
    mocked.editEmbeds.mockResolvedValue({ id: MESSAGE } as never);
    mocked.openRow.mockImplementation((_db, input) =>
      Promise.resolve({
        row: presenceRow({ messageId: input.messageId }),
        created: true,
      }),
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });
}
