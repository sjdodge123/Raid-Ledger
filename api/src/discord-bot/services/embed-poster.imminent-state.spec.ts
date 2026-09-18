/**
 * ROK-1622: an event created INSIDE the 2h window used to post cyan
 * `announcing` (POSTED) because `postOrEditEmbed` called `buildEventEmbed`
 * with no options, so the factory's `options?.state ?? POSTED` default won and
 * `POSTED` was persisted. The only producer of IMMINENT was the embed-sync
 * processor, 2s later — and it silently dropped the correction whenever the
 * post had not landed a tracking row yet, so the card stayed cyan forever.
 *
 * These tests pin the FIRST persisted `discord_event_messages.embed_state`,
 * not the eventual colour: asserting the final state would pass on a
 * slow-but-lucky run, which is the whole defect.
 *
 * MUTATION: revert `embed-poster.service.ts` to
 *   `this.embedFactory.buildEventEmbed(enrichedEvent, context)` +
 *   `embedState: EMBED_STATES.POSTED` and the first two tests fail with
 *   `embedState: "posted"` received where `"imminent"` was expected.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { EmbedPosterService } from './embed-poster.service';
import { DiscordBotClientService } from '../discord-bot-client.service';
import {
  DiscordEmbedFactory,
  type EmbedEventData,
} from './discord-embed.factory';
import { ChannelResolverService } from './channel-resolver.service';
import { SettingsService } from '../../settings/settings.service';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import { EMBED_STATES } from '../discord-bot.constants';
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder } from 'discord.js';

const MINUTE_MS = 60_000;

describe('EmbedPosterService — first post derives its own state (ROK-1622)', () => {
  let service: EmbedPosterService;
  let embedFactory: { buildEventEmbed: jest.Mock };
  let insertValues: jest.Mock;
  let mockDb: Record<string, jest.Mock>;

  const mockEmbed = new EmbedBuilder().setTitle('Test');
  const mockRow = new ActionRowBuilder<ButtonBuilder>();

  /** An event whose window opens `minutes` from now and runs three hours. */
  const eventStartingIn = (minutes: number): EmbedEventData => ({
    id: 42,
    title: 'Raid Night',
    startTime: new Date(Date.now() + minutes * MINUTE_MS).toISOString(),
    endTime: new Date(Date.now() + (minutes + 180) * MINUTE_MS).toISOString(),
    signupCount: 0,
  });

  const makeSelectChain = (rows: unknown[] = []) => {
    const chain: Record<string, jest.Mock> & { then?: unknown } = {};
    chain.from = jest.fn().mockReturnValue(chain);
    chain.where = jest.fn().mockReturnValue(chain);
    chain.limit = jest.fn().mockResolvedValue(rows);
    chain.leftJoin = jest.fn().mockReturnValue(chain);
    chain.innerJoin = jest.fn().mockReturnValue(chain);
    chain.groupBy = jest.fn().mockResolvedValue([]);
    chain.then = (
      resolve: (v: unknown) => void,
      reject: (e: unknown) => void,
    ) => Promise.resolve(rows).then(resolve, reject);
    return chain;
  };

  beforeEach(async () => {
    insertValues = jest.fn().mockResolvedValue(undefined);
    mockDb = {
      select: jest.fn().mockReturnValue(makeSelectChain([])),
      insert: jest.fn().mockReturnValue({ values: insertValues }),
    };
    embedFactory = {
      buildEventEmbed: jest
        .fn()
        .mockReturnValue({ embed: mockEmbed, row: mockRow }),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmbedPosterService,
        { provide: DrizzleAsyncProvider, useValue: mockDb },
        {
          provide: DiscordBotClientService,
          useValue: {
            isConnected: jest.fn().mockReturnValue(true),
            getGuildId: jest.fn().mockReturnValue('guild-123'),
            sendEmbed: jest.fn().mockResolvedValue({ id: 'msg-123' }),
          },
        },
        { provide: DiscordEmbedFactory, useValue: embedFactory },
        {
          provide: ChannelResolverService,
          useValue: {
            resolveChannelForEvent: jest.fn().mockResolvedValue('channel-abc'),
            resolveVoiceChannelHonoringOverride: jest
              .fn()
              .mockResolvedValue(null),
          },
        },
        {
          provide: SettingsService,
          useValue: {
            getBranding: jest
              .fn()
              .mockResolvedValue({ communityName: 'Test Guild' }),
            getClientUrl: jest.fn().mockResolvedValue('http://localhost:5173'),
            getDefaultTimezone: jest.fn().mockResolvedValue('UTC'),
          },
        },
      ],
    }).compile();
    service = module.get(EmbedPosterService);
  });

  /**
   * Seed `count` live signups. `enrichWithLiveRoster` recounts from the DB, so
   * a `signupCount` on the passed projection alone would be overwritten.
   * Select call order: ephemeral-channel lookup, existing-record lookup,
   * signup rows, role counts.
   */
  const seedSignups = (count: number) => {
    const rows = Array.from({ length: count }, (_, i) => ({
      discordId: `discord-${i}`,
      username: `user-${i}`,
      displayName: null,
      discordUsername: null,
      userId: i + 1,
      role: null,
      status: 'confirmed',
      preferredRoles: null,
      characterClass: null,
      mainCharacterClass: null,
    }));
    mockDb.select
      .mockReturnValueOnce(makeSelectChain([]))
      .mockReturnValueOnce(makeSelectChain([]))
      .mockReturnValueOnce(makeSelectChain(rows))
      .mockReturnValueOnce(makeSelectChain([]));
  };

  afterEach(() => jest.clearAllMocks());

  it('persists IMMINENT on the FIRST write for an event 57 minutes out', async () => {
    const posted = await service.postEmbed(42, eventStartingIn(57));

    expect(posted).toBe(true);
    expect(insertValues).toHaveBeenCalledTimes(1);
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ embedState: EMBED_STATES.IMMINENT }),
    );
  });

  it('builds the first embed with the derived state, so no correcting round trip is needed', async () => {
    await service.postEmbed(42, eventStartingIn(57));

    expect(embedFactory.buildEventEmbed).toHaveBeenCalledWith(
      expect.objectContaining({ id: 42 }),
      expect.anything(),
      expect.objectContaining({ state: EMBED_STATES.IMMINENT }),
    );
  });

  it('still posts POSTED for an event comfortably outside the 2h window', async () => {
    await service.postEmbed(42, eventStartingIn(5 * 60));

    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ embedState: EMBED_STATES.POSTED }),
    );
  });

  it('posts FILLING when signups already exist outside the window', async () => {
    seedSignups(2);

    await service.postEmbed(42, eventStartingIn(5 * 60));

    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ embedState: EMBED_STATES.FILLING }),
    );
  });

  it('timing wins over capacity — a full roster inside the window still posts IMMINENT', async () => {
    seedSignups(5);

    await service.postEmbed(42, {
      ...eventStartingIn(30),
      maxAttendees: 5,
    });

    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ embedState: EMBED_STATES.IMMINENT }),
    );
  });
});
