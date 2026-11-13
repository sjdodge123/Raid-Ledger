/**
 * ROK-1728 follow-up: the FIRST post of a series night must already carry the
 * Join Series row. Lifecycle payloads keep `recurrenceGroupId` at the payload
 * top level (passed to `postEmbed` as an arg), not on `payload.event`, so the
 * card used to post with one row and relied on a later embed-sync edit to add
 * the second — an edit that is dropped whenever the sync beats the tracking
 * row insert (the ROK-1622 race), flaking smoke `series-signup-embed`.
 *
 * Uses the REAL embed factory so the assertion pins what Discord receives.
 *
 * MUTATION: drop the `recurrenceGroupId ??=` line in
 * `EmbedPosterService.postOrEditEmbed` and the series test fails with
 * `expect(received).toHaveLength(expected)` — Expected length: 2, Received
 * length: 1 (the signup row only, no `series_join:42` row).
 */
import { Test, TestingModule } from '@nestjs/testing';
import type { ActionRowBuilder, ButtonBuilder } from 'discord.js';
import { EmbedPosterService } from './embed-poster.service';
import { DiscordBotClientService } from '../discord-bot-client.service';
import {
  DiscordEmbedFactory,
  type EmbedEventData,
} from './discord-embed.factory';
import { DiscordEmojiService } from './discord-emoji.service';
import { ChannelResolverService } from './channel-resolver.service';
import { SettingsService } from '../../settings/settings.service';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';

const GROUP = '11111111-1111-4111-8111-111111111111';
const HOUR_MS = 3_600_000;

/** A lifecycle `payload.event`: no `recurrenceGroupId` on it. */
const payloadEvent = (): EmbedEventData => ({
  id: 42,
  title: 'Raid Night',
  startTime: new Date(Date.now() + 5 * HOUR_MS).toISOString(),
  endTime: new Date(Date.now() + 8 * HOUR_MS).toISOString(),
  signupCount: 0,
  game: { name: 'Valheim', coverUrl: null },
});

const makeSelectChain = () => {
  const chain: Record<string, jest.Mock> & { then?: unknown } = {};
  chain.from = jest.fn().mockReturnValue(chain);
  chain.where = jest.fn().mockReturnValue(chain);
  chain.limit = jest.fn().mockResolvedValue([]);
  chain.leftJoin = jest.fn().mockReturnValue(chain);
  chain.innerJoin = jest.fn().mockReturnValue(chain);
  chain.groupBy = jest.fn().mockResolvedValue([]);
  chain.then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
    Promise.resolve([]).then(resolve, reject);
  return chain;
};

function createFactory(): DiscordEmbedFactory {
  const emojiService = {
    getRoleEmoji: jest.fn(() => ''),
    getClassEmoji: jest.fn(() => ''),
    isUsingCustomEmojis: jest.fn(() => false),
  } as unknown as DiscordEmojiService;
  return new DiscordEmbedFactory(emojiService);
}

/** Custom ids per row of the components handed to `sendEmbed`. */
function sentCustomIds(sendEmbed: jest.Mock): string[][] {
  const call = sendEmbed.mock.calls[0] as unknown[] | undefined;
  if (!call) throw new Error('sendEmbed was never called');
  const rows = call[2] as ActionRowBuilder<ButtonBuilder>[];
  return rows.map((r) =>
    r.toJSON().components.map((c) => ('custom_id' in c ? c.custom_id : '')),
  );
}

describe('EmbedPosterService — first post carries the Join Series row', () => {
  let service: EmbedPosterService;
  let sendEmbed: jest.Mock;

  beforeEach(async () => {
    sendEmbed = jest.fn().mockResolvedValue({ id: 'msg-1' });
    const mockDb = {
      select: jest.fn(() => makeSelectChain()),
      insert: jest.fn(() => ({
        values: jest.fn().mockResolvedValue(undefined),
      })),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmbedPosterService,
        { provide: DrizzleAsyncProvider, useValue: mockDb },
        {
          provide: DiscordBotClientService,
          useValue: {
            isConnected: jest.fn().mockReturnValue(true),
            getGuildId: jest.fn().mockReturnValue('guild-1'),
            sendEmbed,
          },
        },
        { provide: DiscordEmbedFactory, useValue: createFactory() },
        {
          provide: ChannelResolverService,
          useValue: {
            resolveChannelForEvent: jest.fn().mockResolvedValue('channel-1'),
            resolveVoiceChannelHonoringOverride: jest
              .fn()
              .mockResolvedValue(null),
          },
        },
        {
          provide: SettingsService,
          useValue: {
            getEphemeralVoiceEnabled: jest.fn().mockResolvedValue(false),
            getEphemeralVoiceForced: jest.fn().mockResolvedValue(false),
            getEphemeralVoiceCreateBufferMinutes: jest
              .fn()
              .mockResolvedValue(30),
            getBranding: jest.fn().mockResolvedValue({ communityName: 'G' }),
            getClientUrl: jest.fn().mockResolvedValue('http://localhost:5173'),
            getDefaultTimezone: jest.fn().mockResolvedValue('UTC'),
          },
        },
      ],
    }).compile();
    service = module.get(EmbedPosterService);
  });

  afterEach(() => jest.clearAllMocks());

  it('posts a series night with a second row holding series_join:<id>', async () => {
    const posted = await service.postEmbed(42, payloadEvent(), null, GROUP);

    expect(posted).toBe(true);
    const ids = sentCustomIds(sendEmbed);
    expect(ids).toHaveLength(2);
    expect(ids[1]).toEqual(['series_join:42']);
  });

  it('posts a one-off event with a single row and no series_join', async () => {
    await service.postEmbed(42, payloadEvent(), null, null);

    const ids = sentCustomIds(sendEmbed);
    expect(ids).toHaveLength(1);
    expect(ids.flat()).not.toContain('series_join:42');
  });
});
