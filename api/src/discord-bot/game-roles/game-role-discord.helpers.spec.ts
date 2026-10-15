/**
 * ROK-1767 — the reconcile's member read. It pages the REST list endpoint
 * (never the gateway op-8 chunk, which is rate limited per shard and shared
 * with every other member search) and retries ONE rate limit, bounded.
 */
import {
  Collection,
  RateLimitError,
  type Guild,
  type GuildMember,
} from 'discord.js';
import {
  fetchGuildMembers,
  fetchRoleState,
  MAX_MEMBER_PAGES,
  MEMBER_PAGE_SIZE,
  withRateLimitRetry,
} from './game-role-discord.helpers';

function member(id: string, roles: string[] = []): GuildMember {
  return {
    id,
    roles: { cache: new Map(roles.map((r) => [r, {}])) },
  } as unknown as GuildMember;
}

function page(from: number, count: number): Collection<string, GuildMember> {
  const col = new Collection<string, GuildMember>();
  for (let i = 0; i < count; i++) {
    const id = String(from + i).padStart(6, '0');
    col.set(id, member(id, i === 0 ? ['role-1'] : []));
  }
  return col;
}

function fakeGuild(pages: Collection<string, GuildMember>[]) {
  const list = jest.fn();
  for (const p of pages) list.mockResolvedValueOnce(p);
  const fetch = jest.fn().mockRejectedValue(new Error('gateway fetch used'));
  const roles = { fetch: jest.fn().mockResolvedValue({ id: 'role-1' }) };
  const guild = {
    id: 'g',
    members: { list, fetch },
    roles,
  } as unknown as Guild;
  return { guild, list, fetch };
}

/** The shape discord.js rejects an op-8 request with. */
function gatewayRateLimit(retryAfterSeconds: number): Error {
  return Object.assign(new Error('Request with opcode 8 was rate limited.'), {
    name: 'GatewayRateLimitError',
    data: { opcode: 8, retry_after: retryAfterSeconds },
  });
}

describe('fetchGuildMembers', () => {
  it('pages the REST list until a short page, never the gateway fetch', async () => {
    const { guild, list, fetch } = fakeGuild([
      page(0, MEMBER_PAGE_SIZE),
      page(MEMBER_PAGE_SIZE, 3),
    ]);
    const members = await fetchGuildMembers(guild);
    expect(members.size).toBe(MEMBER_PAGE_SIZE + 3);
    expect(fetch).not.toHaveBeenCalled();
    expect(list).toHaveBeenNthCalledWith(1, { limit: MEMBER_PAGE_SIZE });
    expect(list).toHaveBeenNthCalledWith(2, {
      limit: MEMBER_PAGE_SIZE,
      after: String(MEMBER_PAGE_SIZE - 1).padStart(6, '0'),
    });
    expect(list).toHaveBeenCalledTimes(2);
  });
});

describe('fetchGuildMembers page cap', () => {
  it('throws instead of returning a truncated list when the cap is hit', async () => {
    const { guild, list } = fakeGuild([]);
    list.mockResolvedValue(page(0, MEMBER_PAGE_SIZE));
    await expect(fetchGuildMembers(guild)).rejects.toThrow(
      /member list incomplete/i,
    );
    expect(list).toHaveBeenCalledTimes(MAX_MEMBER_PAGES);
  });
});

describe('fetchRoleState', () => {
  it('reads holders from the REST list when nothing was prefetched', async () => {
    const { guild, fetch } = fakeGuild([page(0, 2)]);
    const state = await fetchRoleState(guild, 'role-1');
    expect(fetch).not.toHaveBeenCalled();
    expect(state?.holders).toEqual(new Set(['000000']));
    expect(state?.memberIds).toEqual(new Set(['000000', '000001']));
  });
});

describe('withRateLimitRetry', () => {
  it('waits retry_after once, then retries', async () => {
    const op = jest
      .fn()
      .mockRejectedValueOnce(gatewayRateLimit(29.5))
      .mockResolvedValueOnce('ok');
    const wait = jest.fn().mockResolvedValue(undefined);
    await expect(withRateLimitRetry(op, wait)).resolves.toBe('ok');
    expect(wait).toHaveBeenCalledWith(29_500);
    expect(op).toHaveBeenCalledTimes(2);
  });

  it('honours a REST RateLimitError retryAfter (ms) and caps the wait', async () => {
    // The real class: its `name` getter is `RateLimitError[<route>]`.
    const restLimit = new RateLimitError({
      timeToReset: 600_000,
      limit: 10,
      method: 'GET',
      hash: 'h',
      url: 'https://discord.com/api/v10/guilds/g/members',
      route: '/guilds/:id/members',
      majorParameter: 'g',
      global: false,
      retryAfter: 600_000,
      sublimitTimeout: 0,
      scope: 'user',
    });
    expect(restLimit.name).toBe('RateLimitError[/guilds/:id/members]');
    const op = jest
      .fn()
      .mockRejectedValueOnce(restLimit)
      .mockResolvedValueOnce('ok');
    const wait = jest.fn().mockResolvedValue(undefined);
    const out = await withRateLimitRetry(op, wait).catch(() => 'rethrown');
    expect(wait).toHaveBeenCalledWith(60_000);
    expect(out).toBe('ok');
  });

  it('rethrows a second rate limit instead of retrying forever', async () => {
    const op = jest.fn().mockRejectedValue(gatewayRateLimit(1));
    const wait = jest.fn().mockResolvedValue(undefined);
    await expect(withRateLimitRetry(op, wait)).rejects.toThrow(
      'opcode 8 was rate limited',
    );
    expect(op).toHaveBeenCalledTimes(2);
  });

  it('does not retry other errors', async () => {
    const op = jest.fn().mockRejectedValue(new Error('Missing Access'));
    const wait = jest.fn();
    await expect(withRateLimitRetry(op, wait)).rejects.toThrow(
      'Missing Access',
    );
    expect(op).toHaveBeenCalledTimes(1);
    expect(wait).not.toHaveBeenCalled();
  });
});
