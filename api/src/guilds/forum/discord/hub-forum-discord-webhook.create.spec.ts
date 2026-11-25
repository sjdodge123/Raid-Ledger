/**
 * ROK-2337 — `ensureWebhook` bounds Discord's `createWebhook` (a throttled
 * create used to hold the bind forever) and deletes a webhook that lands
 * after the bind gave up — unless a later bind already reused it.
 */
import { EventEmitter } from 'node:events';
import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { ChannelType, Collection, RESTEvents } from 'discord.js';
import type { DiscordBotClientService } from '../../../discord-bot/discord-bot-client.service';
import { HubForumDiscordGateway } from './hub-forum-discord.gateway';
import { FORUM_WEBHOOK_CREATE_TIMEOUT_MS } from './hub-forum-discord-webhook.create';

const BOT_ID = 'bot-1';

interface FakeHook {
  id: string;
  name: string;
  owner: { id: string };
  token: string;
  delete: jest.Mock<Promise<void>, [string?]>;
}

function hook(id: string): FakeHook {
  const del = jest.fn<Promise<void>, [string?]>(() => Promise.resolve());
  return {
    id,
    name: 'Raid Ledger',
    owner: { id: BOT_ID },
    token: 't',
    delete: del,
  };
}

function setup() {
  const list = new Collection<string, FakeHook>();
  let settle: (h: FakeHook) => void = () => undefined;
  const forum = {
    id: 'c1',
    type: ChannelType.GuildForum,
    fetchWebhooks: jest.fn(() => Promise.resolve(list)),
    createWebhook: jest.fn(
      () => new Promise<FakeHook>((resolve) => (settle = resolve)),
    ),
  };
  const rest = new EventEmitter();
  const client = {
    isConnected: () => true,
    getGuild: () => ({ channels: { fetch: () => Promise.resolve(forum) } }),
    getBotUser: () => ({ id: BOT_ID, username: 'Raid Ledger' }),
    getClient: () => ({ rest }),
  };
  const gw = new HubForumDiscordGateway(
    client as unknown as DiscordBotClientService,
  );
  return { gw, list, forum, rest, land: (h: FakeHook) => settle(h) };
}

/** Start an ensureWebhook and record how it settled (never awaits it). */
function track(p: Promise<string>) {
  const out: { value: unknown } = { value: 'pending' };
  p.then(
    (id) => (out.value = id),
    (err: unknown) => (out.value = err),
  );
  return out;
}

let warn: jest.SpyInstance;
beforeEach(() => {
  jest.useFakeTimers();
  warn = jest
    .spyOn(Logger.prototype, 'warn')
    .mockImplementation(() => undefined);
});
afterEach(() => {
  jest.useRealTimers();
  warn.mockRestore();
});

describe('ROK-2337 ensureWebhook — bounded createWebhook', () => {
  it('returns the new hook when Discord answers in time', async () => {
    const t = setup();
    const out = track(t.gw.ensureWebhook('c1', null));
    await jest.advanceTimersByTimeAsync(1_000);
    t.land(hook('h-new'));
    await jest.advanceTimersByTimeAsync(0);
    expect(out.value).toBe('h-new');
  });

  it('fails with a 503 once the create outlives the time bound', async () => {
    const t = setup();
    const out = track(t.gw.ensureWebhook('c1', null));
    await jest.advanceTimersByTimeAsync(FORUM_WEBHOOK_CREATE_TIMEOUT_MS);
    expect(out.value).toBeInstanceOf(ServiceUnavailableException);
  });

  it('deletes a webhook that lands after the bind gave up', async () => {
    const t = setup();
    track(t.gw.ensureWebhook('c1', null));
    await jest.advanceTimersByTimeAsync(FORUM_WEBHOOK_CREATE_TIMEOUT_MS);
    const late = hook('h-late');
    t.land(late);
    await jest.advanceTimersByTimeAsync(0);
    expect(late.delete).toHaveBeenCalledTimes(1);
  });

  it('keeps a late webhook a retried bind already reused', async () => {
    const t = setup();
    track(t.gw.ensureWebhook('c1', null));
    await jest.advanceTimersByTimeAsync(FORUM_WEBHOOK_CREATE_TIMEOUT_MS);
    const late = hook('h-late');
    t.list.set(late.id, late); // Discord made it; the reply is still queued
    const retry = track(t.gw.ensureWebhook('c1', null));
    await jest.advanceTimersByTimeAsync(0);
    t.land(late);
    await jest.advanceTimersByTimeAsync(0);
    expect(retry.value).toBe('h-late');
    expect(late.delete).not.toHaveBeenCalled();
  });

  it("logs discord.js rate limits on this channel's webhook route", async () => {
    const t = setup();
    track(t.gw.ensureWebhook('c1', null));
    await jest.advanceTimersByTimeAsync(0);
    t.rest.emit(RESTEvents.RateLimited, {
      majorParameter: 'c1',
      route: '/channels/:id/webhooks',
      retryAfter: 5_000,
      scope: 'user',
    });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('rate-limited'));
    expect(t.rest.listenerCount(RESTEvents.RateLimited)).toBe(1);
    await jest.advanceTimersByTimeAsync(FORUM_WEBHOOK_CREATE_TIMEOUT_MS);
    expect(t.rest.listenerCount(RESTEvents.RateLimited)).toBe(0);
  });
});
