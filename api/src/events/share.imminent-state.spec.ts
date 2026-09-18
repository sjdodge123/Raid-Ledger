/**
 * ROK-1622 AC3: `ShareService` carried the same hardcoded default as the
 * initial post — `buildEventEmbed(eventData, context)` with no options plus a
 * literal `embedState: 'posted'` — so sharing an event that starts in an hour
 * put a cyan `announcing` card in every bound channel.
 *
 * MUTATION: drop the `{ state }` third argument in
 * `share.service.ts::trySendEmbed` (or re-hardcode `embedState: 'posted'`) and
 * the first two tests fail with `"posted"` where `"imminent"` was expected.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { ShareService } from './share.service';
import { EventsService } from './events.service';
import { DiscordBotClientService } from '../discord-bot/discord-bot-client.service';
import {
  DiscordEmbedFactory,
  type EmbedEventData,
} from '../discord-bot/services/discord-embed.factory';
import { SettingsService } from '../settings/settings.service';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { EMBED_STATES } from '../discord-bot/discord-bot.constants';
import { EmbedBuilder } from 'discord.js';

const MINUTE_MS = 60_000;

describe('ShareService — shared copies derive their state (ROK-1622)', () => {
  let service: ShareService;
  let embedFactory: { buildEventEmbed: jest.Mock };
  let insertValues: jest.Mock;
  let eventsService: { findOne: jest.Mock; buildEmbedEventData: jest.Mock };

  const eventStartingIn = (minutes: number): EmbedEventData => ({
    id: 7,
    title: 'Raid Night',
    startTime: new Date(Date.now() + minutes * MINUTE_MS).toISOString(),
    endTime: new Date(Date.now() + (minutes + 180) * MINUTE_MS).toISOString(),
    signupCount: 0,
  });

  const channel = {
    isTextBased: () => true,
    isDMBased: () => false,
    send: jest.fn().mockResolvedValue({ id: 'msg-1' }),
  };

  const guild = {
    id: 'guild-1',
    channels: { fetch: jest.fn().mockResolvedValue(channel) },
  };

  beforeEach(async () => {
    insertValues = jest.fn().mockResolvedValue(undefined);
    embedFactory = {
      buildEventEmbed: jest
        .fn()
        .mockReturnValue({ embed: new EmbedBuilder().setTitle('T') }),
    };
    eventsService = {
      findOne: jest.fn().mockResolvedValue({ id: 7, cancelledAt: null }),
      buildEmbedEventData: jest.fn(),
    };
    // Select call order: channel bindings, then already-posted channels.
    const selectReturning = (rows: unknown[]) => ({
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockResolvedValue(rows),
      }),
    });
    const mockDb = {
      select: jest
        .fn()
        .mockReturnValueOnce(selectReturning([{ channelId: 'chan-1' }]))
        .mockReturnValueOnce(selectReturning([])),
      insert: jest.fn().mockReturnValue({ values: insertValues }),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ShareService,
        { provide: DrizzleAsyncProvider, useValue: mockDb },
        {
          provide: DiscordBotClientService,
          useValue: {
            getClient: jest.fn().mockReturnValue({
              isReady: () => true,
              guilds: { cache: { first: () => guild } },
            }),
          },
        },
        { provide: DiscordEmbedFactory, useValue: embedFactory },
        {
          provide: SettingsService,
          useValue: {
            getBranding: jest
              .fn()
              .mockResolvedValue({ communityName: 'Test Guild' }),
            getClientUrl: jest.fn().mockResolvedValue(null),
            getDefaultTimezone: jest.fn().mockResolvedValue('UTC'),
            getDiscordBotDefaultChannel: jest.fn().mockResolvedValue(null),
          },
        },
        { provide: EventsService, useValue: eventsService },
      ],
    }).compile();
    service = module.get(ShareService);
  });

  afterEach(() => jest.clearAllMocks());

  it('persists IMMINENT for an event shared 45 minutes before it starts', async () => {
    eventsService.buildEmbedEventData.mockResolvedValue(eventStartingIn(45));

    const result = await service.shareToDiscordChannels(7);

    expect(result.channelsPosted).toBe(1);
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ embedState: EMBED_STATES.IMMINENT }),
    );
  });

  it('renders the shared card in the derived state', async () => {
    eventsService.buildEmbedEventData.mockResolvedValue(eventStartingIn(45));

    await service.shareToDiscordChannels(7);

    expect(embedFactory.buildEventEmbed).toHaveBeenCalledWith(
      expect.objectContaining({ id: 7 }),
      expect.anything(),
      expect.objectContaining({ state: EMBED_STATES.IMMINENT }),
    );
  });

  it('still persists POSTED for an event shared well ahead of time', async () => {
    eventsService.buildEmbedEventData.mockResolvedValue(
      eventStartingIn(5 * 60),
    );

    await service.shareToDiscordChannels(7);

    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ embedState: EMBED_STATES.POSTED }),
    );
  });
});
