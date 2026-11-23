/**
 * ROK-2295 review m-1 / Codex P2 — a vote change while the first voted
 * line is still being sent. The change's coalesced refresh runs before the
 * line is stored (no hash field yet ⇒ skipped), so the store would leave the
 * slots read at send time. One trailing refresh after the store re-reads
 * and edits the line in place — and only when the slots differ.
 */
import { Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import type { EventPlanningSubjectPosts } from './event-planning-posts.subjects';
import type { HubForumDiscordOutboundGateway } from './hub-forum-discord-outbound.discord';
import type { HubForumDiscordOutboundService } from './hub-forum-discord-outbound.service';
import { HubForumDiscordPollVoterPings } from './hub-forum-discord-poll-voter-pings.service';
import type { ForumDiscordDb } from './hub-forum-discord.queries';
import { PollVoterLines } from './poll-voter-lines.refresh';

const DISCORD_ID = '123456789012345678';
const vote = { matchId: 7, lineupId: 3, userId: 11, stance: 'yes' } as const;
const A = '2026-11-23T18:00:00.000Z';
const B = '2026-11-24T18:00:00.000Z';
const t = (iso: string) => `<t:${Date.parse(iso) / 1000}:f>`;
const POST = 'reg-d-thread';

/** The ping service's one read: `users.discord_id`. */
function usersDb() {
  const chain = {
    select: () => chain,
    from: () => chain,
    where: () => chain,
    limit: () => Promise.resolve([{ discordId: DISCORD_ID }]),
  };
  return chain;
}

/** `PollVoterLines`' read (joined `yes` votes): one answer per call. */
function votesDb(...answers: string[][]) {
  const orderBy = jest.fn();
  for (const slots of answers) {
    orderBy.mockResolvedValueOnce(
      slots.map((iso) => ({ userId: 11, at: new Date(iso) })),
    );
  }
  const chain = {
    select: () => chain,
    from: () => chain,
    innerJoin: () => chain,
    where: () => chain,
    orderBy,
  };
  return chain;
}

function fakeRedis() {
  const keys = new Map<string, string>();
  const hashes = new Map<string, Record<string, string>>();
  return {
    set: jest.fn((key: string, value: string) => {
      if (keys.has(key)) return Promise.resolve(null);
      keys.set(key, value);
      return Promise.resolve('OK');
    }),
    del: jest.fn(() => Promise.resolve(1)),
    hgetall: jest.fn((k: string) => Promise.resolve(hashes.get(k) ?? {})),
    hset: jest.fn((k: string, f: Record<string, string>) => {
      hashes.set(k, { ...(hashes.get(k) ?? {}), ...f });
      return Promise.resolve(1);
    }),
    hdel: jest.fn(() => Promise.resolve(1)),
    expire: jest.fn(() => Promise.resolve(1)),
  };
}

function build(...answers: string[][]) {
  const gateway = {
    isOnline: jest.fn().mockReturnValue(true),
    mention: jest.fn().mockResolvedValue('line-msg-1'),
    editBotMessage: jest.fn().mockResolvedValue('ok'),
  };
  const redis = fakeRedis();
  const lines = new PollVoterLines(
    votesDb(...answers) as unknown as ForumDiscordDb,
    gateway as unknown as HubForumDiscordOutboundGateway,
    redis as unknown as Redis,
  );
  const subjects = {
    ensurePollPost: jest.fn().mockResolvedValue({
      postId: 40,
      forumId: 1,
      discordThreadId: POST,
    }),
    livePollPostOnPath: jest
      .fn()
      .mockResolvedValue({ id: 40, discordLockedAt: null }),
  };
  const svc = new HubForumDiscordPollVoterPings(
    usersDb() as unknown as ForumDiscordDb,
    {} as unknown as HubForumDiscordOutboundService,
    subjects as unknown as EventPlanningSubjectPosts,
    gateway as unknown as HubForumDiscordOutboundGateway,
    redis as unknown as Redis,
    lines,
  );
  return { svc, gateway };
}

beforeEach(() => {
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('ROK-2295 m-1: the first voted line is re-checked after it is stored', () => {
  it('slots changed during the send ⇒ the stored line is edited once to the new slots', async () => {
    const { svc, gateway } = build([A], [A, B]);
    expect(await svc.planningVote(vote)).toBe('pinged');
    expect(gateway.mention).toHaveBeenCalledWith(
      POST,
      `\u{1F5F3} <@${DISCORD_ID}> voted: ${t(A)}`,
      [DISCORD_ID],
    );
    expect(gateway.editBotMessage).toHaveBeenCalledTimes(1);
    expect(gateway.editBotMessage).toHaveBeenCalledWith(
      POST,
      'line-msg-1',
      `\u{1F5F3} <@${DISCORD_ID}> voted: ${t(A)}, ${t(B)}`,
    );
  });

  it('slots unchanged ⇒ no edit', async () => {
    const { svc, gateway } = build([A], [A]);
    expect(await svc.planningVote(vote)).toBe('pinged');
    expect(gateway.editBotMessage).not.toHaveBeenCalled();
  });
});
