import {
  BadRequestException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  ChannelType,
  DiscordAPIError,
  PermissionFlagsBits,
  PermissionsBitField,
} from 'discord.js';
import { SETTING_KEYS, type SettingKey } from '../../drizzle/schema';
import type { SettingsService } from '../../settings/settings.service';
import type { DiscordBotClientService } from '../discord-bot-client.service';
import { JoinPostService } from './join-post.service';
import { JOIN_POST_AUTHOR } from './join-post.constants';

const BOT = 'bot-1';
const CHAN_KEY = SETTING_KEYS.DISCORD_JOIN_POST_CHANNEL_ID;
const MSG_KEY = SETTING_KEYS.DISCORD_JOIN_POST_MESSAGE_ID;
const FULL = new PermissionsBitField([
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.EmbedLinks,
  PermissionFlagsBits.ReadMessageHistory,
  PermissionFlagsBits.PinMessages,
]);

function discordError(code: number): Error {
  const err = Object.create(DiscordAPIError.prototype) as DiscordAPIError & {
    code: number;
  };
  Object.defineProperty(err, 'code', { value: code });
  Object.defineProperty(err, 'message', { value: `Discord ${code}` });
  return err;
}

interface FakeMessage {
  id: string;
  pinned: boolean;
  author: { id: string };
  embeds: { author: { name: string } }[];
  edit: jest.Mock;
  pin: jest.Mock;
}

function fakeMessage(id: string): FakeMessage {
  const msg: FakeMessage = {
    id,
    pinned: false,
    author: { id: BOT },
    embeds: [{ author: { name: JOIN_POST_AUTHOR } }],
    edit: jest.fn().mockResolvedValue(undefined),
    pin: jest.fn(() => {
      msg.pinned = true;
      return Promise.resolve();
    }),
  };
  return msg;
}

function fakeChannel(id: string, perms: PermissionsBitField = FULL) {
  let next = 0;
  return {
    id,
    name: `chan-${id}`,
    type: ChannelType.GuildText,
    permissionsFor: jest.fn(() => perms),
    send: jest.fn(() => Promise.resolve(fakeMessage(`${id}-new-${++next}`))),
    messages: {
      fetch: jest.fn(),
      fetchPins: jest.fn().mockResolvedValue({ items: [] }),
      delete: jest.fn().mockResolvedValue(undefined),
    },
  };
}
type FakeChannel = ReturnType<typeof fakeChannel>;

function setup(channels: FakeChannel[], stored: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(stored));
  const settings = {
    get: jest.fn((k: SettingKey) => Promise.resolve(store.get(k) ?? null)),
    set: jest.fn((k: SettingKey, v: string) => {
      store.set(k, v);
      return Promise.resolve();
    }),
    delete: jest.fn((k: SettingKey) => {
      store.delete(k);
      return Promise.resolve();
    }),
    exists: jest.fn(),
    getBranding: jest.fn().mockResolvedValue({ communityName: 'Night Owls' }),
    getClientUrl: jest.fn().mockResolvedValue('https://raid.example.com'),
  };
  const guild = {
    channels: { cache: new Map(channels.map((c) => [c.id, c])) },
    members: { me: { id: BOT } },
  };
  const client = {
    isConnected: jest.fn(() => true),
    getGuild: jest.fn(() => guild),
    getBotUser: jest.fn(() => ({ id: BOT, username: 'rl-bot' })),
  };
  const service = new JoinPostService(
    settings as unknown as SettingsService,
    client as unknown as DiscordBotClientService,
  );
  return { service, store, client };
}

