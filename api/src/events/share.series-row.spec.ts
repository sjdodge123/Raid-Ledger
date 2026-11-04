/**
 * ROK-1728 D8 (review MAJOR-1 + MINOR-5): sharing a series event posted the
 * card with `components: [row]`, dropping the Join Series row until an
 * unrelated embed-sync edit. This spec drives `ShareService` with the REAL
 * `DiscordEmbedFactory` and asserts the rows that reach `channel.send`.
 *
 * MUTATION: send `components: [built.row]` in `share.service.ts::trySendEmbed`
 * and the series case fails with 1 row where 2 were expected.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { ShareService } from './share.service';
import { EventsService } from './events.service';
import { DiscordBotClientService } from '../discord-bot/discord-bot-client.service';
import {
  DiscordEmbedFactory,
  type EmbedEventData,
} from '../discord-bot/services/discord-embed.factory';
import { DiscordEmojiService } from '../discord-bot/services/discord-emoji.service';
import { SettingsService } from '../settings/settings.service';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';

const GROUP = '11111111-1111-4111-8111-111111111111';
const DAY_MS = 86_400_000;

type SentRow = {
  toJSON: () => { components: Array<Record<string, unknown>> };
};
type SendPayload = { components?: SentRow[] };

function oneOffEvent(): EmbedEventData {
  return {
    id: 7,
    title: 'Raid Night',
    startTime: new Date(Date.now() + 3 * DAY_MS).toISOString(),
    endTime: new Date(Date.now() + 3 * DAY_MS + 3_600_000).toISOString(),
    signupCount: 0,
  };
}

function realFactory(): DiscordEmbedFactory {
  const emojiService = {
    getRoleEmoji: jest.fn(() => ''),
    isUsingCustomEmojis: jest.fn(() => false),
  } as unknown as DiscordEmojiService;
  return new DiscordEmbedFactory(emojiService);
}

function makeDb(): Record<string, jest.Mock> {
  // Select call order: channel bindings, then already-posted channels.
  const selectReturning = (rows: unknown[]): { from: jest.Mock } => ({
    from: jest.fn().mockReturnValue({
      where: jest.fn().mockResolvedValue(rows),
    }),
  });
  return {
    select: jest
      .fn()
      .mockReturnValueOnce(selectReturning([{ channelId: 'chan-1' }]))
      .mockReturnValueOnce(selectReturning([])),
    insert: jest.fn().mockReturnValue({
      values: jest.fn().mockResolvedValue(undefined),
    }),
  };
}

describe('ShareService — shared series card keeps Join Series (ROK-1728)', () => {
  let service: ShareService;
  let send: jest.Mock;
  let eventsService: { findOne: jest.Mock; buildEmbedEventData: jest.Mock };

  beforeEach(async () => {
    send = jest.fn().mockResolvedValue({ id: 'msg-1' });
    const channel = {
      isTextBased: () => true,
      isDMBased: () => false,
      send,
    };
    const guild = {
      id: 'guild-1',
      channels: { fetch: jest.fn().mockResolvedValue(channel) },
    };
    eventsService = {
      findOne: jest.fn().mockResolvedValue({ id: 7, cancelledAt: null }),
      buildEmbedEventData: jest.fn(),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ShareService,
        { provide: DrizzleAsyncProvider, useValue: makeDb() },
        {
          provide: DiscordBotClientService,
          useValue: {
            getClient: jest.fn().mockReturnValue({
              isReady: () => true,
              guilds: { cache: { first: () => guild } },
            }),
          },
        },
        { provide: DiscordEmbedFactory, useValue: realFactory() },
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

  function sentCustomIds(): string[][] {
    const payload: SendPayload = send.mock.calls[0]?.[0] ?? {};
    return (payload.components ?? []).map((r) =>
      r
        .toJSON()
        .components.map((c) =>
          typeof c.custom_id === 'string' ? c.custom_id : '',
        ),
    );
  }

  it('sends 2 rows, the second only series_join:<id>, for a series event', async () => {
    eventsService.buildEmbedEventData.mockResolvedValue({
      ...oneOffEvent(),
      recurrenceGroupId: GROUP,
    });

    const result = await service.shareToDiscordChannels(7);

    expect(result.channelsPosted).toBe(1);
    const rows = sentCustomIds();
    expect(rows).toHaveLength(2);
    expect(rows[1]).toEqual(['series_join:7']);
  });

  it('sends exactly 1 row for a one-off event', async () => {
    eventsService.buildEmbedEventData.mockResolvedValue(oneOffEvent());

    await service.shareToDiscordChannels(7);

    const rows = sentCustomIds();
    expect(rows).toHaveLength(1);
    expect(rows[0]).not.toContain('series_join:7');
  });
});
