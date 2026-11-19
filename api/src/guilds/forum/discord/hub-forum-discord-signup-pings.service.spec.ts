import * as q from './hub-forum-discord-signup-pings.queries';
import * as links from './hub-forum-discord-links.queries';
import { HubForumDiscordSignupPings } from './hub-forum-discord-signup-pings.service';
import { MENTION_PREFIX, pingedSetKey } from './hub-forum-discord-signup-pings';
import type { HubForumDiscordOutboundService } from './hub-forum-discord-outbound.service';
import type { HubForumDiscordOutboundGateway } from './hub-forum-discord-outbound.discord';
import type { ForumDiscordDb } from './hub-forum-discord.queries';
import type Redis from 'ioredis';

jest.mock('./hub-forum-discord-signup-pings.queries');
jest.mock('./hub-forum-discord-links.queries', () => ({
  ...jest.requireActual('./hub-forum-discord-links.queries'),
  findThreadLink: jest.fn(),
}));

const A = '100000000000000001';
const B = '100000000000000002';
const REF = {
  guildId: 7,
  threadId: 70,
  endsAt: new Date('2026-12-01T00:00:00Z'),
  cancelled: false,
};
const POST: links.ForumLink = {
  id: 1,
  guildId: 7,
  kind: 'thread',
  threadId: 70,
  replyId: null,
  discordThreadId: 'dthread',
  discordMessageId: 'dmsg',
  origin: 'raidledger',
  syncState: 'synced',
  attempts: 0,
  lastError: null,
  syncedAt: null,
  discordDeletedAt: null,
  discordLockedAt: null,
  createdAt: new Date(0),
};

const row = (status: string, id: string) => ({
  status,
  userDiscordId: id,
  discordUserId: null,
});

function setup(pinged: string[] = [], online = true) {
  // Key-aware, so a set scoped to another post is a different set (P2-4).
  const set = new Set(pinged);
  const sets = new Map([[pingedSetKey(5, REF), set]]);
  const at = (k: string): Set<string> => {
    const found = sets.get(k) ?? new Set<string>();
    sets.set(k, found);
    return found;
  };
  const redis = {
    smembers: jest.fn((k: string) => Promise.resolve([...at(k)])),
    sadd: jest.fn((k: string, ...ids: string[]) => {
      ids.forEach((i) => at(k).add(i));
      return Promise.resolve(ids.length);
    }),
    srem: jest.fn((k: string, ...ids: string[]) => {
      ids.forEach((i) => at(k).delete(i));
      return Promise.resolve(ids.length);
    }),
    pexpireat: jest.fn(() => Promise.resolve(1)),
  };
  const outbound = {
    ensureEventPost: jest.fn((): Promise<links.ForumLink | null> =>
      Promise.resolve(POST),
    ),
  };
  const gateway = {
    isOnline: jest.fn(() => online),
    mention: jest.fn(() => Promise.resolve()),
    removeThreadMembers: jest.fn((_post: string, ids: string[]) =>
      Promise.resolve(ids),
    ),
  };
  const svc = new HubForumDiscordSignupPings(
    {} as ForumDiscordDb,
    outbound as unknown as HubForumDiscordOutboundService,
    gateway as unknown as HubForumDiscordOutboundGateway,
    redis as unknown as Redis,
  );
  return { svc, redis, outbound, gateway, set };
}

const mockedQ = jest.mocked(q);
const mockedLinks = jest.mocked(links);

beforeEach(() => {
  jest.resetAllMocks();
  mockedQ.findBoundEventThread.mockResolvedValue(REF);
  mockedQ.listSignupPingRows.mockResolvedValue([]);
  mockedLinks.findThreadLink.mockResolvedValue(POST);
});

