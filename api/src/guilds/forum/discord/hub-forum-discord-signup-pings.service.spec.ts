import * as q from './hub-forum-discord-signup-pings.queries';
import * as lq from './hub-forum-discord-signup-lines.queries';
import type { SignupLineMember } from './hub-forum-discord-signup-lines.queries';
import {
  lineResyncKey,
  postedLinesKey,
  SEEDED_FIELD,
} from './hub-forum-discord-signup-lines.flush';
import * as links from './hub-forum-discord-links.queries';
import { HubForumDiscordSignupPings } from './hub-forum-discord-signup-pings.service';
import { pingedSetKey } from './hub-forum-discord-signup-pings';
import type { HubForumDiscordOutboundService } from './hub-forum-discord-outbound.service';
import type { HubForumDiscordOutboundGateway } from './hub-forum-discord-outbound.discord';
import type { ForumDiscordDb } from './hub-forum-discord.queries';
import type Redis from 'ioredis';

jest.mock('./hub-forum-discord-signup-pings.queries');
jest.mock('./hub-forum-discord-signup-lines.queries');
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

const row = (status: string, id: string, role: string | null = null) => ({
  discordId: id,
  displayName: id === A ? 'Alice' : 'Bob',
  state: {
    status,
    role,
    bench: false,
    character: null,
    late: false,
    lateMinutes: null,
    roachedHoursBefore: null,
  },
});

/** The loader's map for these members. */
function rows(...members: SignupLineMember[]) {
  return new Map(members.map((m) => [m.discordId, m]));
}

function setup(pinged: string[] = [], online = true) {
  // Key-aware, so a set scoped to another post is a different set (P2-4).
  const set = new Set(pinged);
  const sets = new Map([[pingedSetKey(5, REF), set]]);
  const at = (k: string): Set<string> => {
    const found = sets.get(k) ?? new Set<string>();
    sets.set(k, found);
    return found;
  };
  const hashes = new Map<string, Record<string, string>>();
  const hash = (k: string): Record<string, string> => {
    const found = hashes.get(k) ?? {};
    hashes.set(k, found);
    return found;
  };
  const strings = new Map<string, string>();
  const redis = {
    set: jest.fn((k: string, v: string) => {
      strings.set(k, v);
      return Promise.resolve('OK');
    }),
    del: jest.fn((k: string) => Promise.resolve(strings.delete(k) ? 1 : 0)),
    get: jest.fn((k: string) => Promise.resolve(strings.get(k) ?? null)),
    // DEL_IF_EQUALS: delete KEYS[1] only while it holds ARGV[1].
    eval: jest.fn((_lua: string, _n: number, k: string, v: string) =>
      Promise.resolve(strings.get(k) === v && strings.delete(k) ? 1 : 0),
    ),
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
    hgetall: jest.fn((k: string) => Promise.resolve({ ...hash(k) })),
    hset: jest.fn((k: string, fields: Record<string, string>) => {
      Object.assign(hash(k), fields);
      return Promise.resolve(1);
    }),
    hdel: jest.fn((k: string, ...ids: string[]) => {
      ids.forEach((i) => delete hash(k)[i]);
      return Promise.resolve(ids.length);
    }),
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
  return { svc, redis, outbound, gateway, set, hash, strings };
}

const mockedQ = jest.mocked(q);
const mockedLq = jest.mocked(lq);
const mockedLinks = jest.mocked(links);

beforeEach(() => {
  jest.resetAllMocks();
  mockedQ.findBoundEventThread.mockResolvedValue(REF);
  mockedLq.loadSignupLineStates.mockResolvedValue(new Map());
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
    mockedLq.loadSignupLineStates.mockResolvedValue(
      rows(row('signed_up', A), row('tentative', B)),
    );
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
      expect.stringMatching(new RegExp(`<@${A}>[^\\n]*\\n.*<@${B}>`)),
      [A, B],
    );
    expect([...t.set]).toEqual([A, B]);
    expect(t.redis.sadd).toHaveBeenCalledWith(pingedSetKey(5, REF), A, B);
    expect(t.redis.pexpireat).toHaveBeenCalled();
  });

  it('never pings someone twice', async () => {
    mockedLq.loadSignupLineStates.mockResolvedValue(
      rows(row('signed_up', A), row('signed_up', B)),
    );
    const t = setup([A]);
    await t.svc.flush(5);
    expect(t.gateway.mention).toHaveBeenCalledWith(
      'dthread',
      expect.stringContaining(`<@${B}>`),
      [B],
    );
  });

  it('does nothing when everyone was already pinged', async () => {
    mockedLq.loadSignupLineStates.mockResolvedValue(rows(row('signed_up', A)));
    const t = setup([A]);
    expect(await t.svc.flush(5)).toBe('unchanged');
    expect(t.outbound.ensureEventPost).not.toHaveBeenCalled();
    expect(t.gateway.mention).not.toHaveBeenCalled();
  });
});

