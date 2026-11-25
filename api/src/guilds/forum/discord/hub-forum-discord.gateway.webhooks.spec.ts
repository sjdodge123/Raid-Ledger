/**
 * ROK-2296 — the forum webhook leak behind the test guild's 1000-webhook cap:
 * `deleteForum` removes the bot's own webhooks before the channel (a deleted
 * channel's webhooks keep counting toward the cap), and `ensureWebhook`
 * reuses a "Raid Ledger" hook the bot already owns instead of stacking a new one.
 */
import { ChannelType, Collection } from 'discord.js';
import type { DiscordBotClientService } from '../../../discord-bot/discord-bot-client.service';
import { HubForumDiscordGateway } from './hub-forum-discord.gateway';

const BOT_ID = 'bot-1';

interface FakeHook {
  id: string;
  name: string;
  owner: { id: string } | null;
  token: string | null;
  delete: jest.Mock<Promise<void>, [string]>;
}

function hook(
  id: string,
  ownerId: string | null,
  name = 'Raid Ledger',
  token: string | null = 'tok',
) {
  const h: FakeHook = {
    id,
    name,
    owner: ownerId === null ? null : { id: ownerId },
    token,
    delete: jest.fn<Promise<void>, [string]>(() => Promise.resolve()),
  };
  return h;
}

function setup(hooks: FakeHook[]) {
  const calls: string[] = [];
  const list = new Collection(hooks.map((h) => [h.id, h] as const));
  for (const h of hooks) {
    h.delete.mockImplementation(() => {
      calls.push(`hook:${h.id}`);
      return Promise.resolve();
    });
  }
  const forum = {
    id: 'c1',
    type: ChannelType.GuildForum,
    fetchWebhooks: jest.fn<Promise<unknown>, []>(() => Promise.resolve(list)),
    createWebhook: jest.fn(() => Promise.resolve({ id: 'new-hook' })),
    delete: jest.fn<Promise<void>, [string]>(() => {
      calls.push('forum');
      return Promise.resolve();
    }),
  };
  const guild = { channels: { fetch: jest.fn(() => Promise.resolve(forum)) } };
  const client = {
    isConnected: () => true,
    getGuild: () => guild,
    getBotUser: () => ({ id: BOT_ID, username: 'Raid Ledger' }),
    getClient: () => null,
  };
  const gw = new HubForumDiscordGateway(
    client as unknown as DiscordBotClientService,
  );
  return { gw, forum, guild, calls };
}

describe('ROK-2296 deleteForum — the bot clears its own webhooks first', () => {
  it('deletes the bot-owned webhooks, then the forum', async () => {
    const mine = hook('h-mine', BOT_ID);
    const t = setup([mine]);
    await t.gw.deleteForum('c1');
    expect(t.calls).toEqual(['hook:h-mine', 'forum']);
  });

  it('never deletes a webhook another app or a moderator owns', async () => {
    const foreign = hook('h-foreign', 'someone-else');
    const orphan = hook('h-orphan', null);
    const t = setup([foreign, orphan]);
    await t.gw.deleteForum('c1');
    expect(foreign.delete).not.toHaveBeenCalled();
    expect(orphan.delete).not.toHaveBeenCalled();
    expect(t.forum.delete).toHaveBeenCalledTimes(1);
  });

  it('still deletes the forum when a webhook delete fails', async () => {
    const broken = hook('h-broken', BOT_ID);
    const t = setup([broken]);
    broken.delete.mockRejectedValueOnce(new Error('50013 Missing Permissions'));
    await t.gw.deleteForum('c1');
    expect(t.forum.delete).toHaveBeenCalledTimes(1);
  });

  it('still deletes the forum when listing its webhooks fails', async () => {
    const t = setup([]);
    t.forum.fetchWebhooks.mockRejectedValueOnce(new Error('ECONNRESET'));
    await t.gw.deleteForum('c1');
    expect(t.forum.delete).toHaveBeenCalledTimes(1);
  });
});