describe('ROK-2260 HubForumDiscordSignupPings.flush', () => {
  it('is a no-op for an event whose hub is not bound', async () => {
    mockedQ.findBoundEventThread.mockResolvedValue(null);
    const t = setup();
    expect(await t.svc.flush(5)).toBe('unbound');
    expect(t.outbound.ensureEventPost).not.toHaveBeenCalled();
    expect(t.gateway.mention).not.toHaveBeenCalled();
  });

  it('first signups create the post and get ONE roll-up mention, then are remembered', async () => {
    mockedQ.listSignupPingRows.mockResolvedValue([
      row('signed_up', A),
      row('tentative', B),
    ]);
    const t = setup();
    expect(await t.svc.flush(5)).toBe('pinged');
    expect(t.outbound.ensureEventPost).toHaveBeenCalledWith({
      guildId: 7,
      threadId: 70,
      create: true,
    });
    expect(t.gateway.mention).toHaveBeenCalledTimes(1);
    expect(t.gateway.mention).toHaveBeenCalledWith(
      'dthread',
      `${MENTION_PREFIX} <@${A}> <@${B}>`,
      [A, B],
    );
    expect([...t.set]).toEqual([A, B]);
    expect(t.redis.sadd).toHaveBeenCalledWith(pingedSetKey(5, REF), A, B);
    expect(t.redis.pexpireat).toHaveBeenCalled();
  });

  it('never pings someone twice', async () => {
    mockedQ.listSignupPingRows.mockResolvedValue([
      row('signed_up', A),
      row('signed_up', B),
    ]);
    const t = setup([A]);
    await t.svc.flush(5);
    expect(t.gateway.mention).toHaveBeenCalledWith(
      'dthread',
      `${MENTION_PREFIX} <@${B}>`,
      [B],
    );
  });

  it('does nothing when everyone was already pinged', async () => {
    mockedQ.listSignupPingRows.mockResolvedValue([row('signed_up', A)]);
    const t = setup([A]);
    expect(await t.svc.flush(5)).toBe('unchanged');
    expect(t.outbound.ensureEventPost).not.toHaveBeenCalled();
    expect(t.gateway.mention).not.toHaveBeenCalled();
  });
});

describe('ROK-2260 HubForumDiscordSignupPings.flush — removals and waits', () => {
  it('a cancel is removed from the post silently and forgotten (a re-signup pings again)', async () => {
    mockedQ.listSignupPingRows.mockResolvedValue([
      row('signed_up', A),
      row('declined', B),
    ]);
    const t = setup([A, B]);
    expect(await t.svc.flush(5)).toBe('pinged');
    expect(t.gateway.mention).not.toHaveBeenCalled();
    expect(t.gateway.removeThreadMembers).toHaveBeenCalledWith(
      'dthread',
      [B],
      expect.any(Function),
    );
    expect([...t.set]).toEqual([A]);
    // A removal alone reads the post through the gate; it never creates one.
    expect(t.outbound.ensureEventPost).toHaveBeenCalledWith({
      guildId: 7,
      threadId: 70,
      create: false,
    });
  });

  it('waits (pings nobody, remembers nobody) while the bot is offline', async () => {
    mockedQ.listSignupPingRows.mockResolvedValue([row('signed_up', A)]);
    const t = setup([], false);
    expect(await t.svc.flush(5)).toBe('offline');
    expect(t.gateway.mention).not.toHaveBeenCalled();
    expect(t.set.size).toBe(0);
  });

  it('pings nobody when the thread is read-only (no post) or its post is locked', async () => {
    mockedQ.listSignupPingRows.mockResolvedValue([row('signed_up', A)]);
    const t = setup();
    t.outbound.ensureEventPost.mockResolvedValueOnce(null);
    expect(await t.svc.flush(5)).toBe('closed');
    t.outbound.ensureEventPost.mockResolvedValueOnce({
      ...POST,
      discordLockedAt: new Date(),
    });
    expect(await t.svc.flush(5)).toBe('closed');
    expect(t.gateway.mention).not.toHaveBeenCalled();
    expect(t.set.size).toBe(0);
  });

  it('reports pending while the post is claimed but not sent yet', async () => {
    mockedQ.listSignupPingRows.mockResolvedValue([row('signed_up', A)]);
    const t = setup();
    t.outbound.ensureEventPost.mockResolvedValueOnce({
      ...POST,
      discordMessageId: `${links.UNSENT_PREFIX}1`,
    });
    expect(await t.svc.flush(5)).toBe('pending');
    expect(t.gateway.mention).not.toHaveBeenCalled();
  });
});

