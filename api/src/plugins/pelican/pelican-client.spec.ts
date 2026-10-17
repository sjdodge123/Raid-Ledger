import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Logger } from '@nestjs/common';
import { PelicanClient, type PelicanResult } from './pelican-client';
import { jsonResponse, loadPelicanFixture } from './testing/pelican-fixtures';

const KEY = 'pacc_FAKEKEYfortests0123456789';
const BASE = 'https://panel.example.test/panel/';

type FetchArgs = Parameters<typeof fetch>;

function setup(respond: (...args: FetchArgs) => Promise<Response>) {
  const fetchMock = jest.fn<Promise<Response>, FetchArgs>(respond);
  const client = new PelicanClient({
    baseUrl: BASE,
    apiKey: KEY,
    fetchImpl: fetchMock,
  });
  return { client, fetchMock };
}

function lastCall(fetchMock: jest.Mock<Promise<Response>, FetchArgs>) {
  const call = fetchMock.mock.calls.at(-1);
  if (!call) throw new Error('fetch was not called');
  const input = call[0];
  const url =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
  return { url, init: call[1] ?? {} };
}

function errorOf<T>(result: PelicanResult<T>) {
  if (result.ok) throw new Error('expected a failed result, got ok');
  return result.error;
}

afterEach(() => jest.restoreAllMocks());
beforeEach(() => {
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
});

describe('PelicanClient requests', () => {
  it('lists servers with Bearer auth, a timeout and redirect:error', async () => {
    const { client, fetchMock } = setup(() =>
      Promise.resolve(jsonResponse(loadPelicanFixture('servers-page'))),
    );
    const result = await client.listServers({ perPage: 1 });
    expect(result).toMatchObject({ ok: true });
    if (result.ok) expect(result.data.pagination.total).toBe(2);
    const { url, init } = lastCall(fetchMock);
    expect(url).toBe(
      'https://panel.example.test/panel/api/client?page=1&per_page=1',
    );
    expect(init.method).toBe('GET');
    expect(init.redirect).toBe('error');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.headers).toEqual({
      Authorization: `Bearer ${KEY}`,
      Accept: 'application/json',
    });
  });

  it('clamps per_page to Pelican’s 100 cap', async () => {
    const { client, fetchMock } = setup(() =>
      Promise.resolve(jsonResponse(loadPelicanFixture('servers-page'))),
    );
    await client.listServers({ page: 0, perPage: 500 });
    expect(lastCall(fetchMock).url).toMatch(/\?page=1&per_page=100$/);
  });

  it('encodes the server id and parses resources', async () => {
    const { client, fetchMock } = setup(() =>
      Promise.resolve(jsonResponse(loadPelicanFixture('server-resources'))),
    );
    const result = await client.getResources('ab/c?d');
    expect(lastCall(fetchMock).url).toBe(
      'https://panel.example.test/panel/api/client/servers/ab%2Fc%3Fd/resources',
    );
    expect(result.ok && result.data.current_state).toBe('running');
  });

  it('parses schedules with tasks', async () => {
    const { client, fetchMock } = setup(() =>
      Promise.resolve(jsonResponse(loadPelicanFixture('server-schedules'))),
    );
    const result = await client.listSchedules('11111111');
    expect(lastCall(fetchMock).url).toMatch(/\/servers\/11111111\/schedules$/);
    expect(result.ok && result.data.map((s) => s.tasks.length)).toEqual([1, 1]);
  });

  it('fetches websocket credentials for the encoded server id', async () => {
    const body = {
      data: {
        token: 'jwt.fake.token',
        socket: 'wss://node.example.test/api/servers/u/ws',
      },
    };
    const { client, fetchMock } = setup(() =>
      Promise.resolve(jsonResponse(body)),
    );
    const result = await client.getWebsocketCredentials('ab/c');
    const { url, init } = lastCall(fetchMock);
    expect(url).toBe(
      'https://panel.example.test/panel/api/client/servers/ab%2Fc/websocket',
    );
    expect(init.headers).toEqual({
      Authorization: `Bearer ${KEY}`,
      Accept: 'application/json',
    });
    expect(result).toEqual({ ok: true, data: body.data });
  });

  it.each([
    [
      'a non-ws socket URL',
      { data: { token: 't', socket: 'https://n.test/ws' } },
    ],
    ['an empty token', { data: { token: '', socket: 'wss://n.test/ws' } }],
    ['a missing data envelope', { token: 't', socket: 'wss://n.test/ws' }],
  ])('maps websocket credentials with %s to bad_response', async (_l, body) => {
    const { client } = setup(() => Promise.resolve(jsonResponse(body)));
    const result = await client.getWebsocketCredentials('abc');
    expect(errorOf(result)).toEqual({ kind: 'bad_response', status: 200 });
  });

  it('refuses an invalid panel URL at construction without echoing the key', () => {
    expect(
      () => new PelicanClient({ baseUrl: 'ftp://x.example.test', apiKey: KEY }),
    ).toThrow(/^Invalid Pelican panel URL$/);
  });
});

