import type Redis from 'ioredis';
import type { SettingsService } from '../../../settings/settings.service';
import { findLivePollThread } from '../subject-discussion/poll-discussion.queries';
import {
  closingOnceKey,
  HubForumDiscordClosingLines,
} from './hub-forum-discord-closing-lines.service';
import { findThreadLink } from './hub-forum-discord-links.queries';
import type { HubForumDiscordOutboundGateway } from './hub-forum-discord-outbound.discord';
import type { HubForumDiscordOutboundService } from './hub-forum-discord-outbound.service';
import type { ForumDiscordDb } from './hub-forum-discord.queries';

jest.mock('./hub-forum-discord-links.queries', () => ({
  ...jest.requireActual('./hub-forum-discord-links.queries'),
  findThreadLink: jest.fn(),
}));
jest.mock('../subject-discussion/poll-discussion.queries', () => ({
  findLivePollThread: jest.fn(),
  findPollForSync: jest.fn(),
}));
jest.mock('../../../settings/settings-bot.helpers', () => ({
  getClientUrl: jest.fn().mockResolvedValue('https://rl.example'),
}));

const findLink = jest.mocked(findThreadLink);
const findPoll = jest.mocked(findLivePollThread);

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
    del: jest.fn((key: string) => Promise.resolve(store.delete(key) ? 1 : 0)),
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

beforeEach(() => jest.clearAllMocks());

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

  it('releases the key when the send fails so a retry can post', async () => {
    const { svc, gateway, redis } = build();
    findLink.mockResolvedValue(sentLink() as never);
    gateway.mention.mockRejectedValueOnce(new Error('discord down'));
    await expect(svc.postClosingLine(5, 'bye', 'k')).rejects.toThrow(
      'discord down',
    );
    expect(redis.store.has(closingOnceKey(5, 'k'))).toBe(false);
    await expect(svc.postClosingLine(5, 'bye', 'k')).resolves.toBe('posted');
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

  it('an eventless lock-in posts nothing and reads nothing', async () => {
    const { svc, gateway } = build();
    await svc.pollLockedIn(4, null);
    expect(findPoll).not.toHaveBeenCalled();
    expect(gateway.mention).not.toHaveBeenCalled();
  });
});
