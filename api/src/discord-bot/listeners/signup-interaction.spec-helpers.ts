import { Test, TestingModule } from '@nestjs/testing';
import { SignupInteractionListener } from './signup-interaction.listener';

/** Test-friendly interface exposing private members needed by specs */
export interface TestableSignupInteractionListener {
  onBotConnected: () => void;
  onBotDisconnected: () => void;
  handleButtonInteraction: (interaction: unknown) => Promise<void>;
  handleSelectMenuInteraction: (interaction: unknown) => Promise<void>;
  boundHandler: ((interaction: unknown) => void) | null;
}
import { DiscordBotClientService } from '../discord-bot-client.service';
import { SignupsService } from '../../events/signups.service';
import { EventsService } from '../../events/events.service';
import { CharactersService } from '../../characters/characters.service';
import { IntentTokenService } from '../../auth/intent-token.service';
import { DiscordEmbedFactory } from '../services/discord-embed.factory';
import { DiscordEmojiService } from '../services/discord-emoji.service';
import { SettingsService } from '../../settings/settings.service';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder } from 'discord.js';

/** Shared mock types for signup interaction tests */
export interface SignupInteractionMocks {
  module: TestingModule;
  listener: TestableSignupInteractionListener;
  mockClientService: {
    getClient: jest.Mock;
    getGuildId: jest.Mock;
    editEmbed: jest.Mock;
  };
  mockSignupsService: {
    findByDiscordUser: jest.Mock;
    signup: jest.Mock;
    signupDiscord: jest.Mock;
    updateStatus: jest.Mock;
    getRoster: jest.Mock;
    cancel: jest.Mock;
    cancelByDiscordUser: jest.Mock;
    confirmSignup: jest.Mock;
  };
  mockEventsService: { buildEmbedEventData: jest.Mock };
  mockCharactersService: {
    findAllForUser: jest.Mock;
    findOne: jest.Mock;
  };
  mockIntentTokenService: { generate: jest.Mock };
  mockEmbedFactory: { buildEventEmbed: jest.Mock };
  mockSettingsService: {
    getBranding: jest.Mock;
    getDefaultTimezone: jest.Mock;
  };
  mockDb: Record<string, jest.Mock>;
  mockEmbed: EmbedBuilder;
  mockRow: ActionRowBuilder<ButtonBuilder>;
}

/** Create a minimal ButtonInteraction mock */
export function makeButtonInteraction(
  customId: string,
  userId: string = 'discord-user-123',
  username: string = 'TestUser',
  avatar: string | null = 'avatar-hash',
) {
  const interaction = {
    isButton: () => true,
    isStringSelectMenu: () => false,
    customId,
    user: { id: userId, username, avatar },
    replied: false,
    deferred: false,
    deferReply: jest.fn().mockImplementation(() => {
      interaction.deferred = true;
      return Promise.resolve(undefined);
    }),
    editReply: jest.fn().mockResolvedValue(undefined),
    reply: jest.fn().mockImplementation(() => {
      interaction.replied = true;
      return Promise.resolve(undefined);
    }),
  };
  return interaction;
}

/** Create a minimal StringSelectMenuInteraction mock */
export function makeSelectMenuInteraction(
  customId: string,
  values: string[],
  userId: string = 'discord-user-menu-1',
  username: string = 'TestUser',
) {
  return {
    isButton: () => false,
    isStringSelectMenu: () => true,
    customId,
    values,
    user: { id: userId, username, avatar: null },
    replied: false,
    deferred: false,
    deferUpdate: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(undefined),
  };
}

/** Default chain mock for DB queries returning empty */
export function makeChain(result: unknown[] = []) {
  const chain: Record<string, unknown> = {};
  chain.from = jest.fn().mockReturnValue(chain);
  chain.where = jest.fn().mockReturnValue(chain);
  chain.limit = jest.fn().mockResolvedValue(result);
  chain.leftJoin = jest.fn().mockReturnValue(chain);
  chain.groupBy = jest.fn().mockResolvedValue(result);
  // Make the chain itself awaitable (thenable)
  chain.then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
    Promise.resolve(result).then(resolve, reject);
  return chain;
}

