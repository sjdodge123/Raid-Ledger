/**
 * ROK-2337 — `ensureWebhook` bounds Discord's `createWebhook` (a throttled
 * create used to hold the bind forever). A webhook that lands after the bind
 * gave up is logged, never deleted; the next bind reuses it (ROK-2296).
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

/** Time out one bind, then let Discord's late reply land. */
async function timeOutThenLand(t: ReturnType<typeof setup>, late: FakeHook) {
  const first = track(t.gw.ensureWebhook('c1', null));
  await jest.advanceTimersByTimeAsync(FORUM_WEBHOOK_CREATE_TIMEOUT_MS);
  t.list.set(late.id, late); // Discord made it; the reply arrives late
  t.land(late);
  await jest.advanceTimersByTimeAsync(0);
  return first;
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
    expect((out.value as ServiceUnavailableException).message).toBe(
      'Discord is slow to create the forum webhook right now. Try again in a minute.',
    );
  });

  it('logs a webhook that lands after the bind gave up, never deletes it', async () => {
    const t = setup();
    const late = hook('h-late');
    const first = await timeOutThenLand(t, late);
    expect(first.value).toBeInstanceOf(ServiceUnavailableException);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('Late webhook h-late on c1'),
    );
    expect(late.delete).not.toHaveBeenCalled();
  });

  it('the next ensureWebhook reuses the late owned hook, no second create', async () => {
    const t = setup();
    const late = hook('h-late');
    await timeOutThenLand(t, late);
    const retry = track(t.gw.ensureWebhook('c1', null));
    await jest.advanceTimersByTimeAsync(0);
    expect(retry.value).toBe('h-late');
    expect(t.forum.createWebhook).toHaveBeenCalledTimes(1);
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