describe('JoinPostService.publish — idempotency', () => {
  it('creates, stores the ids BEFORE pinning, then pins', async () => {
    const chan = fakeChannel('c1');
    const { service, store } = setup([chan]);
    let storedAtPin: string | undefined;
    chan.send.mockImplementationOnce(() => {
      const msg = fakeMessage('m-created');
      msg.pin.mockImplementation(() => {
        storedAtPin = store.get(MSG_KEY);
        return Promise.resolve();
      });
      return Promise.resolve(msg);
    });
    const result = await service.publish('c1');
    expect(result).toEqual({
      outcome: 'created',
      channelId: 'c1',
      messageId: 'm-created',
      pinned: true,
      warning: null,
    });
    expect(storedAtPin).toBe('m-created');
    expect(store.get(CHAN_KEY)).toBe('c1');
  });

  it('re-post edits the stored message and sends nothing', async () => {
    const chan = fakeChannel('c1');
    const existing = fakeMessage('m1');
    existing.pinned = true;
    chan.messages.fetch.mockResolvedValue(existing);
    const { service, store } = setup([chan], {
      [CHAN_KEY]: 'c1',
      [MSG_KEY]: 'm1',
    });
    const result = await service.publish('c1');
    expect(result.outcome).toBe('edited');
    expect(result.messageId).toBe('m1');
    expect(existing.edit).toHaveBeenCalledTimes(1);
    expect(chan.send).not.toHaveBeenCalled();
    expect(existing.pin).not.toHaveBeenCalled();
    expect(store.get(MSG_KEY)).toBe('m1');
  });

  it('re-creates and stores the new id when Discord says 10008', async () => {
    const chan = fakeChannel('c1');
    chan.messages.fetch.mockRejectedValue(discordError(10008));
    const { service, store } = setup([chan], {
      [CHAN_KEY]: 'c1',
      [MSG_KEY]: 'gone',
    });
    const result = await service.publish('c1');
    expect(result.outcome).toBe('recreated');
    expect(chan.send).toHaveBeenCalledTimes(1);
    expect(store.get(MSG_KEY)).toBe(result.messageId);
    expect(result.messageId).not.toBe('gone');
    expect(result.pinned).toBe(true);
  });

  it('re-creates when the edit says 10008 (a stale cached copy), not 503', async () => {
    const chan = fakeChannel('c1');
    const stale = fakeMessage('m1');
    stale.edit.mockRejectedValue(discordError(10008));
    chan.messages.fetch.mockResolvedValue(stale);
    const { service, store } = setup([chan], {
      [CHAN_KEY]: 'c1',
      [MSG_KEY]: 'm1',
    });
    const result = await service.publish('c1');
    expect(result.outcome).toBe('recreated');
    expect(chan.send).toHaveBeenCalledTimes(1);
    expect(store.get(MSG_KEY)).toBe(result.messageId);
    expect(result.messageId).not.toBe('m1');
  });

  it('adopts an orphaned post instead of sending a duplicate on 10008', async () => {
    const chan = fakeChannel('c1');
    const orphan = fakeMessage('m-orphan');
    chan.messages.fetch.mockRejectedValue(discordError(10008));
    chan.messages.fetchPins.mockResolvedValue({ items: [{ message: orphan }] });
    const { service, store } = setup([chan], {
      [CHAN_KEY]: 'c1',
      [MSG_KEY]: 'gone',
    });
    const result = await service.publish('c1');
    expect(chan.send).not.toHaveBeenCalled();
    expect(result.outcome).toBe('adopted');
    expect(orphan.edit).toHaveBeenCalledTimes(1);
    expect(store.get(MSG_KEY)).toBe('m-orphan');
  });

  it('a transient fetch failure is a 503: no send, ids untouched', async () => {
    const chan = fakeChannel('c1');
    chan.messages.fetch.mockRejectedValue(discordError(0));
    const { service, store } = setup([chan], {
      [CHAN_KEY]: 'c1',
      [MSG_KEY]: 'm1',
    });
    await expect(service.publish('c1')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(chan.send).not.toHaveBeenCalled();
    expect(store.get(MSG_KEY)).toBe('m1');
  });

  it('adopts the bot’s own post when no id is stored', async () => {
    const chan = fakeChannel('c1');
    const own = fakeMessage('m-own');
    chan.messages.fetchPins.mockResolvedValue({ items: [{ message: own }] });
    const { service, store } = setup([chan]);
    const result = await service.publish('c1');
    expect(result.outcome).toBe('adopted');
    expect(own.edit).toHaveBeenCalledTimes(1);
    expect(chan.send).not.toHaveBeenCalled();
    expect(store.get(MSG_KEY)).toBe('m-own');
  });
});

describe('JoinPostService.publish — guards and channel switch', () => {
  it('missing permissions → 422 naming them, nothing sent', async () => {
    const perms = new PermissionsBitField(FULL).remove(
      PermissionFlagsBits.PinMessages,
    );
    const chan = fakeChannel('c1', perms);
    const { service, store } = setup([chan]);
    const err: unknown = await service.publish('c1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UnprocessableEntityException);
    const body =
      err instanceof UnprocessableEntityException ? err.getResponse() : null;
    expect(body).toMatchObject({ missing: ['Pin Messages'] });
    expect(chan.send).not.toHaveBeenCalled();
    expect(store.size).toBe(0);
  });

  it('switching channel deletes the old post before sending', async () => {
    const oldChan = fakeChannel('old');
    const newChan = fakeChannel('new');
    const { service, store } = setup([oldChan, newChan], {
      [CHAN_KEY]: 'old',
      [MSG_KEY]: 'm-old',
    });
    const result = await service.publish('new');
    expect(oldChan.messages.delete).toHaveBeenCalledWith('m-old');
    const deletedAt = oldChan.messages.delete.mock.invocationCallOrder[0];
    const sentAt = newChan.send.mock.invocationCallOrder[0];
    expect(deletedAt).toBeLessThan(sentAt ?? 0);
    expect(result.outcome).toBe('created');
    expect(store.get(CHAN_KEY)).toBe('new');
  });

  it('a transient delete on channel switch is a 503 with nothing written', async () => {
    const oldChan = fakeChannel('old');
    oldChan.messages.delete.mockRejectedValue(discordError(0));
    const newChan = fakeChannel('new');
    const { service, store } = setup([oldChan, newChan], {
      [CHAN_KEY]: 'old',
      [MSG_KEY]: 'm-old',
    });
    await expect(service.publish('new')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(newChan.send).not.toHaveBeenCalled();
    expect(store.get(MSG_KEY)).toBe('m-old');
  });

  it('a pin refusal still succeeds, with pinned:false and a warning', async () => {
    const chan = fakeChannel('c1');
    chan.send.mockImplementationOnce(() => {
      const msg = fakeMessage('m1');
      msg.pin.mockRejectedValue(discordError(30003));
      return Promise.resolve(msg);
    });
    const { service, store } = setup([chan]);
    const result = await service.publish('c1');
    expect(result.pinned).toBe(false);
    expect(result.warning).toContain('50 pinned');
    expect(store.get(MSG_KEY)).toBe('m1');
  });

  it('bot offline → 503; unknown channel → 400', async () => {
    const chan = fakeChannel('c1');
    const { service, client } = setup([chan]);
    await expect(service.publish('nope')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    client.isConnected.mockReturnValue(false);
    await expect(service.publish('c1')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(chan.send).not.toHaveBeenCalled();
  });
});

describe('JoinPostService.remove', () => {
  it('deletes the post and clears the stored ids', async () => {
    const chan = fakeChannel('c1');
    const { service, store } = setup([chan], {
      [CHAN_KEY]: 'c1',
      [MSG_KEY]: 'm1',
    });
    await expect(service.remove()).resolves.toEqual({ removed: true });
    expect(chan.messages.delete).toHaveBeenCalledWith('m1');
    expect(store.size).toBe(0);
  });

  it('already gone (10008) still clears the stored ids', async () => {
    const chan = fakeChannel('c1');
    chan.messages.delete.mockRejectedValue(discordError(10008));
    const { service, store } = setup([chan], {
      [CHAN_KEY]: 'c1',
      [MSG_KEY]: 'm1',
    });
    await expect(service.remove()).resolves.toEqual({ removed: false });
    expect(store.size).toBe(0);
  });

  it('a transient failure is a 503 that keeps the stored ids', async () => {
    const chan = fakeChannel('c1');
    chan.messages.delete.mockRejectedValue(discordError(0));
    const { service, store } = setup([chan], {
      [CHAN_KEY]: 'c1',
      [MSG_KEY]: 'm1',
    });
    await expect(service.remove()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(store.get(MSG_KEY)).toBe('m1');
  });

  it('nothing stored → removed:false without touching Discord', async () => {
    const { service, client } = setup([]);
    await expect(service.remove()).resolves.toEqual({ removed: false });
    expect(client.getGuild).not.toHaveBeenCalled();
  });
});