describe('PelicanClient error mapping', () => {
  it('rejects a papp_ application key before any network call', async () => {
    const fetchMock = jest.fn<Promise<Response>, FetchArgs>();
    const client = new PelicanClient({
      baseUrl: BASE,
      apiKey: 'papp_FAKEapplicationKEY',
      fetchImpl: fetchMock,
    });
    expect(errorOf(await client.listServers())).toEqual({
      kind: 'application_key',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [401, {}, { kind: 'unauthorized', status: 401 }],
    [500, {}, { kind: 'http', status: 500 }],
    [429, {}, { kind: 'http', status: 429 }],
    [
      403,
      { errors: [{ code: 'AccessDeniedHttpException', detail: 'nope' }] },
      { kind: 'forbidden', status: 403, ipNotAllowed: false },
    ],
  ])('maps HTTP %p to %p', async (status, body, expected) => {
    const { client } = setup(() => Promise.resolve(jsonResponse(body, status)));
    expect(errorOf(await client.listServers())).toEqual(expected);
  });
});

describe('PelicanClient 403 + thrown-error mapping', () => {
  it('flags a 403 from the key allowed_ips check', async () => {
    const { client } = setup(() =>
      Promise.resolve(
        jsonResponse(loadPelicanFixture('error-ip-not-allowed'), 403),
      ),
    );
    expect(errorOf(await client.listServers())).toEqual({
      kind: 'forbidden',
      status: 403,
      ipNotAllowed: true,
    });
  });

  it.each([
    [
      'a TimeoutError',
      new DOMException('timed out', 'TimeoutError'),
      'timeout',
    ],
    ['an AbortError', new DOMException('aborted', 'AbortError'), 'timeout'],
    [
      'an undici redirect',
      new TypeError('fetch failed', {
        cause: new Error('unexpected redirect'),
      }),
      'redirect',
    ],
    [
      'a refused connection',
      new TypeError('fetch failed', {
        cause: new Error('connect ECONNREFUSED'),
      }),
      'network',
    ],
  ])('maps %s to %p', async (_label, thrown, kind) => {
    const { client } = setup(() => Promise.reject(thrown));
    expect(errorOf(await client.listServers()).kind).toBe(kind);
  });
});

describe('PelicanClient body + timeout mapping', () => {
  it.each([
    ['an unexpected shape', jsonResponse({ hello: 'world' })],
    ['a non-JSON body', new Response('<html>login</html>', { status: 200 })],
  ])('maps %s to bad_response', async (_label, response) => {
    const { client } = setup(() => Promise.resolve(response));
    expect(errorOf(await client.listServers())).toEqual({
      kind: 'bad_response',
      status: 200,
    });
  });

  it('times out through the real AbortSignal.timeout', async () => {
    const client = new PelicanClient({
      baseUrl: BASE,
      apiKey: KEY,
      timeoutMs: 5,
      fetchImpl: (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const reason: unknown = init.signal?.reason;
            reject(reason instanceof Error ? reason : new Error('aborted'));
          });
        }),
    });
    expect(errorOf(await client.listServers()).kind).toBe('timeout');
  });
});

describe('PelicanClient against a real redirecting server', () => {
  let server: Server;
  let base = '';
  beforeAll(async () => {
    server = createServer((_req, res) => {
      res.writeHead(302, { Location: 'http://elsewhere.example.test/' });
      res.end();
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const { port } = server.address() as AddressInfo;
    base = `http://127.0.0.1:${port}`;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it('refuses to follow the redirect (global fetch, redirect:error)', async () => {
    const client = new PelicanClient({ baseUrl: base, apiKey: KEY });
    expect(errorOf(await client.listServers()).kind).toBe('redirect');
  });
});

describe('PelicanClient never leaks the key (AC7)', () => {
  it('keeps the key out of every log line and result', async () => {
    const spies = (['log', 'warn', 'error', 'debug'] as const).map((m) =>
      jest.spyOn(Logger.prototype, m).mockImplementation(() => {}),
    );
    const failures: Array<() => Promise<Response>> = [
      () => Promise.resolve(jsonResponse({}, 401)),
      () =>
        Promise.resolve(
          jsonResponse(loadPelicanFixture('error-ip-not-allowed'), 403),
        ),
      () => Promise.resolve(jsonResponse({ echo: KEY }, 500)),
      () => Promise.resolve(jsonResponse({ echo: KEY })),
      () => Promise.reject(new DOMException('t', 'TimeoutError')),
      () =>
        Promise.reject(
          new TypeError('fetch failed', {
            cause: new Error(`unexpected redirect ${KEY}`),
          }),
        ),
      () => Promise.reject(new Error(`socket closed ${KEY}`)),
    ];
    const results: unknown[] = [];
    for (const respond of failures) {
      const { client } = setup(respond);
      results.push(await client.listServers(), await client.getResources('x'));
    }
    const logged = spies
      .flatMap((s) => s.mock.calls)
      .map((c) => JSON.stringify(c));
    expect(logged.length).toBeGreaterThan(0);
    expect(logged.filter((line) => line.includes(KEY))).toEqual([]);
    expect(JSON.stringify(results)).not.toContain(KEY);
  });
});
