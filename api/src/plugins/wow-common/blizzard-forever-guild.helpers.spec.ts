/**
 * ROK-2102 B.4 — Forever guild roster client: URL under the Forever profile
 * namespace, defensive member mapping, 404 → null, other non-2xx → 502.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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

const MAPPED_ROSTER = {
  members: [
    { name: 'Ana Forever', level: 42, classId: 8, rank: 0, blizzardId: 7001 },
    { name: 'Bo Tester', level: 12, classId: null, rank: 3, blizzardId: 7002 },
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
    expect(roster).toEqual(MAPPED_ROSTER);
  });

  it.each(['a/../b', '..', '.', 'a b', 'x', 'guild?x=1'])(
    'rejects slug %p with a 400 before any request',
    async (slug) => {
      stubFetch(200, { members: [] });
      await expect(
        fetchForeverGuildRoster(slug, 'eu', 'tok', logger),
      ).rejects.toMatchObject({ status: 400 });
      expect(fetchSpy).not.toHaveBeenCalled();
    },
  );

  it('lowercases and percent-encodes an accepted slug', async () => {
    stubFetch(200, { members: [] });
    await fetchForeverGuildRoster('Zoë-Guild', 'eu', 'tok', logger);
    expect(requestedUrl()).toContain('/data/wow/guild/zo%C3%AB-guild/roster?');
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
      'raid-ledger',
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
      'raid-ledger',
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

describe('mapForeverGuildRoster with the synthetic fixture (ROK-1928 B1)', () => {
  const fixture: unknown = JSON.parse(
    readFileSync(
      join(__dirname, '__fixtures__', 'forever-guild-roster.json'),
      'utf8',
    ),
  );

  it('Given the fixture, When mapped, Then character.id becomes blizzardId and surname/slug are ignored', () => {
    const roster = mapForeverGuildRoster(fixture);
    expect(roster.members[0]).toEqual({
      name: 'Ana Example',
      level: 60,
      classId: 8,
      rank: 0,
      blizzardId: 800001,
    });
  });

  it('Given a member without character.id, When mapped, Then blizzardId is null and the member is kept', () => {
    const roster = mapForeverGuildRoster(fixture);
    expect(roster.members.find((m) => m.name === 'Di Noid')).toEqual({
      name: 'Di Noid',
      level: 9,
      classId: null,
      rank: 6,
      blizzardId: null,
    });
  });

  it('Given a member without a rank, When mapped, Then it is still dropped', () => {
    const names = mapForeverGuildRoster(fixture).members.map((m) => m.name);
    expect(names).toEqual([
      'Ana Example',
      'Bo Sample',
      'Cy Placeholder',
      'Di Noid',
    ]);
  });
});
