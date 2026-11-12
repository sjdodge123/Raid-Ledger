/**
 * ROK-1170 — Forever guild summary client: realmless URL under the Forever
 * profile namespace, tolerant mapping (every field → null when absent or
 * invalid), 404 → not_found, other non-2xx → 502.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BadGatewayException, BadRequestException } from '@nestjs/common';
import {
  buildForeverGuildSummaryUrl,
  fetchForeverGuildSummary,
  mapForeverGuildSummary,
} from './blizzard-forever-guild-summary.helpers';
import { isNamespaceRefusal } from './blizzard-upstream-error';
import {
  getForeverNamespacePrefix,
  setForeverNamespacePrefix,
} from './forever-namespace.resolver';

const FIXTURE: unknown = JSON.parse(
  readFileSync(
    join(__dirname, '__fixtures__/forever-guild-summary.json'),
    'utf8',
  ),
);
const NOW = Date.UTC(2026, 10, 12);
const ALL_NULL = { blizzardGuildId: null, foundedAt: null, faction: null };
const logger = { warn: jest.fn() };

let previousPrefix: string;
let fetchSpy: jest.SpyInstance | undefined;

beforeEach(() => {
  previousPrefix = getForeverNamespacePrefix();
  setForeverNamespacePrefix('forever');
  logger.warn.mockClear();
});

afterEach(() => {
  setForeverNamespacePrefix(previousPrefix);
  fetchSpy?.mockRestore();
  fetchSpy = undefined;
});

function stubFetch(status: number, body: unknown): jest.SpyInstance {
  const spy = jest
    .spyOn(global, 'fetch')
    .mockResolvedValue(new Response(JSON.stringify(body), { status }));
  fetchSpy = spy;
  return spy;
}

describe('buildForeverGuildSummaryUrl', () => {
  it('builds the realmless summary URL with no /roster suffix', () => {
    expect(buildForeverGuildSummaryUrl('Example-Guild', 'us')).toBe(
      'https://us.api.blizzard.com/data/wow/guild/example-guild?namespace=profile-forever-us&locale=en_US',
    );
  });

  it('lowercases and percent-encodes an accepted slug', () => {
    expect(buildForeverGuildSummaryUrl('Zoë-Guild', 'eu')).toContain(
      '/data/wow/guild/zo%C3%AB-guild?namespace=profile-forever-eu',
    );
  });

  it.each(['a/../b', '..', '.', 'a b', 'x', 'guild?x=1'])(
    'rejects slug %p with a 400',
    (slug) => {
      expect(() => buildForeverGuildSummaryUrl(slug, 'us')).toThrow(
        BadRequestException,
      );
    },
  );
});

describe('mapForeverGuildSummary', () => {
  it('maps the synthetic fixture', () => {
    expect(mapForeverGuildSummary(FIXTURE, NOW)).toEqual({
      blizzardGuildId: 900101,
      foundedAt: new Date(1735689600000),
      faction: 'Alliance',
    });
  });

  it.each([[{}], [null], ['text'], [[{ id: 1 }]]])(
    'maps a body without usable fields (%p) to all null',
    (body) => {
      expect(mapForeverGuildSummary(body, NOW)).toEqual(ALL_NULL);
    },
  );

  it('accepts created_timestamp as epoch ms or an ISO string', () => {
    const iso = '2025-01-01T00:00:00.000Z';
    expect(
      mapForeverGuildSummary({ created_timestamp: 1735689600000 }, NOW)
        .foundedAt,
    ).toEqual(new Date(iso));
    expect(
      mapForeverGuildSummary({ created_timestamp: iso }, NOW).foundedAt,
    ).toEqual(new Date(iso));
  });

  it.each([
    ['before 2004', Date.UTC(2003, 11, 31)],
    ['epoch seconds', 1735689600],
    ['over a day in the future', NOW + 2 * 86_400_000],
    ['an unparseable string', 'not-a-date'],
    ['a non-finite number', Number.NaN],
  ])('drops a founded date that is %s', (_label, value) => {
    expect(
      mapForeverGuildSummary({ created_timestamp: value }, NOW).foundedAt,
    ).toBeNull();
  });

  it.each([
    [{ type: 'HORDE' }, 'Horde'],
    [{ type: 'alliance' }, 'Alliance'],
    [{ name: 'horde' }, 'Horde'],
    [{ type: 42, name: 'ALLIANCE' }, 'Alliance'],
    [{ type: 'NEUTRAL' }, null],
    [{ name: { en_US: 'Horde' } }, null],
    ['HORDE', null],
  ])('reads faction %p as %p', (faction, expected) => {
    expect(mapForeverGuildSummary({ faction }, NOW).faction).toBe(expected);
  });

  it('drops a non-integer or non-positive guild id', () => {
    for (const id of ['900101', 1.5, 0, -3]) {
      expect(mapForeverGuildSummary({ id }, NOW).blizzardGuildId).toBeNull();
    }
  });
});

describe('fetchForeverGuildSummary', () => {
  it('maps a 200 and requests the summary URL with the bearer token', async () => {
    const spy = stubFetch(200, FIXTURE);
    const result = await fetchForeverGuildSummary(
      'example-guild',
      'us',
      'tok',
      logger,
    );
    expect(result).toEqual({
      kind: 'found',
      summary: {
        blizzardGuildId: 900101,
        foundedAt: expect.any(Date),
        faction: 'Alliance',
      },
    });
    expect(spy).toHaveBeenCalledWith(
      buildForeverGuildSummaryUrl('example-guild', 'us'),
      { headers: { Authorization: 'Bearer tok' } },
    );
  });

  it('returns not_found on 404 and warns once', async () => {
    stubFetch(404, {});
    await expect(
      fetchForeverGuildSummary('example-guild', 'us', 'tok', logger),
    ).resolves.toEqual({ kind: 'not_found' });
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it('throws a non-refusal 502 on 500', async () => {
    stubFetch(500, {});
    const err: unknown = await fetchForeverGuildSummary(
      'example-guild',
      'us',
      'tok',
      logger,
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BadGatewayException);
    expect(isNamespaceRefusal(err)).toBe(false);
  });

  it('throws the 502 namespace refusal on 403', async () => {
    stubFetch(403, {});
    const err: unknown = await fetchForeverGuildSummary(
      'example-guild',
      'us',
      'tok',
      logger,
    ).catch((e: unknown) => e);
    expect(isNamespaceRefusal(err)).toBe(true);
  });
});
