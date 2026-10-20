/**
 * ROK-1872 (ROK-1428 §2.8/§2.9): the event card's context carries the hub
 * link resolved from the event's game + tagged hub; no hub ⇒ no `hubLink`
 * key; a resolver failure never fails the post.
 */
import { Test } from '@nestjs/testing';
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder } from 'discord.js';
import { EmbedPosterService } from './embed-poster.service';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { DiscordEmbedFactory } from './discord-embed.factory';
import { ChannelResolverService } from './channel-resolver.service';
import { SettingsService } from '../../settings/settings.service';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';

const BASE = 'http://localhost:5173';
type GuildRows = Array<{ id: number }> | Error;

/** A select chain resolving `rows` (or rejecting with an Error). */
function chain(rows: unknown[] | Error): Record<string, unknown> {
  const settle = (): Promise<unknown> =>
    rows instanceof Error ? Promise.reject(rows) : Promise.resolve(rows);
  const c: Record<string, unknown> = {};
  for (const k of ['where', 'leftJoin', 'innerJoin', 'orderBy'])
    c[k] = jest.fn(() => c);
  c.limit = jest.fn(settle);
  c.groupBy = jest.fn(() => Promise.resolve([]));
  c.then = (ok: (v: unknown) => void, ko: (e: unknown) => void) =>
    settle().then(ok, ko);
  return c;
}

/** Routes each select by table: events → tagged row, guilds → `guilds`. */
function routedDb(guilds: GuildRows): Record<string, jest.Mock> {
  const from = (table: unknown): Record<string, unknown> => {
    if (table === schema.events) return chain([{ gameId: 5, guildId: 7 }]);
    if (table === schema.guilds) return chain(guilds);
    return chain([]);
  };
  return {
    select: jest.fn(() => ({ from })),
    insert: jest.fn(() => ({ values: jest.fn().mockResolvedValue(undefined) })),
  };
}

async function setup(guilds: GuildRows): Promise<{
  service: EmbedPosterService;
  build: jest.Mock;
}> {
  const build = jest.fn().mockReturnValue({
    embed: new EmbedBuilder().setTitle('T'),
    row: new ActionRowBuilder<ButtonBuilder>(),
  });
  const module = await Test.createTestingModule({
    providers: [
      EmbedPosterService,
      { provide: DrizzleAsyncProvider, useValue: routedDb(guilds) },
      {
        provide: DiscordBotClientService,
        useValue: {
          isConnected: () => true,
          getGuildId: () => 'guild-123',
          sendEmbed: jest.fn().mockResolvedValue({ id: 'msg-1' }),
        },
      },
      { provide: DiscordEmbedFactory, useValue: { buildEventEmbed: build } },
      {
        provide: ChannelResolverService,
        useValue: {
          resolveChannelForEvent: jest.fn().mockResolvedValue('chan-1'),
          resolveVoiceChannelHonoringOverride: jest
            .fn()
            .mockResolvedValue(null),
        },
      },
      {
        provide: SettingsService,
        useValue: {
          getBranding: jest.fn().mockResolvedValue({ communityName: 'G' }),
          getClientUrl: jest.fn().mockResolvedValue(BASE),
          getDefaultTimezone: jest.fn().mockResolvedValue('UTC'),
        },
      },
    ],
  }).compile();
  return { service: module.get(EmbedPosterService), build };
}

const EVENT = {
  id: 42,
  title: 'Raid',
  startTime: new Date(Date.now() + 86_400_000).toISOString(),
  endTime: new Date(Date.now() + 90_000_000).toISOString(),
  signupCount: 0,
};

function contextOf(build: jest.Mock): Record<string, unknown> {
  const ctx: unknown = build.mock.calls[0]?.[1];
  if (typeof ctx !== 'object' || ctx === null) throw new Error('no context');
  return { ...ctx };
}

describe('EmbedPosterService — hub link (ROK-1872)', () => {
  it('puts the tagged hub link on the card context', async () => {
    const { service, build } = await setup([{ id: 7 }, { id: 8 }]);
    expect(await service.postEmbed(42, EVENT, 5)).toBe(true);
    expect(contextOf(build).hubLink).toEqual({
      url: `${BASE}/guilds/7`,
      label: 'Hub',
    });
  });

  it('omits hubLink when the game has no hub', async () => {
    const { service, build } = await setup([]);
    expect(await service.postEmbed(42, EVENT, 5)).toBe(true);
    expect('hubLink' in contextOf(build)).toBe(false);
  });

  it('still posts (without the link) when hub resolution throws', async () => {
    const { service, build } = await setup(new Error('guilds down'));
    expect(await service.postEmbed(42, EVENT, 5)).toBe(true);
    expect('hubLink' in contextOf(build)).toBe(false);
  });
});
