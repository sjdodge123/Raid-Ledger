/**
 * ROK-2272 S10 (R5) — `HubForumDiscordPollVoterPings` (unit): the hub and
 * registry arms, the once-key claim, and every no-ping branch.
 */
import { Logger } from '@nestjs/common';
import { DiscordAPIError } from 'discord.js';
import type Redis from 'ioredis';
import { findLivePollThread } from '../subject-discussion/poll-discussion.queries';
import { markPlanningPostDeleted } from './event-planning-posts.queries';
import type { EventPlanningSubjectPosts } from './event-planning-posts.subjects';
import { UNSENT_PREFIX } from './hub-forum-discord-links.queries';
import type { HubForumDiscordOutboundGateway } from './hub-forum-discord-outbound.discord';
import type { HubForumDiscordOutboundService } from './hub-forum-discord-outbound.service';
import { voterOnceKey } from './hub-forum-discord-poll-voter-pings';
import { HubForumDiscordPollVoterPings } from './hub-forum-discord-poll-voter-pings.service';
import type { ForumDiscordDb } from './hub-forum-discord.queries';

jest.mock('../subject-discussion/poll-discussion.queries', () => ({
  findLivePollThread: jest.fn(),
}));
jest.mock('./event-planning-posts.queries', () => ({
  markPlanningPostDeleted: jest.fn().mockResolvedValue(undefined),
}));

const findThread = jest.mocked(findLivePollThread);
const markDeleted = jest.mocked(markPlanningPostDeleted);

const DISCORD_ID = '123456789012345678';
const vote = { matchId: 7, lineupId: 3, userId: 11, stance: 'yes' } as const;
const cleared = { ...vote, stance: null };

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

/** A db whose only read is `users.discord_id` for one user. */
function fakeDb(discordId: string | null) {
  const rows = [{ discordId }];
  const chain = {
    select: () => chain,
    from: () => chain,
    where: () => chain,
    limit: () => Promise.resolve(rows),
  };
  return chain;
}

function livePlanningRow(over: Record<string, unknown> = {}) {
  return { id: 40, discordLockedAt: null, ...over } as unknown as Awaited<
    ReturnType<EventPlanningSubjectPosts['livePollPostOnPath']>
  >;
}

function hubLink(over: Record<string, unknown> = {}) {
  return {
    discordThreadId: 'hub-d-thread',
    discordMessageId: '111',
    discordDeletedAt: null,
    discordLockedAt: null,
    ...over,
  };
}

function build(opts: { online?: boolean; discordId?: string | null } = {}) {
  const gateway = {
    isOnline: jest.fn().mockReturnValue(opts.online ?? true),
    mention: jest.fn().mockResolvedValue(undefined),
  };
  const outbound = { ensureEventPost: jest.fn().mockResolvedValue(hubLink()) };
  const subjects = {
    ensurePollPost: jest.fn().mockResolvedValue({
      postId: 40,
      forumId: 1,
      discordThreadId: 'reg-d-thread',
    }),
    livePollPostOnPath: jest.fn().mockResolvedValue(livePlanningRow()),
  };
  const redis = fakeRedis();
  const db = fakeDb(opts.discordId === undefined ? DISCORD_ID : opts.discordId);
  const svc = new HubForumDiscordPollVoterPings(
    db as unknown as ForumDiscordDb,
    outbound as unknown as HubForumDiscordOutboundService,
    subjects as unknown as EventPlanningSubjectPosts,
    gateway as unknown as HubForumDiscordOutboundGateway,
    redis as unknown as Redis,
  );
  return { svc, gateway, outbound, subjects, redis };
}

beforeEach(() => {
  findThread.mockResolvedValue({ id: 5, guildId: 2 } as unknown as Awaited<
    ReturnType<typeof findLivePollThread>
  >);
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.clearAllMocks();
  jest.restoreAllMocks();
});