/** Build the NestJS testing module with all mocked providers */
export async function createSignupInteractionTestModule(): Promise<SignupInteractionMocks> {
  const mockEmbed = new EmbedBuilder().setTitle('Test');
  const mockRow = new ActionRowBuilder<ButtonBuilder>();

  const mockClientService = {
    getClient: jest.fn().mockReturnValue(null),
    getGuildId: jest.fn().mockReturnValue('guild-123'),
    editEmbed: jest.fn().mockResolvedValue(undefined),
  };

  const mockSignupsService = {
    findByDiscordUser: jest.fn().mockResolvedValue(null),
    signup: jest.fn().mockResolvedValue({ id: 1, eventId: 1 }),
    signupDiscord: jest.fn().mockResolvedValue({ id: 2, eventId: 1 }),
    updateStatus: jest.fn().mockResolvedValue({ id: 1, status: 'signed_up' }),
    getRoster: jest
      .fn()
      .mockResolvedValue({ eventId: 1, signups: [], count: 0 }),
    cancel: jest.fn(),
    cancelByDiscordUser: jest.fn(),
    confirmSignup: jest.fn().mockResolvedValue({ id: 1 }),
  };

  const mockEventsService = {
    buildEmbedEventData: jest.fn().mockResolvedValue({
      id: 1,
      title: 'Test Event',
      startTime: '2026-02-20T20:00:00.000Z',
      endTime: '2026-02-20T23:00:00.000Z',
      signupCount: 0,
      maxAttendees: null,
      slotConfig: null,
      roleCounts: {},
      signupMentions: [],
      game: null,
    }),
  };

  const mockCharactersService = {
    findAllForUser: jest
      .fn()
      .mockResolvedValue({ data: [], meta: { total: 0 } }),
    findOne: jest.fn().mockResolvedValue({ id: 'char-1', name: 'Thrall' }),
  };

  const mockIntentTokenService = {
    generate: jest.fn().mockReturnValue('mock.intent.token'),
  };

  const mockEmbedFactory = {
    buildEventEmbed: jest
      .fn()
      .mockReturnValue({ embed: mockEmbed, row: mockRow }),
  };

  const mockSettingsService = {
    getBranding: jest.fn().mockResolvedValue({
      communityName: 'Test Guild',
      communityLogoPath: null,
    }),
    getDefaultTimezone: jest.fn().mockResolvedValue(null),
  };

  const mockDb: Record<string, jest.Mock> = {
    select: jest.fn().mockReturnValue(makeChain([])),
  };

  const module = await Test.createTestingModule({
    providers: [
      SignupInteractionListener,
      { provide: DrizzleAsyncProvider, useValue: mockDb },
      { provide: DiscordBotClientService, useValue: mockClientService },
      { provide: SignupsService, useValue: mockSignupsService },
      { provide: EventsService, useValue: mockEventsService },
      { provide: CharactersService, useValue: mockCharactersService },
      { provide: IntentTokenService, useValue: mockIntentTokenService },
      { provide: DiscordEmbedFactory, useValue: mockEmbedFactory },
      {
        provide: DiscordEmojiService,
        useValue: {
          getRoleEmoji: jest.fn(
            (r: string) =>
              ({
                tank: '\uD83D\uDEE1\uFE0F',
                healer: '\uD83D\uDC9A',
                dps: '\u2694\uFE0F',
              })[r] ?? '',
          ),
          getClassEmoji: jest.fn(() => ''),
          getRoleEmojiComponent: jest.fn((r: string) => {
            const fallback: Record<string, string> = {
              tank: '\uD83D\uDEE1\uFE0F',
              healer: '\uD83D\uDC9A',
              dps: '\u2694\uFE0F',
            };
            return fallback[r] ? { name: fallback[r] } : undefined;
          }),
          getClassEmojiComponent: jest.fn(() => undefined),
          isUsingCustomEmojis: jest.fn(() => false),
        },
      },
      { provide: SettingsService, useValue: mockSettingsService },
    ],
  }).compile();

  const instance: unknown = module.get(SignupInteractionListener);
  const listener = instance as TestableSignupInteractionListener;

  return {
    module,
    listener,
    mockClientService,
    mockSignupsService,
    mockEventsService,
    mockCharactersService,
    mockIntentTokenService,
    mockEmbedFactory,
    mockSettingsService,
    mockDb,
    mockEmbed,
    mockRow,
  };
}

/** Helper to set up linked user + event DB queries */
export function setupLinkedUserAndEvent(
  mocks: SignupInteractionMocks,
  userId: string,
  event: Record<string, unknown>,
  linkedUser: Record<string, unknown> = { id: 42 },
): void {
  mocks.mockSignupsService.findByDiscordUser.mockResolvedValueOnce(null);

  mocks.mockDb.select.mockReturnValueOnce({
    from: jest.fn().mockReturnValue({
      where: jest.fn().mockReturnValue({
        limit: jest
          .fn()
          .mockResolvedValue([{ ...linkedUser, discordId: userId }]),
      }),
    }),
  });

  mocks.mockDb.select.mockReturnValueOnce({
    from: jest.fn().mockReturnValue({
      where: jest.fn().mockReturnValue({
        limit: jest.fn().mockResolvedValue([event]),
      }),
    }),
  });
}

/** Helper to set up game registry query */
export function setupGameRegistryQuery(
  mocks: SignupInteractionMocks,
  game: Record<string, unknown> | null,
): void {
  mocks.mockDb.select.mockReturnValueOnce({
    from: jest.fn().mockReturnValue({
      where: jest.fn().mockReturnValue({
        limit: jest.fn().mockResolvedValue(game ? [game] : []),
      }),
    }),
  });
}

/** Helper to set up embed update mocks */
export function setupUpdateEmbedMocks(
  mocks: SignupInteractionMocks,
  eventId: number = 1,
): void {
  mocks.mockSignupsService.getRoster.mockResolvedValueOnce({
    eventId,
    signups: [],
    count: 0,
  });
  mocks.mockDb.select.mockReturnValueOnce(makeChain([]));
  mocks.mockDb.select.mockReturnValueOnce(makeChain([]));
}
