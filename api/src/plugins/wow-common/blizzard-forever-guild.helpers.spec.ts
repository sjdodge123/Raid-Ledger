/**
 * ROK-2102 B.4 — Forever guild roster client: URL under the Forever profile
 * namespace, defensive member mapping, 404 → null, other non-2xx → 502.
 */
import { BadGatewayException } from '@nestjs/common';
import {
  fetchForeverGuildRoster,
  mapForeverGuildRoster,
} from './blizzard-forever-guild.helpers';
import { isNamespaceRefusal } from './blizzard-upstream-error';
import {
  getForeverNamespacePrefix,
  setForeverNamespacePrefix,
} from './forever-namespace.resolver';

const logger = { warn: jest.fn() };

const ROSTER_BODY = {
  _links: { self: { href: 'https://example.invalid/roster' } },
  guild: { name: 'Lantern Watch', id: 1001 },
  members: [
    {
      character: {
        name: 'Ana Forever',
        id: 7001,
        level: 42,
        playable_class: { id: 8 },
      },
      rank: 0,
    },
    {
      character: { name: 'Bo Tester', id: 7002, level: 12 },
      rank: 3,
    },
    { character: { id: 7003, level: 20 }, rank: 1 },
  ],
};

let previousPrefix: string;
let fetchSpy: jest.SpyInstance;

beforeEach(() => {
  previousPrefix = getForeverNamespacePrefix();
  setForeverNamespacePrefix('forever');
  logger.warn.mockClear();
});

afterEach(() => {
  setForeverNamespacePrefix(previousPrefix);
  fetchSpy.mockRestore();
});

function stubFetch(status: number, body: unknown): void {
  fetchSpy = jest
    .spyOn(global, 'fetch')
    .mockResolvedValue(new Response(JSON.stringify(body), { status }));
}

function requestedUrl(): string {
  const call: unknown[] | undefined = fetchSpy.mock.calls[0];
  return String(call?.[0]);
}

describe('fetchForeverGuildRoster (ROK-2102)', () => {
  it('maps a 200 roster and requests the Forever profile namespace', async () => {
    stubFetch(200, ROSTER_BODY);
    const roster = await fetchForeverGuildRoster(
      'Lantern-Watch',
      'us',
      'tok',
      logger,
    );
    expect(requestedUrl()).toBe(
      'https://us.api.blizzard.com/data/wow/guild/lantern-watch/roster?namespace=profile-forever-us&locale=en_US',
    );
    expect(roster).toEqual({
      members: [
        { name: 'Ana Forever', level: 42, classId: 8, rank: 0 },
        { name: 'Bo Tester', level: 12, classId: null, rank: 3 },
      ],
    });
  });

  it('percent-encodes the slug so it cannot change the path', async () => {
    stubFetch(200, { members: [] });
    await fetchForeverGuildRoster('a/../b', 'eu', 'tok', logger);
    expect(requestedUrl()).toContain('/data/wow/guild/a%2F..%2Fb/roster?');
  });

  it('returns null on 404 and warns', async () => {
    stubFetch(404, {});
    const roster = await fetchForeverGuildRoster('nope', 'us', 'tok', logger);
    expect(roster).toBeNull();
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it('throws the 502 namespace refusal on 403', async () => {
    stubFetch(403, {});
    const err: unknown = await fetchForeverGuildRoster(
      'x',
      'us',
      'tok',
      logger,
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BadGatewayException);
    expect(isNamespaceRefusal(err)).toBe(true);
  });

  it('throws a non-refusal 502 on 500', async () => {
    stubFetch(500, {});
    const err: unknown = await fetchForeverGuildRoster(
      'x',
      'us',
      'tok',
      logger,
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BadGatewayException);
    expect(isNamespaceRefusal(err)).toBe(false);
  });
});

describe('mapForeverGuildRoster (ROK-2102)', () => {
  it.each([[null], ['text'], [{}], [{ members: 'nope' }]])(
    'gives an empty roster for a malformed body %p',
    (body) => {
      expect(mapForeverGuildRoster(body)).toEqual({ members: [] });
    },
  );

  it('drops members without a numeric level or rank', () => {
    const roster = mapForeverGuildRoster({
      members: [
        { character: { name: 'Cy Tester', level: '9' }, rank: 1 },
        { character: { name: 'Di Tester', level: 30 } },
        { rank: 2 },
      ],
    });
    expect(roster.members).toEqual([]);
  });
});