describe('HubForumDiscordPollVoterPings.hubVote', () => {
  it('creates the hub post and pings the voter once, mentioning only them', async () => {
    const { svc, gateway, outbound, redis } = build();
    expect(await svc.hubVote(vote)).toBe('pinged');
    expect(outbound.ensureEventPost).toHaveBeenCalledWith({
      guildId: 2,
      threadId: 5,
    });
    expect(gateway.mention).toHaveBeenCalledWith(
      'hub-d-thread',
      `\u{1F5F3} <@${DISCORD_ID}> voted`,
      [DISCORD_ID],
    );
    expect(redis.store.has(voterOnceKey({ hubThreadId: 5 }, 11))).toBe(true);
    expect(await svc.hubVote(vote)).toBe('already');
    expect(gateway.mention).toHaveBeenCalledTimes(1);
  });

  it('a cleared tap still creates the post (S8) but pings nothing', async () => {
    const { svc, gateway, outbound, redis } = build();
    expect(await svc.hubVote(cleared)).toBe('cleared');
    expect(outbound.ensureEventPost).toHaveBeenCalledTimes(1);
    expect(gateway.mention).not.toHaveBeenCalled();
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('no live hub thread ⇒ no post, no ping', async () => {
    findThread.mockResolvedValue(null);
    const { svc, outbound, gateway } = build();
    expect(await svc.hubVote(vote)).toBe('no-post');
    expect(outbound.ensureEventPost).not.toHaveBeenCalled();
    expect(gateway.mention).not.toHaveBeenCalled();
  });

  it.each([
    ['locked', { discordLockedAt: new Date() }, 'closed-post'],
    ['deleted', { discordDeletedAt: new Date() }, 'closed-post'],
    ['unsent', { discordMessageId: `${UNSENT_PREFIX}abc` }, 'pending'],
  ])(
    'a %s hub post pings nothing and claims nothing',
    async (_l, over, want) => {
      const { svc, gateway, outbound, redis } = build();
      outbound.ensureEventPost.mockResolvedValue(hubLink(over));
      expect(await svc.hubVote(vote)).toBe(want);
      expect(gateway.mention).not.toHaveBeenCalled();
      expect(redis.set).not.toHaveBeenCalled();
    },
  );
});

describe('HubForumDiscordPollVoterPings.planningVote', () => {
  it('ensures the registry post and pings into it', async () => {
    const { svc, gateway, subjects, redis } = build();
    expect(await svc.planningVote(vote)).toBe('pinged');
    expect(subjects.ensurePollPost).toHaveBeenCalledWith(7);
    expect(gateway.mention).toHaveBeenCalledWith(
      'reg-d-thread',
      `\u{1F5F3} <@${DISCORD_ID}> voted`,
      [DISCORD_ID],
    );
    expect(redis.store.has(voterOnceKey({ planningPostId: 40 }, 11))).toBe(
      true,
    );
  });

  it('a cleared tap neither creates a post nor pings', async () => {
    const { svc, subjects, gateway } = build();
    expect(await svc.planningVote(cleared)).toBe('cleared');
    expect(subjects.ensurePollPost).not.toHaveBeenCalled();
    expect(gateway.mention).not.toHaveBeenCalled();
  });

  it('no eligible post ⇒ no ping', async () => {
    const { svc, subjects, gateway } = build();
    subjects.ensurePollPost.mockResolvedValue(null);
    expect(await svc.planningVote(vote)).toBe('no-post');
    expect(gateway.mention).not.toHaveBeenCalled();
  });

  it('a locked registry post pings nothing and claims nothing', async () => {
    const { svc, gateway, redis, subjects } = build();
    subjects.livePollPostOnPath.mockResolvedValue(
      livePlanningRow({ discordLockedAt: new Date() }),
    );
    expect(await svc.planningVote(vote)).toBe('closed-post');
    expect(gateway.mention).not.toHaveBeenCalled();
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('a gone registry thread marks the row deleted and releases the key', async () => {
    const { svc, gateway, redis } = build();
    gateway.mention.mockRejectedValue(
      new DiscordAPIError(
        { code: 10003, message: 'Unknown Channel' },
        10003,
        404,
        'POST',
        '/x',
        {},
      ),
    );
    expect(await svc.planningVote(vote)).toBe('send-failed');
    expect(markDeleted).toHaveBeenCalledWith(
      expect.anything(),
      40,
      expect.any(Date),
    );
    expect(redis.store.size).toBe(0);
  });
});

describe('HubForumDiscordPollVoterPings.planningVote — off the planning path', () => {
  it('a poll hub-tagged or made private after its post exists pings nothing (MINOR-1)', async () => {
    const { svc, gateway, redis, subjects } = build();
    subjects.livePollPostOnPath.mockResolvedValue(null);
    expect(await svc.planningVote(vote)).toBe('no-post');
    expect(subjects.livePollPostOnPath).toHaveBeenCalledWith(7);
    expect(gateway.mention).not.toHaveBeenCalled();
    expect(redis.set).not.toHaveBeenCalled();
  });
});

describe('HubForumDiscordPollVoterPings — no-ping branches of ping()', () => {
  it.each([null, 'local:alice', 'unlinked:9'])(
    'an unlinked user (%p) is not pinged and claims nothing',
    async (discordId) => {
      const { svc, gateway, redis } = build({ discordId });
      expect(await svc.planningVote(vote)).toBe('unlinked');
      expect(gateway.mention).not.toHaveBeenCalled();
      expect(redis.set).not.toHaveBeenCalled();
    },
  );

  it('an offline bot claims nothing, so the next vote pings', async () => {
    const { svc, gateway, redis } = build({ online: false });
    expect(await svc.hubVote(vote)).toBe('offline');
    expect(redis.set).not.toHaveBeenCalled();
    gateway.isOnline.mockReturnValue(true);
    expect(await svc.hubVote(vote)).toBe('pinged');
  });

  it('a send failure DELs the key and warns; a hub post is never marked deleted', async () => {
    const { svc, gateway, redis } = build();
    gateway.mention.mockRejectedValueOnce(new Error('rate limited'));
    expect(await svc.hubVote(vote)).toBe('send-failed');
    expect(redis.store.size).toBe(0);
    expect(markDeleted).not.toHaveBeenCalled();
    expect(Logger.prototype.warn).toHaveBeenCalledWith(
      expect.stringContaining('rate limited'),
    );
    expect(await svc.hubVote(vote)).toBe('pinged');
  });
});