describe('ROK-2260 HubForumDiscordSignupPings.flush — removals and waits', () => {
  it('a cancel is removed from the post silently and forgotten (a re-signup pings again)', async () => {
    mockedLq.loadSignupLineStates.mockResolvedValue(
      rows(row('signed_up', A), row('declined', B)),
    );
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
    mockedLq.loadSignupLineStates.mockResolvedValue(rows(row('signed_up', A)));
    const t = setup([], false);
    expect(await t.svc.flush(5)).toBe('offline');
    expect(t.gateway.mention).not.toHaveBeenCalled();
    expect(t.set.size).toBe(0);
  });

  it('pings nobody when the thread is read-only (no post) or its post is locked', async () => {
    mockedLq.loadSignupLineStates.mockResolvedValue(rows(row('signed_up', A)));
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
    mockedLq.loadSignupLineStates.mockResolvedValue(rows(row('signed_up', A)));
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
    mockedLq.loadSignupLineStates.mockResolvedValue(rows(row('declined', B)));
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
    mockedLq.loadSignupLineStates.mockResolvedValue(
      rows(row('signed_up', A), row('declined', B)),
    );
    const t = setup([B]);
    t.gateway.removeThreadMembers.mockResolvedValueOnce([]);
    expect(await t.svc.flush(5)).toBe('incomplete');
    expect(await t.svc.flush(5)).toBe('pinged');
    expect(t.gateway.mention).toHaveBeenCalledTimes(1);
    expect([...t.set]).toEqual([A]);
  });

  it('m3: a removal alone goes through the binding/stale gate, never a raw link read', async () => {
    mockedLq.loadSignupLineStates.mockResolvedValue(rows(row('declined', B)));
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
    mockedLq.loadSignupLineStates.mockResolvedValue(rows(row('signed_up', A)));
    const t = setup();
    expect(await t.svc.flush(5)).toBe('unchanged');
    expect(t.outbound.ensureEventPost).not.toHaveBeenCalled();
    expect(t.gateway.mention).not.toHaveBeenCalled();
    expect(t.set.size).toBe(0);
  });

  it('m2: an unchanged flush still moves the pinged set expiry to the event end + grace', async () => {
    mockedLq.loadSignupLineStates.mockResolvedValue(rows(row('signed_up', A)));
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
    mockedLq.loadSignupLineStates.mockResolvedValue(rows(row('signed_up', A)));
    const t = setup([A]); // already pinged into hub 7's post
    const moved = { ...REF, guildId: 8, threadId: 80 };
    mockedQ.findBoundEventThread.mockResolvedValue(moved);
    expect(await t.svc.flush(5)).toBe('pinged');
    expect(t.gateway.mention).toHaveBeenCalledWith(
      'dthread',
      expect.stringContaining(`<@${A}>`),
      [A],
    );
    expect(t.redis.sadd).toHaveBeenCalledWith(pingedSetKey(5, moved), A);
  });
});

