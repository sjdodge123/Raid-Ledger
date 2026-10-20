/**
 * ROK-1868 L3b — HubPostRelayService: channel availability (D8), the relay
 * embed (§2.5), error classification (§2.4) and best-effort unrelay (D2).
 */
import {
  ChannelType,
  DiscordAPIError,
  PermissionFlagsBits,
  type ActionRowBuilder,
  type ButtonBuilder,
  type EmbedBuilder,
} from 'discord.js';
import * as Sentry from '@sentry/nestjs';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../../drizzle/schema';
import type { DiscordBotClientService } from '../../discord-bot/discord-bot-client.service';
import type { SettingsService } from '../../settings/settings.service';
import * as discordQueries from '../guild-discord.queries';
import * as postQueries from './hub-posts.queries';
import type { HubPostRecord } from './hub-posts.queries';
import { HubPostRelayService } from './hub-post-relay.service';

jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn() }));
jest.mock('../guild-discord.queries', () => ({
  findBoundChannelId: jest.fn(),
}));
jest.mock('./hub-posts.queries', () => ({ setRelay: jest.fn() }));

const bound = jest.mocked(discordQueries.findBoundChannelId);
const setRelay = jest.mocked(postQueries.setRelay);
const capture = jest.mocked(Sentry.captureException);

const SEND_FLAGS = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.EmbedLinks,
];

function apiError(code: number): DiscordAPIError {
  return new DiscordAPIError(
    { code, message: `code ${code}` },
    code,
    403,
    'POST',
    '/channels/1/messages',
    {},
  );
}

interface FakeOpts {
  connected?: boolean;
  channel?: 'text' | 'voice' | 'missing';
  perms?: bigint[];
  me?: boolean;
}

function fakeGuild(opts: FakeOpts) {
  const granted = opts.perms ?? SEND_FLAGS;
  const has = jest.fn((flags: bigint[]) =>
    flags.every((f) => granted.includes(f)),
  );
  const channel = {
    id: 'c1',
    name: 'announcements',
    type:
      opts.channel === 'voice' ? ChannelType.GuildVoice : ChannelType.GuildText,
    permissionsFor: jest.fn(() => ({ has })),
  };
  const cache = new Map(opts.channel === 'missing' ? [] : [['c1', channel]]);
  return {
    id: 'dg1',
    channels: { cache },
    members: { me: opts.me === false ? null : { id: 'bot' } },
  };
}

function setup(opts: FakeOpts & { clientUrl?: string | null } = {}) {
  const guild = fakeGuild(opts);
  const client = {
    isConnected: jest.fn(() => opts.connected ?? true),
    getGuild: jest.fn(() => ((opts.connected ?? true) ? guild : null)),
    getGuildId: jest.fn(() => ((opts.connected ?? true) ? 'dg1' : null)),
    sendEmbed: jest
      .fn<Promise<{ id: string }>, SendArgs>()
      .mockResolvedValue({ id: 'm1' }),
    deleteMessage: jest.fn().mockResolvedValue(undefined),
  };
  const settings = {
    getTrustedClientUrl: jest.fn(() =>
      Promise.resolve(
        opts.clientUrl === undefined ? 'https://raid.example' : opts.clientUrl,
      ),
    ),
  };
  const svc = new HubPostRelayService(
    {} as PostgresJsDatabase<typeof schema>,
    client as unknown as DiscordBotClientService,
    settings as unknown as SettingsService,
  );
  return { svc, client, settings };
}

function record(body: string): HubPostRecord {
  const at = new Date('2026-10-20T20:00:00Z');
  return {
    post: {
      id: 42,
      guildId: 7,
      body,
      authorId: 3,
      createdAt: at,
      updatedAt: at,
      updatedBy: null,
      relayChannelId: null,
      relayMessageId: null,
      relayedAt: null,
    },
    author: {
      userId: 3,
      username: 'thrall',
      displayName: 'Thrall',
      avatar: null,
      customAvatarUrl: null,
      discordId: null,
    },
    editor: null,
  };
}

type SendArgs = [
  string,
  EmbedBuilder,
  ActionRowBuilder<ButtonBuilder>?,
  string?,
];

/** The one `sendEmbed` call, failing loudly when there was none. */
function firstSend(client: { sendEmbed: jest.Mock<unknown, SendArgs> }) {
  const call = client.sendEmbed.mock.calls[0];
  if (!call) throw new Error('sendEmbed was not called');
  const [channelId, embed, row, content] = call;
  if (!row) throw new Error('sendEmbed got no button row');
  return { channelId, embed: embed.toJSON(), row: row.toJSON(), content };
}

const TARGET = { guildId: 7, guildName: 'Onyx', channelId: 'c1' };

beforeEach(() => {
  jest.clearAllMocks();
  bound.mockResolvedValue('c1');
  setRelay.mockResolvedValue(undefined);
});

