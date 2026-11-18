/**
 * ROK-2258 review r1 — `HubForumDiscordDecor.run` classifies how a dressing
 * ended, so the once-ever backfill settles on permanent conditions (missing
 * Manage Channels, a deleted channel) and retries only transient ones; and a
 * bind tags only the JOINING hub's event posts.
 */
import { DiscordAPIError } from 'discord.js';
import { HubForumDiscordDecor } from './hub-forum-discord-decor.apply';
import * as decorQueries from './hub-forum-discord-decor.queries';
import type {
  ForumInfo,
  HubForumDiscordGateway,
} from './hub-forum-discord.gateway';
import * as queries from './hub-forum-discord.queries';
import type { ForumDiscordDb } from './hub-forum-discord.queries';

jest.mock('./hub-forum-discord-decor.queries');
jest.mock('./hub-forum-discord.queries');
const dq = jest.mocked(decorQueries);
const q = jest.mocked(queries);

const EVENT_TAG = { id: 't-event', name: 'Event' };

function forumInfo(over: Partial<ForumInfo> = {}): ForumInfo {
  return {
    id: 'c1',
    name: 'hub-forums',
    tags: [EVENT_TAG],
    missing: [],
    canManage: true,
    isPublic: true,
    requireTag: false,
    ...over,
  };
}

function discordError(code: number, status: number): DiscordAPIError {
  return new DiscordAPIError(
    { code, message: `code ${String(code)}` },
    code,
    status,
    'PATCH',
    '/channels/c1',
    {},
  );
}

function setup(info: ForumInfo | null, botGuild: string | null = 'dg') {
  const gw = {
    fetchForum: jest.fn(() => Promise.resolve(info)),
    guildId: jest.fn(() => botGuild),
    addTags: jest.fn(() => Promise.resolve(info?.tags ?? [])),
    applyTag: jest.fn(() => Promise.resolve()),
    setDefaultReactionIfUnset: jest.fn(() => Promise.resolve(true)),
    requireTags: jest.fn(() => Promise.resolve()),
  };
  const decor = new HubForumDiscordDecor(
    {} as ForumDiscordDb,
    gw as unknown as HubForumDiscordGateway,
  );
  return { gw, decor };
}

beforeEach(() => {
  jest.resetAllMocks();
  q.listForumBindings.mockResolvedValue([
    { guildId: 5, tagId: 't5', hubName: 'Alpha' },
    { guildId: 7, tagId: 't7', hubName: 'Beta' },
  ]);
  q.linkedThreadIds.mockResolvedValue([]);
  dq.linkedEventThreadIds.mockResolvedValue(['p1']);
});

describe('ROK-2258 decor outcome — permanent conditions settle', () => {
  it('settles (no retry) when the bot lacks Manage Channels', async () => {
    const t = setup(forumInfo({ canManage: false }));
    expect(await t.decor.run(1, 'c1')).toBe('settled');
    expect(t.gw.addTags).not.toHaveBeenCalled();
  });

  it('settles when the channel is gone while the bot is online', async () => {
    const t = setup(null);
    expect(await t.decor.run(1, 'c1')).toBe('settled');
  });

  it('settles on Discord Unknown Channel (10003) mid-run', async () => {
    const t = setup(forumInfo());
    t.gw.setDefaultReactionIfUnset.mockRejectedValueOnce(
      discordError(10003, 404),
    );
    expect(await t.decor.run(1, 'c1')).toBe('settled');
  });

  it('settles on Discord Missing Permissions (50013) mid-run', async () => {
    const t = setup(forumInfo());
    t.gw.addTags.mockRejectedValueOnce(discordError(50013, 403));
    expect(await t.decor.run(1, 'c1')).toBe('settled');
  });
});

describe('ROK-2258 decor outcome — transient conditions retry', () => {
  it('retries when the bot is offline (forum unreadable)', async () => {
    const t = setup(null, null);
    expect(await t.decor.run(1, 'c1')).toBe('retry');
  });

  it('retries on a rate limit (429)', async () => {
    const t = setup(forumInfo());
    t.gw.addTags.mockRejectedValueOnce(discordError(0, 429));
    expect(await t.decor.run(1, 'c1')).toBe('retry');
  });

  it('retries on a network / 5xx error', async () => {
    const t = setup(forumInfo());
    t.gw.addTags.mockRejectedValueOnce(new Error('Service Unavailable'));
    expect(await t.decor.run(1, 'c1')).toBe('retry');
  });

  it('answers done when every step lands', async () => {
    const t = setup(forumInfo());
    expect(await t.decor.run(1, 'c1')).toBe('done');
  });
});

describe('ROK-2258 bind fan-out — only the joining hub', () => {
  it("a bind tags only the joining hub's event posts", async () => {
    const t = setup(forumInfo());
    await t.decor.run(1, 'c1', 7);
    expect(dq.linkedEventThreadIds).toHaveBeenCalledTimes(1);
    expect(dq.linkedEventThreadIds).toHaveBeenCalledWith({}, [7]);
    expect(t.gw.applyTag).toHaveBeenCalledWith('c1', ['p1'], 't-event');
  });

  it("the backfill (no joining hub) tags every bound hub's event posts", async () => {
    const t = setup(forumInfo());
    await t.decor.run(1, 'c1');
    expect(dq.linkedEventThreadIds).toHaveBeenCalledWith({}, [5, 7]);
  });
});
