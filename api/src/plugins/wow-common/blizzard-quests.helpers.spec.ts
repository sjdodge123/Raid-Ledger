/**
 * ROK-2109 — Blizzard `quests/completed` fetch + parse (AC2, AC3).
 * Forever only; null = leave `armory_quests` alone; ids only, deduped,
 * ascending, capped at the addon limit keeping the LOWEST ids.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ADDON_QUESTS_COMPLETED_MAX } from '@raid-ledger/contract';
import {
  ArmoryQuestsSchema,
  fetchCharacterQuests,
  parseCompletedQuests,
} from './blizzard-quests.helpers';
import {
  FOREVER_NAMESPACE_ALIAS,
  getForeverNamespacePrefix,
  setForeverNamespacePrefix,
} from './forever-namespace.resolver';

const FIXTURE: unknown = JSON.parse(
  readFileSync(
    join(
      __dirname,
      'testing',
      'fixtures',
      'blizzard-forever',
      'quests-completed.json',
    ),
    'utf8',
  ),
);
const AT = '2026-11-07T00:00:00.000Z';
const logger = { warn: jest.fn(), log: jest.fn(), debug: jest.fn() };

function mockFetchOnce(status: number, body: unknown): jest.Mock {
  const fn = jest.fn().mockResolvedValueOnce({
    status,
    ok: status >= 200 && status < 300,
    json: () => Promise.resolve(body),
  });
  global.fetch = fn;
  return fn;
}

const fetchForever = () =>
  fetchCharacterQuests(
    'Ana Forever',
    null,
    'us',
    FOREVER_NAMESPACE_ALIAS,
    'token-1',
    logger,
  );

describe('parseCompletedQuests (ROK-2109 AC3)', () => {
  it('keeps ids only, ascending, from the fixture', () => {
    const parsed = parseCompletedQuests(FIXTURE, AT);
    expect(parsed).toEqual({
      fetchedAt: AT,
      completed: [7001, 7002, 7003, 7004, 7005],
    });
    expect(JSON.stringify(parsed)).not.toContain('Invented Quest');
    expect(JSON.stringify(parsed)).not.toContain('href');
    expect(ArmoryQuestsSchema.safeParse(parsed).success).toBe(true);
  });

  it('dedupes and drops non-integer / non-positive ids', () => {
    const body = {
      quests: [{ id: 5 }, { id: 5 }, { id: 0 }, { id: -2 }, { id: 1.5 }],
    };
    const more = { quests: [...body.quests, { id: '9' }, { id: 3 }] };
    expect(parseCompletedQuests(more, AT)?.completed).toEqual([3, 5]);
  });

  it('caps at the addon limit keeping the lowest ids and flags the cut', () => {
    const total = ADDON_QUESTS_COMPLETED_MAX + 5;
    const quests = Array.from({ length: total }, (_, i) => ({
      id: total - i,
    }));
    const parsed = parseCompletedQuests({ quests }, AT);
    expect(parsed?.completed).toHaveLength(ADDON_QUESTS_COMPLETED_MAX);
    expect(parsed?.completed[0]).toBe(1);
    expect(parsed?.completed.at(-1)).toBe(ADDON_QUESTS_COMPLETED_MAX);
    expect(parsed?.completedTruncated).toBe(true);
  });

  it('sets no truncation flag at exactly the limit', () => {
    const quests = Array.from(
      { length: ADDON_QUESTS_COMPLETED_MAX },
      (_, i) => ({
        id: i + 1,
      }),
    );
    const parsed = parseCompletedQuests({ quests }, AT);
    expect(parsed).not.toHaveProperty('completedTruncated');
  });

  it('returns null for a body without a quests array', () => {
    expect(parseCompletedQuests({ character: {} }, AT)).toBeNull();
    expect(parseCompletedQuests(null, AT)).toBeNull();
  });
});

describe('fetchCharacterQuests (ROK-2109 AC2)', () => {
  let previousPrefix: string;
  beforeEach(() => {
    jest.clearAllMocks();
    previousPrefix = getForeverNamespacePrefix();
    setForeverNamespacePrefix('forever');
  });
  afterEach(() => setForeverNamespacePrefix(previousPrefix));

  it('asks the realmless Forever quests/completed route', async () => {
    const fetchMock = mockFetchOnce(200, FIXTURE);
    const result = await fetchForever();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'https://us.api.blizzard.com/profile/wow/character/ana-forever/quests/completed?namespace=profile-forever-us&locale=en_US',
    );
    expect(result?.completed).toEqual([7001, 7002, 7003, 7004, 7005]);
  });

  it.each([
    ['classicann', 'Dreamscythe'],
    [null, 'Area 52'],
  ])('skips non-Forever prefix %s without a request', async (prefix, realm) => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock;
    const result = await fetchCharacterQuests(
      'Roknua',
      realm,
      'us',
      prefix,
      'token-1',
      logger,
    );
    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([404, 503])('returns null on HTTP %i', async (status) => {
    mockFetchOnce(status, {});
    expect(await fetchForever()).toBeNull();
  });

  it('returns null when the request throws', async () => {
    global.fetch = jest.fn().mockRejectedValueOnce(new Error('network'));
    expect(await fetchForever()).toBeNull();
  });

  it('returns null on an unparseable 200 body', async () => {
    mockFetchOnce(200, { quests: 'nope' });
    expect(await fetchForever()).toBeNull();
  });
});
