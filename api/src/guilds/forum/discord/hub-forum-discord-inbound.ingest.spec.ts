/**
 * ROK-2208 review M3/M4 — a starter import that loses the unique race to the
 * other handler (the starter's own MessageCreate vs a reply that fetched the
 * missed starter) is skipped, not thrown; other errors still throw.
 */
import type { HubForumDiscordEventGate } from './hub-forum-discord-event-gate';
import * as inbound from './hub-forum-discord-inbound.writes';
import {
  HubForumDiscordInboundIngest,
  isUniqueViolation,
} from './hub-forum-discord-inbound.ingest';
import type { ForumLink } from './hub-forum-discord-links.queries';
import type { HubForumDiscordNotices } from './hub-forum-discord-notice';
import type { HubForumDiscordPinSync } from './hub-forum-discord-pins';
import type {
  ForumRoute,
  HubForumDiscordRouteResolver,
  InboundMessage,
  InboundThread,
} from './hub-forum-discord-route';
import type { ForumDiscordDb } from './hub-forum-discord.queries';

jest.mock('./hub-forum-discord-inbound.writes');
const w = jest.mocked(inbound);

const POST = '1300000000000000000'; // a snowflake well after boundAt
const wrapped23505 = Object.assign(new Error('insert failed'), {
  cause: { code: '23505' },
});

const route: ForumRoute = {
  forumId: 1,
  channelId: 'forum-1',
  webhookId: null,
  bindings: [{ guildId: 5, tagId: null, boundAt: new Date(0) }],
};
const thread: InboundThread = {
  id: POST,
  parentId: 'forum-1',
  name: 'Raid night',
  appliedTags: [],
  pinned: false,
  archived: false,
};

function message(id: string): InboundMessage {
  return {
    id,
    threadId: POST,
    authorId: 'u1',
    authorName: 'Ana',
    authorAvatar: null,
    webhookId: null,
    content: 'hello',
    mentions: new Map(),
    attachments: [],
  };
}

const postLink: ForumLink = {
  id: 9,
  guildId: 5,
  kind: 'thread',
  threadId: 40,
  replyId: null,
  discordThreadId: POST,
  discordMessageId: POST,
  origin: 'discord',
  syncState: 'synced',
  attempts: 0,
  lastError: null,
  syncedAt: null,
  discordDeletedAt: null,
  discordLockedAt: null,
  createdAt: new Date(0),
};

function makeIngest() {
  const routes = { resolve: jest.fn(() => Promise.resolve(route)) };
  const gate = { admits: jest.fn(() => Promise.resolve(true)) };
  return new HubForumDiscordInboundIngest(
    {} as unknown as ForumDiscordDb,
    routes as unknown as HubForumDiscordRouteResolver,
    {} as unknown as HubForumDiscordPinSync,
    {} as unknown as HubForumDiscordNotices,
    gate as unknown as HubForumDiscordEventGate,
  );
}

beforeEach(() => {
  jest.resetAllMocks();
  w.findLinkByMessage.mockResolvedValue(null);
  w.userIdForDiscord.mockResolvedValue(null);
});

describe('isUniqueViolation', () => {
  it.each([
    ['bare 23505', { code: '23505' }, true],
    ['23505 wrapped in cause', wrapped23505, true],
    ['23505 two causes deep', { cause: { cause: { code: '23505' } } }, true],
    ['another SQLSTATE', { code: '23503', cause: { code: '42P01' } }, false],
    ['not an object', '23505', false],
  ])('%s → %s', (_label, err, want) => {
    expect(isUniqueViolation(err)).toBe(want);
  });
});

describe('HubForumDiscordInboundIngest.onCreate — starter import race', () => {
  it('a reply still imports when its missed starter loses the race', async () => {
    w.findPostLink.mockResolvedValueOnce(null).mockResolvedValueOnce(postLink);
    w.insertDiscordThread.mockRejectedValue(wrapped23505);
    w.insertDiscordReply.mockResolvedValue(77);
    const starter = () => Promise.resolve(message(POST));
    const ctx = { botUserId: 'bot', fetchStarter: starter };
    const got = makeIngest().onCreate(
      message('1300000000000000001'),
      thread,
      ctx,
    );
    await expect(got).resolves.toBe('imported');
    expect(w.insertDiscordReply).toHaveBeenCalledTimes(1);
  });

  it("the starter's own event skips when a reply already imported it", async () => {
    w.findPostLink.mockResolvedValue(null);
    w.insertDiscordThread.mockRejectedValue(wrapped23505);
    const got = makeIngest().onCreate(message(POST), thread, {
      botUserId: 'bot',
    });
    await expect(got).resolves.toBe('skipped');
  });

  it('ROK-2272 S3: an event-planning registry post is never imported', async () => {
    w.findPostLink.mockResolvedValue(null);
    w.isEventPlanningPost.mockResolvedValue(true);
    const got = makeIngest().onCreate(message(POST), thread, {
      botUserId: 'bot',
    });
    await expect(got).resolves.toBe('skipped');
    expect(w.isEventPlanningPost).toHaveBeenCalledWith(expect.anything(), POST);
    expect(w.insertDiscordThread).not.toHaveBeenCalled();
  });

  it('any other insert failure still throws', async () => {
    w.findPostLink.mockResolvedValue(null);
    w.insertDiscordThread.mockRejectedValue(new Error('connection lost'));
    const run = makeIngest().onCreate(message(POST), thread, {
      botUserId: 'bot',
    });
    await expect(run).rejects.toThrow('connection lost');
  });
});

describe('HubForumDiscordInboundIngest.onThreadDelete — outbound 404 stamp', () => {
  const stamped: ForumLink = { ...postLink, discordDeletedAt: new Date(1) };

  it('a link stamped by an outbound 404 still removes the live RL thread', async () => {
    w.findPostLink.mockResolvedValue(stamped);
    w.removeFromDiscord.mockResolvedValue(true);
    const now = new Date(2);
    await expect(makeIngest().onThreadDelete(thread, now)).resolves.toBe(
      'deleted',
    );
    expect(w.removeFromDiscord).toHaveBeenCalledWith(
      expect.anything(),
      stamped,
      'moderator',
      now,
    );
  });

  it('a stamped link whose RL thread is already removed skips', async () => {
    w.findPostLink.mockResolvedValue(stamped);
    w.removeFromDiscord.mockResolvedValue(false);
    await expect(makeIngest().onThreadDelete(thread)).resolves.toBe('skipped');
  });

  it('a post outside the current binding skips without removing', async () => {
    w.findPostLink.mockResolvedValue(stamped);
    const off = { ...thread, parentId: null };
    await expect(makeIngest().onThreadDelete(off)).resolves.toBe('skipped');
    expect(w.removeFromDiscord).not.toHaveBeenCalled();
  });
});