describe('availability (D8)', () => {
  it('unset when the hub has no bound channel', async () => {
    bound.mockResolvedValue(null);
    expect(await setup().svc.availability(7)).toEqual({ state: 'unset' });
  });

  it('disconnected when the bot is offline', async () => {
    const { svc } = setup({ connected: false });
    expect(await svc.availability(7)).toEqual({ state: 'disconnected' });
  });

  it('gone when the bound channel no longer exists (or is not text)', async () => {
    for (const channel of ['missing', 'voice'] as const) {
      expect(await setup({ channel }).svc.availability(7)).toEqual({
        state: 'gone',
        channelId: 'c1',
      });
    }
  });

  it('no-permission when any of View/Send/EmbedLinks is missing', async () => {
    for (const perms of [
      [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
      [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.EmbedLinks],
    ]) {
      expect(await setup({ perms }).svc.availability(7)).toEqual({
        state: 'no-permission',
        channelId: 'c1',
        channelName: 'announcements',
      });
    }
    expect(await setup({ me: false }).svc.availability(7)).toMatchObject({
      state: 'no-permission',
    });
  });

  it('ok with the channel id + name when the bot can send embeds', async () => {
    expect(await setup().svc.availability(7)).toEqual({
      state: 'ok',
      channelId: 'c1',
      channelName: 'announcements',
    });
  });

  it('never throws: a failing lookup reads as disconnected', async () => {
    bound.mockRejectedValue(new Error('db down'));
    expect(await setup().svc.availability(7)).toEqual({
      state: 'disconnected',
    });
  });
});

describe('relay (§2.5 embed + setRelay)', () => {
  it('sends ONE embed with a Read more link button, then stores the ids', async () => {
    const { svc, client } = setup();
    const out = await svc.relay(record('**Raid** at [8](/events)'), TARGET);
    expect(out).toBe('sent');
    expect(client.sendEmbed).toHaveBeenCalledTimes(1);
    const { channelId, embed, row, content } = firstSend(client);
    expect(channelId).toBe('c1');
    expect(content).toBeUndefined();
    expect(embed).toMatchObject({
      author: { name: '📣 Onyx' },
      title: 'New post from Thrall',
      description: '**Raid** at [8](https://raid.example/events)',
      footer: { text: 'Raid Ledger' },
      color: 0x64748b,
      timestamp: '2026-10-20T20:00:00.000Z',
    });
    expect(row.components).toEqual([
      expect.objectContaining({
        label: 'Read more',
        url: 'https://raid.example/guilds/7?post=42#posts',
      }),
    ]);
    expect(setRelay).toHaveBeenCalledWith({}, 42, {
      channelId: 'c1',
      messageId: 'm1',
      at: expect.any(Date),
    });
  });

  it('falls back to the username when there is no display name', async () => {
    const { svc, client } = setup();
    const base = record('hi');
    const author = base.author ? { ...base.author, displayName: null } : null;
    await svc.relay({ ...base, author }, TARGET);
    const { embed } = firstSend(client);
    expect(embed.title).toBe('New post from thrall');
  });

  it('titles a wiped author "New post"; the excerpt is capped with …', async () => {
    const { svc, client } = setup();
    const wiped = { ...record('word '.repeat(200)), author: null };
    await svc.relay(wiped, TARGET);
    const { embed } = firstSend(client);
    expect(embed.title).toBe('New post');
    expect(embed.description?.endsWith('…')).toBe(true);
    expect(embed.description?.length).toBeLessThanOrEqual(301);
  });
});

describe('relay error classification (§2.4)', () => {
  it.each([50013, 50001, 10003])(
    'Discord %i → failed + warn, no Sentry, no setRelay',
    async (code) => {
      const { svc, client } = setup();
      client.sendEmbed.mockRejectedValue(apiError(code));
      expect(await svc.relay(record('hi'), TARGET)).toBe('failed');
      expect(setRelay).not.toHaveBeenCalled();
      expect(capture).not.toHaveBeenCalled();
    },
  );

  it('anything else → failed + Sentry (tag hub_post_relay)', async () => {
    const { svc, client } = setup();
    const boom = new Error('socket hang up');
    client.sendEmbed.mockRejectedValue(boom);
    expect(await svc.relay(record('hi'), TARGET)).toBe('failed');
    expect(capture).toHaveBeenCalledWith(boom, {
      tags: { hub_post_relay: 'send' },
    });
    expect(setRelay).not.toHaveBeenCalled();
  });

  it('failed without sending when no client URL is configured', async () => {
    const { svc, client } = setup({ clientUrl: null });
    expect(await svc.relay(record('hi'), TARGET)).toBe('failed');
    expect(client.sendEmbed).not.toHaveBeenCalled();
  });
});

describe('unrelay (D2, best effort)', () => {
  it('deletes the relayed message', async () => {
    const { svc, client } = setup();
    await svc.unrelay('c1', 'm1');
    expect(client.deleteMessage).toHaveBeenCalledWith('c1', 'm1');
  });

  it.each([10008, 50013])(
    'swallows Discord %i without Sentry',
    async (code) => {
      const { svc, client } = setup();
      client.deleteMessage.mockRejectedValue(apiError(code));
      await expect(svc.unrelay('c1', 'm1')).resolves.toBeUndefined();
      expect(capture).not.toHaveBeenCalled();
    },
  );

  it('swallows an unexpected error but reports it', async () => {
    const { svc, client } = setup();
    client.deleteMessage.mockRejectedValue(new Error('boom'));
    await expect(svc.unrelay('c1', 'm1')).resolves.toBeUndefined();
    expect(capture).toHaveBeenCalledTimes(1);
  });
});

describe('discordGuildId', () => {
  it('is the bot guild id, null when offline', () => {
    expect(setup().svc.discordGuildId()).toBe('dg1');
    expect(setup({ connected: false }).svc.discordGuildId()).toBeNull();
  });
});
