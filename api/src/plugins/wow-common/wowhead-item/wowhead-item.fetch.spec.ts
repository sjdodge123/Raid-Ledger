import { readFileSync } from 'fs';
import { join } from 'path';
import {
  WOWHEAD_USER_AGENT,
  buildWowheadItemUrl,
  fetchWowheadItem,
  parseWowheadTooltip,
  sanitizeIcon,
} from './wowhead-item.fetch';
import type { WowheadEnv, WowheadFetch } from './wowhead-item.types';

const FIXTURES = join(__dirname, '..', 'testing', 'fixtures', 'wowhead');

/** Replays a captured response: status from `.headers.txt`, body from `.json`. */
function fixture(
  id: number,
  env: WowheadEnv,
): { status: number; body: string } {
  const base = join(FIXTURES, `item-${id}-env${env}`);
  const head = readFileSync(`${base}.headers.txt`, 'utf8');
  const status = Number(/^HTTP\/\S+\s+(\d{3})/.exec(head)?.[1]);
  return { status, body: readFileSync(`${base}.json`, 'utf8') };
}

function replay(
  status: number,
  body: string,
): jest.MockedFunction<WowheadFetch> {
  return jest.fn<ReturnType<WowheadFetch>, Parameters<WowheadFetch>>(() =>
    Promise.resolve({
      status,
      json: () => Promise.resolve(JSON.parse(body) as unknown),
    }),
  );
}

function fromFixture(id: number, env: WowheadEnv) {
  const f = fixture(id, env);
  return replay(f.status, f.body);
}

describe('buildWowheadItemUrl', () => {
  it('targets the nether tooltip endpoint with the data env', () => {
    expect(buildWowheadItemUrl(234819, 16)).toBe(
      'https://nether.wowhead.com/tooltip/item/234819?dataEnv=16',
    );
  });
});

describe('fetchWowheadItem against captured Wowhead responses', () => {
  it('parses a Forever hit (234819, env 16)', async () => {
    const fetchFn = fromFixture(234819, 16);
    await expect(fetchWowheadItem(234819, 16, fetchFn)).resolves.toEqual({
      kind: 'found',
      name: 'Demonic Gauntlet',
      quality: 4,
      icon: 'inv_gauntlets_84',
    });
    const [url, init] = fetchFn.mock.calls[0] ?? [];
    expect(url).toBe(buildWowheadItemUrl(234819, 16));
    expect(init?.headers['User-Agent']).toBe(WOWHEAD_USER_AGENT);
  });

  it('parses a Classic hit (16922, env 4)', async () => {
    await expect(
      fetchWowheadItem(16922, 4, fromFixture(16922, 4)),
    ).resolves.toEqual({
      kind: 'found',
      name: 'Leggings of Transcendence',
      quality: 4,
      icon: 'inv_pants_08',
    });
  });

  it.each([
    [16922, 16],
    [234819, 4],
  ] as const)(
    'classifies the 404 miss (%i, env %i) as not_found',
    async (id, env) => {
      await expect(
        fetchWowheadItem(id, env, fromFixture(id, env)),
      ).resolves.toEqual({
        kind: 'not_found',
      });
    },
  );
});

describe('fetchWowheadItem classification', () => {
  it.each([429, 500, 503])('HTTP %i is retryable', async (status) => {
    await expect(
      fetchWowheadItem(1, 16, replay(status, '{}')),
    ).resolves.toEqual({ kind: 'retryable', status });
  });

  it('a network error is retryable with a null status', async () => {
    const fetchFn: WowheadFetch = () => Promise.reject(new Error('ECONNRESET'));
    await expect(fetchWowheadItem(1, 16, fetchFn)).resolves.toEqual({
      kind: 'retryable',
      status: null,
    });
  });

  it('a 200 with an unparseable body is not_found', async () => {
    const fetchFn: WowheadFetch = () =>
      Promise.resolve({
        status: 200,
        json: () => Promise.reject(new Error('bad json')),
      });
    await expect(fetchWowheadItem(1, 16, fetchFn)).resolves.toEqual({
      kind: 'not_found',
    });
  });
});

describe('parseWowheadTooltip', () => {
  it.each([
    ['error body', { error: 'Entity not found' }],
    ['null', null],
    ['quality out of range', { name: 'X', quality: 9, icon: 'a' }],
    ['empty name', { name: '', quality: 1, icon: 'a' }],
  ])('rejects %s as not_found', (_label, body) => {
    expect(parseWowheadTooltip(body)).toEqual({ kind: 'not_found' });
  });

  it('keeps the item but drops an unsafe icon slug', () => {
    expect(
      parseWowheadTooltip({ name: 'X', quality: 2, icon: '../evil.jpg?x' }),
    ).toEqual({ kind: 'found', name: 'X', quality: 2, icon: null });
  });
});

describe('sanitizeIcon', () => {
  it('lowercases a valid slug and rejects anything else', () => {
    expect(sanitizeIcon('INV_Sword_39')).toBe('inv_sword_39');
    expect(sanitizeIcon('inv sword')).toBeNull();
    expect(sanitizeIcon(undefined)).toBeNull();
    expect(sanitizeIcon('a'.repeat(101))).toBeNull();
  });
});