describe('ROK-2260 HubForumDiscordSignupPings.flush — review r1 guards', () => {
  it('M1/P2-2: a failed removal is kept and reported incomplete, so the job retries it', async () => {
    mockedQ.listSignupPingRows.mockResolvedValue([row('declined', B)]);
    const t = setup([B]);
    t.gateway.removeThreadMembers.mockResolvedValueOnce([]);
    // Codex P2-2: retryable, so the job is retried with backoff.
    expect(await t.svc.flush(5)).toBe('incomplete');
    expect([...t.set]).toEqual([B]);
    expect(await t.svc.flush(5)).toBe('pinged');
    expect(t.gateway.removeThreadMembers).toHaveBeenCalledTimes(2);
    expect([...t.set]).toEqual([]);
  });

  it('r2-2: the retry after an incomplete removal never pings the same signup twice', async () => {
    mockedQ.listSignupPingRows.mockResolvedValue([
      row('signed_up', A),
      row('declined', B),
    ]);
    const t = setup([B]);
    t.gateway.removeThreadMembers.mockResolvedValueOnce([]);
    expect(await t.svc.flush(5)).toBe('incomplete');
    expect(await t.svc.flush(5)).toBe('pinged');
    expect(t.gateway.mention).toHaveBeenCalledTimes(1);
    expect([...t.set]).toEqual([A]);
  });

  it('m3: a removal alone goes through the binding/stale gate, never a raw link read', async () => {
    mockedQ.listSignupPingRows.mockResolvedValue([row('declined', B)]);
    const t = setup([B]);
    t.outbound.ensureEventPost.mockResolvedValueOnce(null);
    expect(await t.svc.flush(5)).toBe('closed');
    expect(t.outbound.ensureEventPost).toHaveBeenCalledWith({
      guildId: 7,
      threadId: 70,
      create: false,
    });
    expect(t.gateway.removeThreadMembers).not.toHaveBeenCalled();
    expect([...t.set]).toEqual([B]);
  });

  it('m4: a cancelled event pings nobody (and creates no post)', async () => {
    mockedQ.findBoundEventThread.mockResolvedValue({ ...REF, cancelled: true });
    mockedQ.listSignupPingRows.mockResolvedValue([row('signed_up', A)]);
    const t = setup();
    expect(await t.svc.flush(5)).toBe('unchanged');
    expect(t.outbound.ensureEventPost).not.toHaveBeenCalled();
    expect(t.gateway.mention).not.toHaveBeenCalled();
    expect(t.set.size).toBe(0);
  });

  it('m2: an unchanged flush still moves the pinged set expiry to the event end + grace', async () => {
    mockedQ.listSignupPingRows.mockResolvedValue([row('signed_up', A)]);
    const t = setup([A]);
    expect(await t.svc.flush(5)).toBe('unchanged');
    expect(t.redis.pexpireat).toHaveBeenCalledWith(
      pingedSetKey(5, REF),
      REF.endsAt.getTime() + 7 * 24 * 60 * 60 * 1000,
    );
  });
});

describe('ROK-2260 HubForumDiscordSignupPings.flush — Codex P2', () => {
  it('P2-4: after a retag to another hub, players pinged into the old post are pinged into the new one', async () => {
    mockedQ.listSignupPingRows.mockResolvedValue([row('signed_up', A)]);
    const t = setup([A]); // already pinged into hub 7's post
    const moved = { ...REF, guildId: 8, threadId: 80 };
    mockedQ.findBoundEventThread.mockResolvedValue(moved);
    expect(await t.svc.flush(5)).toBe('pinged');
    expect(t.gateway.mention).toHaveBeenCalledWith(
      'dthread',
      `${MENTION_PREFIX} <@${A}>`,
      [A],
    );
    expect(t.redis.sadd).toHaveBeenCalledWith(pingedSetKey(5, moved), A);
  });
});