describe('ROK-2271 HubForumDiscordSignupPings.flush — state lines', () => {
  it('a first signup posts a line with its role that pings, then records the posted state', async () => {
    mockedLq.loadSignupLineStates.mockResolvedValue(
      rows(row('signed_up', A, 'tank')),
    );
    const t = setup();
    expect(await t.svc.flush(5)).toBe('pinged');
    expect(t.gateway.mention).toHaveBeenCalledWith(
      'dthread',
      expect.stringMatching(new RegExp(`<@${A}> signed up — Tank`)),
      [A],
    );
    const stored = t.hash(postedLinesKey(5, REF));
    expect(stored[SEEDED_FIELD]).toBe('1');
    expect(JSON.parse(stored[A] ?? '{}')).toMatchObject({
      name: 'Alice',
      state: { status: 'signed_up', role: 'tank' },
    });
  });

  it('tentative → confirmed posts one line WITHOUT a mention; no change posts nothing', async () => {
    mockedLq.loadSignupLineStates.mockResolvedValue(rows(row('tentative', A)));
    const t = setup();
    await t.svc.flush(5);
    mockedLq.loadSignupLineStates.mockResolvedValue(rows(row('signed_up', A)));
    expect(await t.svc.flush(5)).toBe('pinged');
    expect(t.gateway.mention).toHaveBeenLastCalledWith(
      'dthread',
      expect.stringContaining('Alice is confirmed (was tentative)'),
      [],
    );
    expect(await t.svc.flush(5)).toBe('unchanged');
    expect(t.gateway.mention).toHaveBeenCalledTimes(2);
  });

  it('two changes in one window combine into ONE line', async () => {
    mockedLq.loadSignupLineStates.mockResolvedValue(
      rows(row('tentative', A, 'tank')),
    );
    const t = setup();
    await t.svc.flush(5);
    mockedLq.loadSignupLineStates.mockResolvedValue(
      rows(row('signed_up', A, 'healer')),
    );
    await t.svc.flush(5);
    // One line (no newline) carrying both changes.
    expect(t.gateway.mention).toHaveBeenNthCalledWith(
      2,
      'dthread',
      expect.stringMatching(
        /^[^\n]*is confirmed \(was tentative\)[^\n]*Tank → Healer[^\n]*$/,
      ),
      [],
    );
  });

  it('deploy-time seeding: a pinged thread with no posted-state hash posts nothing and is seeded', async () => {
    mockedLq.loadSignupLineStates.mockResolvedValue(
      rows(row('signed_up', A, 'tank'), row('tentative', B)),
    );
    const t = setup([A, B]);
    expect(await t.svc.flush(5)).toBe('unchanged');
    expect(t.gateway.mention).not.toHaveBeenCalled();
    const stored = t.hash(postedLinesKey(5, REF));
    expect(Object.keys(stored).sort()).toEqual([A, B, SEEDED_FIELD].sort());
    // After seeding, a real change is posted (without a ping).
    mockedLq.loadSignupLineStates.mockResolvedValue(
      rows(row('signed_up', A, 'tank'), row('signed_up', B)),
    );
    expect(await t.svc.flush(5)).toBe('pinged');
    expect(t.gateway.mention).toHaveBeenCalledWith(
      'dthread',
      expect.stringContaining('Bob is confirmed'),
      [],
    );
  });

  it('a leaver is named without a ping, removed from the post, and forgotten', async () => {
    mockedLq.loadSignupLineStates.mockResolvedValue(rows(row('signed_up', A)));
    const t = setup();
    await t.svc.flush(5);
    mockedLq.loadSignupLineStates.mockResolvedValue(new Map());
    expect(await t.svc.flush(5)).toBe('pinged');
    expect(t.gateway.mention).toHaveBeenLastCalledWith(
      'dthread',
      expect.stringContaining("Alice can't make it"),
      [],
    );
    expect(t.gateway.removeThreadMembers).toHaveBeenCalledWith(
      'dthread',
      [A],
      expect.any(Function),
    );
    expect(t.hash(postedLinesKey(5, REF))[A]).toBeUndefined();
    expect(t.set.size).toBe(0);
  });
});

describe('review MAJOR-1 HubForumDiscordSignupPings — reschedule resync', () => {
  it('after a reset, tentative → signed_up posts nothing; the flag is used once; a later real change posts', async () => {
    mockedLq.loadSignupLineStates.mockResolvedValue(
      rows(row('tentative', A, 'tank')),
    );
    const t = setup();
    await t.svc.flush(5);
    // The reschedule reset flips Alice to signed_up and flags the event.
    mockedLq.loadSignupLineStates.mockResolvedValue(
      rows(row('signed_up', A, 'tank')),
    );
    await t.svc.requestResync(5);
    expect(await t.svc.flush(5)).toBe('unchanged');
    expect(t.gateway.mention).toHaveBeenCalledTimes(1);
    // The flag is gone: her next real change is a normal line.
    mockedLq.loadSignupLineStates.mockResolvedValue(
      rows(row('tentative', A, 'healer')),
    );
    expect(await t.svc.flush(5)).toBe('pinged');
    expect(t.gateway.mention).toHaveBeenLastCalledWith(
      'dthread',
      expect.stringMatching(/tentative[^\n]*Tank → Healer/),
      [],
    );
  });
});