describe('ROK-2296 ensureWebhook — reuse before create', () => {
  it('keeps the stored webhook when it is still live', async () => {
    const t = setup([hook('h-stored', BOT_ID)]);
    expect(await t.gw.ensureWebhook('c1', 'h-stored')).toBe('h-stored');
    expect(t.forum.createWebhook).not.toHaveBeenCalled();
  });

  it("reuses the bot's own Raid Ledger hook when the stored id is gone", async () => {
    const t = setup([
      hook('h-foreign', 'someone-else'),
      hook('h-other-name', BOT_ID, 'Captain Hook'),
      hook('h-mine', BOT_ID),
    ]);
    expect(await t.gw.ensureWebhook('c1', null)).toBe('h-mine');
    expect(t.forum.createWebhook).not.toHaveBeenCalled();
  });

  it('skips a bot-owned hook with no token and creates a new one', async () => {
    const t = setup([hook('h-tokenless', BOT_ID, 'Raid Ledger', null)]);
    expect(await t.gw.ensureWebhook('c1', null)).toBe('new-hook');
    expect(t.forum.createWebhook).toHaveBeenCalled();
  });

  it('creates a webhook when the bot owns none on the channel', async () => {
    const t = setup([hook('h-foreign', 'someone-else')]);
    expect(await t.gw.ensureWebhook('c1', 'h-deleted')).toBe('new-hook');
    expect(t.forum.createWebhook).toHaveBeenCalledWith({
      name: 'Raid Ledger',
      reason: expect.any(String),
    });
  });
});

describe('ROK-2296 deleteOwnWebhooks — last-unbind cleanup is best-effort', () => {
  it('deletes the bot-owned webhooks and skips foreign ones', async () => {
    const mine = hook('h-mine', BOT_ID);
    const foreign = hook('h-foreign', 'someone-else');
    const t = setup([mine, foreign]);
    await t.gw.deleteOwnWebhooks('c1');
    expect(mine.delete).toHaveBeenCalledTimes(1);
    expect(foreign.delete).not.toHaveBeenCalled();
    expect(t.forum.delete).not.toHaveBeenCalled();
  });

  it('resolves (never blocks the unbind) when the forum is unreachable', async () => {
    const t = setup([]);
    t.guild.channels.fetch.mockRejectedValueOnce(new Error('ECONNRESET'));
    await expect(t.gw.deleteOwnWebhooks('c1')).resolves.toBeUndefined();
  });

  it('keeps going past a webhook Discord refuses to delete', async () => {
    const broken = hook('h-broken', BOT_ID);
    const next = hook('h-next', BOT_ID);
    const t = setup([broken, next]);
    broken.delete.mockRejectedValueOnce(new Error('50013 Missing Permissions'));
    await expect(t.gw.deleteOwnWebhooks('c1')).resolves.toBeUndefined();
    expect(next.delete).toHaveBeenCalledTimes(1);
  });
});

describe('ROK-2337 discardCreatedForum — a timed-out bind drops its new forum', () => {
  it('deletes the channel and forgets its pending webhook create', async () => {
    const t = setup([]);
    t.forum.createWebhook.mockImplementation(() => new Promise(() => undefined));
    const pending = t.gw.ensureWebhook('c1', null);
    void pending.catch(() => undefined);
    await new Promise((r) => setImmediate(r));
    await t.gw.discardCreatedForum('c1');
    expect(t.forum.delete).toHaveBeenCalledTimes(1);
    // The map entry is gone: a fresh ensureWebhook POSTs again.
    void t.gw.ensureWebhook('c1', null).catch(() => undefined);
    await new Promise((r) => setImmediate(r));
    expect(t.forum.createWebhook).toHaveBeenCalledTimes(2);
  });

  it('resolves (the 503 still surfaces) when Discord refuses the delete', async () => {
    const t = setup([]);
    t.forum.delete.mockRejectedValueOnce(new Error('50013 Missing Permissions'));
    await expect(t.gw.discardCreatedForum('c1')).resolves.toBeUndefined();
  });
});
