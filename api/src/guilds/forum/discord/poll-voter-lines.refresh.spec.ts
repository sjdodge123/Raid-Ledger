/**
 * ROK-2295 lane C — `PollVoterLines`: a stored voted line is edited in
 * place only when the voter's slots changed; a vanished message drops its
 * hash field; a post with no hash (lines sent before this story) is left
 * alone; nothing here ever throws into the poll-card job.
 */
import { Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import type { HubForumDiscordOutboundGateway } from './hub-forum-discord-outbound.discord';
import { voterLinesKey } from './hub-forum-discord-poll-voter-pings';
import type { ForumDiscordDb } from './hub-forum-discord.queries';
import { PollVoterLines } from './poll-voter-lines.refresh';

const POST = 'd-post-1';
const KEY = voterLinesKey(POST);
const A = '2026-11-23T18:00:00.000Z';
const B = '2026-11-24T18:00:00.000Z';
const t = (iso: string) => `<t:${Date.parse(iso) / 1000}:f>`;

/** A db whose one read is the joined `yes` votes: `rows` as given. */
function fakeDb(rows: { userId: number; at: Date }[]) {
  const chain = {
    select: () => chain,
    from: () => chain,
    innerJoin: () => chain,
    where: () => chain,
    orderBy: () => Promise.resolve(rows),
  };
  return chain;
}

function fakeRedis(hash: Record<string, string> = {}) {
  const store = new Map<string, Record<string, string>>([[KEY, { ...hash }]]);
  return {
    store,
    hgetall: jest.fn((k: string) => Promise.resolve(store.get(k) ?? {})),
    hset: jest.fn((k: string, f: Record<string, string>) => {
      store.set(k, { ...(store.get(k) ?? {}), ...f });
      return Promise.resolve(1);
    }),
    hdel: jest.fn((k: string, field: string) => {
      const { [field]: _gone, ...rest } = store.get(k) ?? {};
      store.set(k, rest);
      return Promise.resolve(1);
    }),
    expire: jest.fn().mockResolvedValue(1),
  };
}

const stored = (slots: string[], messageId = 'line-1') =>
  JSON.stringify({ messageId, discordId: '99', slots });

function setup(rows: { userId: number; at: Date }[], hash = {}) {
  const gateway = {
    isOnline: jest.fn().mockReturnValue(true),
    editBotMessage: jest.fn().mockResolvedValue('ok'),
  };
  const redis = fakeRedis(hash);
  const lines = new PollVoterLines(
    fakeDb(rows) as unknown as ForumDiscordDb,
    gateway as unknown as HubForumDiscordOutboundGateway,
    redis as unknown as Redis,
  );
  return { lines, gateway, redis };
}

beforeEach(() => {
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('PollVoterLines.refreshVoterLines', () => {
  it('changed slots ⇒ exactly one in-place edit, and the new slots are stored', async () => {
    const rows = [
      { userId: 11, at: new Date(A) },
      { userId: 11, at: new Date(B) },
    ];
    const { lines, gateway, redis } = setup(rows, { '11': stored([A]) });
    await lines.refreshVoterLines(7, POST);
    expect(gateway.editBotMessage).toHaveBeenCalledTimes(1);
    expect(gateway.editBotMessage).toHaveBeenCalledWith(
      POST,
      'line-1',
      `\u{1F5F3} <@99> voted: ${t(A)}, ${t(B)}`,
    );
    expect(redis.store.get(KEY)?.['11']).toBe(stored([A, B]));
  });

  it('unchanged slots ⇒ no edit', async () => {
    const rows = [{ userId: 11, at: new Date(A) }];
    const { lines, gateway } = setup(rows, { '11': stored([A]) });
    await lines.refreshVoterLines(7, POST);
    expect(gateway.editBotMessage).not.toHaveBeenCalled();
  });

  it('every slot withdrawn ⇒ the line says "no times right now"', async () => {
    const { lines, gateway } = setup([], { '11': stored([A]) });
    await lines.refreshVoterLines(7, POST);
    expect(gateway.editBotMessage).toHaveBeenCalledWith(
      POST,
      'line-1',
      '\u{1F5F3} <@99> voted: no times right now',
    );
  });

  it('a vanished message (gone) drops that voter’s hash field', async () => {
    const { lines, gateway, redis } = setup([], { '11': stored([A]) });
    gateway.editBotMessage.mockResolvedValue('gone');
    await lines.refreshVoterLines(7, POST);
    expect(redis.hdel).toHaveBeenCalledWith(KEY, '11');
    expect(redis.store.get(KEY)).toEqual({});
  });

  it('a legacy post with no hash entry ⇒ no edit', async () => {
    const { lines, gateway } = setup([{ userId: 11, at: new Date(A) }]);
    await lines.refreshVoterLines(7, POST);
    expect(gateway.editBotMessage).not.toHaveBeenCalled();
  });

  it('one failed edit is logged; the next voter still gets theirs; never throws', async () => {
    const hash = { '11': stored([A]), '12': stored([A], 'line-2') };
    const { lines, gateway } = setup([], hash);
    gateway.editBotMessage.mockRejectedValueOnce(new Error('rate limited'));
    await expect(lines.refreshVoterLines(7, POST)).resolves.toBeUndefined();
    expect(gateway.editBotMessage).toHaveBeenCalledTimes(2);
  });

  it('bot offline ⇒ nothing read, nothing edited', async () => {
    const { lines, gateway, redis } = setup([], { '11': stored([A]) });
    gateway.isOnline.mockReturnValue(false);
    await lines.refreshVoterLines(7, POST);
    expect(redis.hgetall).not.toHaveBeenCalled();
    expect(gateway.editBotMessage).not.toHaveBeenCalled();
  });
});

describe('PollVoterLines.store', () => {
  it('writes the field and keeps the hash 30 days', async () => {
    const { lines, redis } = setup([]);
    const line = { messageId: 'm', discordId: '99', slots: [A] };
    await lines.store(POST, 11, line);
    expect(redis.store.get(KEY)?.['11']).toBe(JSON.stringify(line));
    expect(redis.expire).toHaveBeenCalledWith(KEY, 30 * 24 * 3600);
  });
});
