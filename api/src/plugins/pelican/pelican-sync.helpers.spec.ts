import { Logger } from '@nestjs/common';
import { PelicanClient } from './pelican-client';
import {
  PELICAN_SERVER_NAME_MAX,
  PELICAN_SYNC_MAX_PAGES,
  dedupeByUuid,
  fetchAllServers,
  toListedServer,
} from './pelican-sync.helpers';
import {
  fakeServer,
  jsonResponse,
  serverPageBody,
} from './testing/pelican-fixtures';

type FetchArgs = Parameters<typeof fetch>;

/** A client whose fetch serves `pages[n-1]` for `?page=n`. */
function clientServing(pages: (number | unknown)[]) {
  const fetchImpl = jest.fn<Promise<Response>, FetchArgs>((input) => {
    const url = new URL(String(input));
    const page = Number(url.searchParams.get('page'));
    const body = pages[page - 1];
    if (typeof body === 'number') {
      return Promise.resolve(new Response('', { status: body }));
    }
    return Promise.resolve(jsonResponse(body));
  });
  const client = new PelicanClient({
    baseUrl: 'https://panel.example.test',
    apiKey: 'pacc_FAKEKEYfortests0123456789',
    fetchImpl,
  });
  return { client, fetchImpl };
}

const pagesRequested = (fetchImpl: jest.Mock) =>
  fetchImpl.mock.calls.map(([input]) =>
    new URL(String(input)).searchParams.get('page'),
  );

beforeEach(() => {
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('fetchAllServers', () => {
  it('walks every page and returns every server in order', async () => {
    const { client, fetchImpl } = clientServing([
      serverPageBody([fakeServer(1), fakeServer(2)], 1, 3),
      serverPageBody([fakeServer(3)], 2, 3),
      serverPageBody([fakeServer(4)], 3, 3),
    ]);
    const res = await fetchAllServers(client);
    expect(pagesRequested(fetchImpl)).toEqual(['1', '2', '3']);
    expect(res).toEqual({
      ok: true,
      servers: [1, 2, 3, 4].map((n) => toListedServer(fakeServer(n))),
    });
  });

  it('requests the maximum page size', async () => {
    const { client, fetchImpl } = clientServing([serverPageBody([], 1, 1)]);
    await fetchAllServers(client);
    const url = new URL(String(fetchImpl.mock.calls[0]?.[0]));
    expect(url.searchParams.get('per_page')).toBe('100');
  });

  it('accepts an empty-but-successful listing (total_pages 0)', async () => {
    const { client, fetchImpl } = clientServing([serverPageBody([], 1, 0)]);
    expect(await fetchAllServers(client)).toEqual({ ok: true, servers: [] });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('returns the failure kind and no servers when a later page fails', async () => {
    const { client, fetchImpl } = clientServing([
      serverPageBody([fakeServer(1)], 1, 3),
      500,
      serverPageBody([fakeServer(3)], 3, 3),
    ]);
    expect(await fetchAllServers(client)).toEqual({ ok: false, code: 'http' });
    expect(pagesRequested(fetchImpl)).toEqual(['1', '2']);
  });

  it('classifies a 403 on page 2 as forbidden', async () => {
    const { client } = clientServing([
      serverPageBody([fakeServer(1)], 1, 2),
      403,
    ]);
    expect(await fetchAllServers(client)).toEqual({
      ok: false,
      code: 'forbidden',
    });
  });

  it('stops at the page cap and reports partial_listing', async () => {
    const pages = Array.from({ length: PELICAN_SYNC_MAX_PAGES + 5 }, (_, i) =>
      serverPageBody([fakeServer(i + 1)], i + 1, 999),
    );
    const { client, fetchImpl } = clientServing(pages);
    expect(await fetchAllServers(client)).toEqual({
      ok: false,
      code: 'partial_listing',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(PELICAN_SYNC_MAX_PAGES);
  });

  it('collapses a server repeated across shifted pages', async () => {
    const { client } = clientServing([
      serverPageBody([fakeServer(1), fakeServer(2)], 1, 2),
      serverPageBody([fakeServer(2), fakeServer(3)], 2, 2),
    ]);
    const res = await fetchAllServers(client);
    expect(res.ok && res.servers.map((s) => s.identifier)).toEqual([
      '00000001',
      '00000002',
      '00000003',
    ]);
  });
});

describe('toListedServer / dedupeByUuid', () => {
  it(`truncates the name to ${PELICAN_SERVER_NAME_MAX} chars`, () => {
    const s = { ...fakeServer(1), name: 'x'.repeat(250) };
    expect(toListedServer(s).name).toHaveLength(PELICAN_SERVER_NAME_MAX);
  });

  it('keeps the last occurrence of a duplicated uuid', () => {
    const a = toListedServer(fakeServer(1));
    const renamed = { ...a, name: 'Renamed' };
    expect(dedupeByUuid([a, renamed])).toEqual([renamed]);
  });
});
