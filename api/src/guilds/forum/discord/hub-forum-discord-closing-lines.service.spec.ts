import { Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import type { SettingsService } from '../../../settings/settings.service';
import { findLiveLineupThread } from '../subject-discussion/lineup-discussion.queries';
import { findLivePollThread } from '../subject-discussion/poll-discussion.queries';
import { findLivePlanningPost } from './event-planning-posts.queries';
import {
  closingOnceKey,
  HubForumDiscordClosingLines,
  planningClosingOnceKey,
} from './hub-forum-discord-closing-lines.service';
import {
  findThreadLink,
  isCurrentBindingLink,
} from './hub-forum-discord-links.queries';
import type { HubForumDiscordOutboundGateway } from './hub-forum-discord-outbound.discord';
import type { HubForumDiscordOutboundService } from './hub-forum-discord-outbound.service';
import type { ForumDiscordDb } from './hub-forum-discord.queries';

jest.mock('./hub-forum-discord-links.queries', () => ({
  ...jest.requireActual('./hub-forum-discord-links.queries'),
  findThreadLink: jest.fn(),
  isCurrentBindingLink: jest.fn(),
}));
jest.mock('../subject-discussion/poll-discussion.queries', () => ({
  findLivePollThread: jest.fn(),
  findPollForSync: jest.fn(),
}));
jest.mock('../subject-discussion/lineup-discussion.queries', () => ({
  findLiveLineupThread: jest.fn(),
}));
jest.mock('./event-planning-posts.queries', () => ({
  findLivePlanningPost: jest.fn(),
}));
jest.mock('../../../settings/settings-bot.helpers', () => ({
  getClientUrl: jest.fn().mockResolvedValue('https://rl.example'),
}));

const findLink = jest.mocked(findThreadLink);
const currentBinding = jest.mocked(isCurrentBindingLink);
const findPoll = jest.mocked(findLivePollThread);
const findLineup = jest.mocked(findLiveLineupThread);
const findPlanning = jest.mocked(findLivePlanningPost);

function sentLink(over: Record<string, unknown> = {}) {
  return {
    discordThreadId: 'd-thread',
    discordMessageId: '111',
    discordDeletedAt: null,
    discordLockedAt: null,
    ...over,
  };
}

function fakeRedis() {
  const store = new Map<string, string>();
  return {
    store,
    set: jest.fn((key: string, value: string, ...args: unknown[]) => {
      if (args.includes('NX') && store.has(key)) return Promise.resolve(null);
      store.set(key, value);
      return Promise.resolve('OK');
    }),
    del: jest.fn((...keys: string[]) =>
      Promise.resolve(keys.filter((k) => store.delete(k)).length),
    ),
  };
}

function build(online = true) {
  const gateway = {
    isOnline: jest.fn().mockReturnValue(online),
    mention: jest.fn().mockResolvedValue(undefined),
  };
  const outbound = { ensureEventPost: jest.fn().mockResolvedValue(null) };
  const redis = fakeRedis();
  const svc = new HubForumDiscordClosingLines(
    {} as unknown as ForumDiscordDb,
    outbound as unknown as HubForumDiscordOutboundService,
    gateway as unknown as HubForumDiscordOutboundGateway,
    redis as unknown as Redis,
    {} as unknown as SettingsService,
  );
  return { svc, gateway, outbound, redis };
}

beforeEach(() => {
  jest.clearAllMocks();
  currentBinding.mockResolvedValue(true);
  findPlanning.mockResolvedValue(null);
});

describe('postClosingLine (ROK-2272 S8)', () => {
  it.each([
    ['no link', null, 'no-post'],
    ['an unsent link', sentLink({ discordMessageId: 'rl:t:5' }), 'no-post'],
    [
      'a deleted post',
      sentLink({ discordDeletedAt: new Date() }),
      'closed-post',
    ],
    ['a locked post', sentLink({ discordLockedAt: new Date() }), 'closed-post'],
  ])('skips %s', async (_label, link, outcome) => {
    const { svc, gateway, redis } = build();
    findLink.mockResolvedValue(link as never);
    await expect(svc.postClosingLine(5, 'bye', 'k')).resolves.toBe(outcome);
    expect(gateway.mention).not.toHaveBeenCalled();
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('D9: skips a post from a previous binding without claiming the key', async () => {
    const { svc, gateway, redis } = build();
    const link = sentLink();
    findLink.mockResolvedValue(link as never);
    currentBinding.mockResolvedValue(false);
    await expect(svc.postClosingLine(5, 'bye', 'k')).resolves.toBe('no-post');
    expect(currentBinding).toHaveBeenCalledWith(expect.anything(), link);
    expect(gateway.mention).not.toHaveBeenCalled();
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('skips when the bot is offline, without claiming the key', async () => {
    const { svc, gateway, redis } = build(false);
    findLink.mockResolvedValue(sentLink() as never);
    await expect(svc.postClosingLine(5, 'bye', 'k')).resolves.toBe('offline');
    expect(gateway.mention).not.toHaveBeenCalled();
    expect(redis.store.size).toBe(0);
  });

  it('posts once per onceKey, with no mentions allowed', async () => {
    const { svc, gateway } = build();
    findLink.mockResolvedValue(sentLink() as never);
    await expect(svc.postClosingLine(5, 'bye', 'k')).resolves.toBe('posted');
    await expect(svc.postClosingLine(5, 'bye', 'k')).resolves.toBe('already');
    await expect(svc.postClosingLine(5, 'other', 'k2')).resolves.toBe('posted');
    expect(gateway.mention.mock.calls).toEqual([
      ['d-thread', 'bye', []],
      ['d-thread', 'other', []],
    ]);
  });

  it('a failed send releases the key and warns once, naming thread and line', async () => {
    const { svc, gateway, redis } = build();
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    findLink.mockResolvedValue(sentLink() as never);
    gateway.mention.mockRejectedValueOnce(new Error('discord down'));
    await expect(svc.postClosingLine(5, 'bye', 'cancelled')).resolves.toBe(
      'send-failed',
    );
    expect(redis.store.has(closingOnceKey(5, 'cancelled'))).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    const [msg] = warn.mock.calls[0] ?? [];
    expect(msg).toEqual(expect.stringContaining('thread #5'));
    expect(msg).toEqual(expect.stringContaining('cancelled'));
    expect(msg).toEqual(expect.stringContaining('discord down'));
    await expect(svc.postClosingLine(5, 'bye', 'cancelled')).resolves.toBe(
      'posted',
    );
    warn.mockRestore();
  });
});

describe('subject entry points (ROK-2272 S8)', () => {
  const thread = {
    id: 8,
    guildId: 3,
    title: 't',
    body: 'b',
    writeClosesAt: null,
  };

  it('first vote ensures the post of the live poll thread', async () => {
    const { svc, outbound } = build();
    findPoll.mockResolvedValue(thread);
    await svc.firstVote(4);
    expect(outbound.ensureEventPost).toHaveBeenCalledWith({
      guildId: 3,
      threadId: 8,
    });
  });

  it('first vote with no live thread does nothing', async () => {
    const { svc, outbound } = build();
    findPoll.mockResolvedValue(null);
    await svc.firstVote(4);
    expect(outbound.ensureEventPost).not.toHaveBeenCalled();
  });

  it('cancel posts the reason line once', async () => {
    const { svc, gateway } = build();
    findPoll.mockResolvedValue(thread);
    findLink.mockResolvedValue(sentLink() as never);
    await svc.pollCancelled(4, 'Nobody free');
    await svc.pollCancelled(4, 'Nobody free');
    expect(gateway.mention.mock.calls).toEqual([
      ['d-thread', 'Poll cancelled — Nobody free', []],
    ]);
  });

  it('cancel → reopen → cancel posts two lines', async () => {
    const { svc, gateway } = build();
    findPoll.mockResolvedValue(thread);
    findLink.mockResolvedValue(sentLink() as never);
    await svc.pollCancelled(4, null);
    await svc.pollReopened(4);
    await svc.pollCancelled(4, 'Again');
    expect(gateway.mention.mock.calls).toEqual([
      ['d-thread', 'Poll cancelled', []],
      ['d-thread', 'Poll cancelled — Again', []],
    ]);
  });

  it('a lineup reopen clears its decided and aborted keys only', async () => {
    const { svc, redis } = build();
    findLineup.mockResolvedValue(thread);
    for (const k of ['decided', 'aborted', 'locked-in:9']) {
      redis.store.set(closingOnceKey(8, k), '1');
    }
    await svc.lineupReopened(2);
    expect([...redis.store.keys()]).toEqual([closingOnceKey(8, 'locked-in:9')]);
  });

  it('a reopen with no live thread clears nothing', async () => {
    const { svc, redis } = build();
    findPoll.mockResolvedValue(null);
    await svc.pollReopened(4);
    expect(redis.del).not.toHaveBeenCalled();
  });

  it('an eventless lock-in posts nothing and reads nothing', async () => {
    const { svc, gateway } = build();
    await svc.pollLockedIn(4, null);
    expect(findPoll).not.toHaveBeenCalled();
    expect(gateway.mention).not.toHaveBeenCalled();
  });
});

describe('registry planning posts (ROK-2272 S10)', () => {
  function planningRow(over: Record<string, unknown> = {}) {
    return {
      id: 41,
      subjectKind: 'poll',
      subjectId: 4,
      forumId: 1,
      discordThreadId: 'p-thread',
      closesAt: null,
      discordLockedAt: null,
      discordDeletedAt: null,
      ...over,
    };
  }

  beforeEach(() => {
    findPoll.mockResolvedValue(null);
    findLineup.mockResolvedValue(null);
  });

  it('a non-hub poll cancel posts the line once into its planning post', async () => {
    const { svc, gateway, redis } = build();
    findPlanning.mockResolvedValue(planningRow() as never);
    await svc.pollCancelled(4, 'Nobody free');
    await svc.pollCancelled(4, 'Nobody free');
    expect(findPlanning).toHaveBeenCalledWith(expect.anything(), 'poll', 4);
    expect(gateway.mention.mock.calls).toEqual([
      ['p-thread', 'Poll cancelled — Nobody free', []],
    ]);
    expect([...redis.store.keys()]).toEqual([
      'hfd:closing:planning:41:cancelled',
    ]);
    expect(findLink).not.toHaveBeenCalled();
  });

  it('a non-hub lineup abort posts into the lineup planning post', async () => {
    const { svc, gateway } = build();
    findPlanning.mockResolvedValue(
      planningRow({ subjectKind: 'lineup' }) as never,
    );
    await svc.lineupAborted(2);
    expect(findPlanning).toHaveBeenCalledWith(expect.anything(), 'lineup', 2);
    expect(gateway.mention.mock.calls).toEqual([
      ['p-thread', 'Lineup aborted', []],
    ]);
  });

  it('a locked planning post gets no line and claims no key', async () => {
    const { svc, gateway, redis } = build();
    findPlanning.mockResolvedValue(
      planningRow({ discordLockedAt: new Date() }) as never,
    );
    await svc.pollCancelled(4, null);
    expect(gateway.mention).not.toHaveBeenCalled();
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('no hub thread and no planning row: no line, no key', async () => {
    const { svc, gateway, redis } = build();
    await svc.pollCancelled(4, null);
    await svc.lineupAborted(2);
    expect(gateway.mention).not.toHaveBeenCalled();
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('offline bot: no line and the key stays unclaimed', async () => {
    const { svc, gateway, redis } = build(false);
    findPlanning.mockResolvedValue(planningRow() as never);
    await svc.pollCancelled(4, null);
    expect(gateway.mention).not.toHaveBeenCalled();
    expect(redis.store.size).toBe(0);
  });

  it('a failed send releases the planning key and names the post', async () => {
    const { svc, gateway, redis } = build();
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    findPlanning.mockResolvedValue(planningRow() as never);
    gateway.mention.mockRejectedValueOnce(new Error('discord down'));
    await svc.pollCancelled(4, null);
    expect(redis.store.has(planningClosingOnceKey(41, 'cancelled'))).toBe(
      false,
    );
    const [msg] = warn.mock.calls[0] ?? [];
    expect(msg).toEqual(expect.stringContaining('planning post #41'));
    warn.mockRestore();
  });

  it('a reopen forgets the planning end keys only (hub keys untouched)', async () => {
    const { svc, redis } = build();
    findPlanning.mockResolvedValue(
      planningRow({ subjectKind: 'lineup' }) as never,
    );
    for (const k of ['decided', 'aborted', 'locked-in:9']) {
      redis.store.set(planningClosingOnceKey(41, k), '1');
    }
    redis.store.set(closingOnceKey(41, 'decided'), '1');
    await svc.lineupReopened(2);
    expect([...redis.store.keys()].sort()).toEqual(
      [
        planningClosingOnceKey(41, 'locked-in:9'),
        closingOnceKey(41, 'decided'),
      ].sort(),
    );
  });

  it('a hub thread wins: the planning row is never read', async () => {
    const { svc, gateway } = build();
    findPoll.mockResolvedValue({
      id: 8,
      guildId: 3,
      title: 't',
      body: 'b',
      writeClosesAt: null,
    });
    findLink.mockResolvedValue(sentLink() as never);
    await svc.pollCancelled(4, null);
    expect(findPlanning).not.toHaveBeenCalled();
    expect(gateway.mention.mock.calls).toEqual([
      ['d-thread', 'Poll cancelled', []],
    ]);
  });
});