describe('ROK-2271 fix round 2 — the flag is up before the reset write', () => {
  it('flag set, flush, reset lands, flush ⇒ still no line; LANDED then takes the flag', async () => {
    mockedLq.loadSignupLineStates.mockResolvedValue(
      rows(row('tentative', A, 'tank')),
    );
    const t = setup();
    await t.svc.flush(5);
    await t.svc.markResetPending(5);
    // A flush racing the write still reads the old status: nothing to post.
    expect(await t.svc.flush(5)).toBe('unchanged');
    // The write lands; a flush before the LANDED signal keeps quiet too.
    mockedLq.loadSignupLineStates.mockResolvedValue(
      rows(row('signed_up', A, 'tank')),
    );
    expect(await t.svc.flush(5)).toBe('unchanged');
    await t.svc.requestResync(5);
    expect(await t.svc.flush(5)).toBe('unchanged');
    expect(t.gateway.mention).toHaveBeenCalledTimes(1);
    expect(t.strings.has(lineResyncKey(5))).toBe(false);
  });

  it('an aborted reset drops the pending flag: a later real change posts', async () => {
    mockedLq.loadSignupLineStates.mockResolvedValue(
      rows(row('tentative', A, 'tank')),
    );
    const t = setup();
    await t.svc.flush(5);
    await t.svc.markResetPending(5);
    await t.svc.abortReset(5);
    mockedLq.loadSignupLineStates.mockResolvedValue(
      rows(row('signed_up', A, 'tank')),
    );
    expect(await t.svc.flush(5)).toBe('pinged');
    expect(t.gateway.mention).toHaveBeenCalledTimes(2);
  });
});

describe('Codex P2-5 — a reset landing during the signup read', () => {
  it('a flag that appears between the reads still makes the flush a silent resync, and is kept', async () => {
    mockedLq.loadSignupLineStates.mockResolvedValue(
      rows(row('tentative', A, 'tank')),
    );
    const t = setup();
    await t.svc.flush(5);
    // The reset writes + lands while the flush reads the signups.
    mockedLq.loadSignupLineStates.mockImplementationOnce(async () => {
      await t.svc.requestResync(5);
      return rows(row('signed_up', A, 'tank'));
    });
    expect(await t.svc.flush(5)).toBe('unchanged');
    expect(t.gateway.mention).toHaveBeenCalledTimes(1);
    // Not used up: the next flush (re-armed by LANDED) takes it.
    expect(t.strings.has(lineResyncKey(5))).toBe(true);
    mockedLq.loadSignupLineStates.mockResolvedValue(
      rows(row('signed_up', A, 'tank')),
    );
    expect(await t.svc.flush(5)).toBe('unchanged');
    expect(t.strings.has(lineResyncKey(5))).toBe(false);
  });
});

describe('review round 3 MAJOR-D1 — real changes during a resync still post', () => {
  it('a decline after the reset, before the flush, posts its line', async () => {
    mockedLq.loadSignupLineStates.mockResolvedValue(
      rows(row('tentative', A, 'tank'), row('signed_up', B, 'dps')),
    );
    const t = setup();
    await t.svc.flush(5);
    await t.svc.requestResync(5);
    mockedLq.loadSignupLineStates.mockResolvedValue(
      rows(row('signed_up', A, 'tank'), row('declined', B, 'dps')),
    );
    expect(await t.svc.flush(5)).toBe('pinged');
    expect(t.gateway.mention).toHaveBeenCalledTimes(2);
    expect(t.gateway.mention).toHaveBeenLastCalledWith(
      'dthread',
      "👋 Bob can't make it",
      [],
    );
  });
});
