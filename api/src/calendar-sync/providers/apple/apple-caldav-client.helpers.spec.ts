/**
 * ROK-1598 L1 — T3 (status table), T4 (partition redirect discovery), T5
 * (hostile redirect refused), plus the D6 etag / If-Match flows, all driven
 * through `FakeCalDavServer` behind the `caldavFetch` seam.
 */
import {
  CalendarProviderError,
  NotFoundError,
  ProviderAuthError,
  ProviderRequestError,
  RateLimitError,
  TransientError,
} from '../calendar-provider.errors';
import * as appleHttp from './apple-caldav-http';
import type { CalDavHttpResponse } from './apple-caldav-http';
import * as client from './apple-caldav-client.helpers';
import {
  FAKE_CALDAV_CREDENTIALS as AUTH,
  FAKE_HOME_SET_URL,
  FAKE_PRINCIPAL_URL,
  FakeCalDavServer,
} from './apple-caldav.spec-helpers';

const res = (status: number, retryAfter: string | null = null) =>
  ({
    status,
    text: '',
    etag: null,
    location: null,
    retryAfter,
  }) satisfies CalDavHttpResponse;

/** What `p` rejects with, as `{ name, reason }` (or `resolved`). */
async function failure(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    return e instanceof CalendarProviderError
      ? { name: e.name, reason: e.reason }
      : { name: 'foreign', reason: String(e) };
  }
  return { name: 'resolved', reason: '' };
}

describe('mapCalDavStatus (T3)', () => {
  it.each([
    [401, 'data', ProviderAuthError, 'caldav_401'],
    [403, 'discovery', ProviderAuthError, 'caldav_403'],
    [403, 'data', ProviderRequestError, 'caldav_403'],
    [404, 'data', NotFoundError, 'http_404'],
    [410, 'data', NotFoundError, 'http_410'],
    [429, 'data', RateLimitError, 'http_429'],
    [500, 'data', TransientError, 'http_500'],
    [503, 'data', TransientError, 'http_503'],
    [400, 'data', ProviderRequestError, 'http_400'],
    [405, 'data', ProviderRequestError, 'http_405'],
  ] as const)('%i (%s) → %p', (status, ctx, cls, reason) => {
    let thrown: unknown = null;
    try {
      client.mapCalDavStatus(res(status), ctx);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(cls);
    expect(thrown instanceof CalendarProviderError && thrown.reason).toBe(
      reason,
    );
  });

  it('429 / 503 with Retry-After → RateLimitError carrying the wait', () => {
    for (const status of [429, 503]) {
      let wait: number | null = null;
      try {
        client.mapCalDavStatus(res(status, '30'));
      } catch (e) {
        wait = e instanceof RateLimitError ? e.retryAfterMs : null;
      }
      expect(wait).toBe(30_000);
    }
  });

  it.each([200, 201, 204, 207, 412])('%i passes through', (status) => {
    const r = res(status);
    expect(client.mapCalDavStatus(r)).toBe(r);
  });
});

let server: FakeCalDavServer;
let seam: jest.SpyInstance;

/** Fresh fake behind the seam (each fake-driven describe's `beforeEach`). */
function installFake(): void {
  server = new FakeCalDavServer();
  seam = jest.spyOn(appleHttp, 'caldavFetch').mockImplementation(server.handle);
}
afterEach(() => jest.restoreAllMocks());

describe('discover (T4)', () => {
  beforeEach(installFake);
  it('follows the partition redirect and returns the p07 home set', async () => {
    await expect(client.discover(AUTH)).resolves.toEqual({
      principalUrl: FAKE_PRINCIPAL_URL,
      homeSetUrl: FAKE_HOME_SET_URL,
    });
    expect(server.requests.map((r) => [r.method, r.host, r.depth])).toEqual([
      ['PROPFIND', 'caldav.icloud.com', '0'],
      ['PROPFIND', 'p07-caldav.icloud.com', '0'],
      ['PROPFIND', 'p07-caldav.icloud.com', '0'],
    ]);
    expect(server.requests.every((r) => r.hadAuth)).toBe(true);
  });

  it('wrong app password → ProviderAuthError(caldav_401)', async () => {
    const bad = { ...AUTH, appPassword: 'zzzz-zzzz-zzzz-zzzz' };
    expect(await failure(client.discover(bad))).toEqual({
      name: 'ProviderAuthError',
      reason: 'caldav_401',
    });
  });

  it.each([
    ['transient', 'TransientError', 'http_503'],
    ['rate', 'RateLimitError', 'http_429'],
    ['network', 'TransientError', 'network'],
  ] as const)('failNext(%s) → %s(%s)', async (kind, name, reason) => {
    server.failNext(kind);
    expect(await failure(client.discover(AUTH))).toEqual({ name, reason });
  });
});

describe('redirect rules (T5)', () => {
  beforeEach(installFake);
  it.each([
    'https://evil.example/steal',
    'http://p07-caldav.icloud.com/1234567/principal/',
    'https://caldav.icloud.com.evil.example/',
    'https://p07-caldav.icloud.com:8443/',
  ])('refuses a redirect to %s without sending to it', async (target) => {
    server.redirectTo(target);
    expect(await failure(client.discover(AUTH))).toEqual({
      name: 'TransientError',
      reason: 'redirect_refused',
    });
    expect(server.requests).toHaveLength(1);
    expect(server.requests.map((r) => r.url)).not.toContain(target);
  });

  it('refuses a first-hop URL off the allowlist without any request', async () => {
    const p = client.listCollections(AUTH, 'https://evil.example/cal/');
    expect(await failure(p)).toEqual({
      name: 'TransientError',
      reason: 'url_refused',
    });
    expect(seam).not.toHaveBeenCalled();
  });

  it(`stops after ${client.MAX_REDIRECT_HOPS} hops`, async () => {
    seam.mockResolvedValue({ ...res(301), location: FAKE_HOME_SET_URL });
    const p = client.listCollections(AUTH, FAKE_HOME_SET_URL);
    expect(await failure(p)).toEqual({
      name: 'TransientError',
      reason: 'redirect_loop',
    });
    expect(seam).toHaveBeenCalledTimes(client.MAX_REDIRECT_HOPS + 1);
  });
});

describe('listCollections + queryEvents', () => {
  beforeEach(installFake);
  it('keeps VEVENT calendars and reads write privileges (D9)', async () => {
    const cals = await client.listCollections(AUTH, FAKE_HOME_SET_URL);
    expect(cals.map((c) => [c.id, c.displayName, c.writable])).toEqual([
      ['home', 'Home', true],
      ['shared-ro', 'Shared', false],
    ]);
    expect(cals[0]?.ctag).toBe(server.ctag('home'));
  });

  it('returns only objects overlapping the range', async () => {
    const inRange = server.seedEvent('home', {
      start: new Date('2026-10-21T19:00:00Z'),
      end: new Date('2026-10-21T21:00:00Z'),
      busy: true,
    });
    server.seedEvent('home', {
      start: new Date('2026-12-01T19:00:00Z'),
      end: new Date('2026-12-01T21:00:00Z'),
      busy: true,
    });
    const objects = await client.queryEvents(
      AUTH,
      server.collectionUrl('home'),
      {
        start: new Date('2026-10-20T00:00:00Z'),
        end: new Date('2026-11-17T00:00:00Z'),
      },
    );
    expect(objects.map((o) => [o.href, o.etag])).toEqual([
      [inRange, server.object(inRange)?.etag],
    ]);
    expect(objects[0]?.ics).toContain('DTSTART:20261021T190000Z');
  });

  it('a removed calendar → NotFoundError', async () => {
    server.removeCalendar('home');
    const p = client.queryEvents(AUTH, server.collectionUrl('home'), {
      start: new Date('2026-10-20T00:00:00Z'),
      end: new Date('2026-10-21T00:00:00Z'),
    });
    expect(await failure(p)).toEqual({
      name: 'NotFoundError',
      reason: 'http_404',
    });
  });
});

describe('etag + If-Match flows (D6)', () => {
  beforeEach(installFake);
  const url = () => `${server.collectionUrl('home')}rl-abc.ics`;
  const ICS = 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n';

  it('create with If-None-Match: * → ok + etag; repeat → precondition_failed', async () => {
    const created = await client.putObject(AUTH, url(), ICS, {
      ifNoneMatch: '*',
    });
    expect(created).toEqual({
      status: 'ok',
      etag: server.object(url())?.etag,
    });
    await expect(
      client.putObject(AUTH, url(), ICS, { ifNoneMatch: '*' }),
    ).resolves.toEqual({ status: 'precondition_failed' });
    await expect(client.getEtag(AUTH, url())).resolves.toBe(
      server.object(url())?.etag,
    );
  });

  it('update with a stale etag after a user edit → precondition_failed', async () => {
    const first = await client.putObject(AUTH, url(), ICS, {
      ifNoneMatch: '*',
    });
    const etag = first.status === 'ok' ? (first.etag ?? '') : '';
    server.editObject(url());
    await expect(
      client.putObject(AUTH, url(), ICS, { ifMatch: etag }),
    ).resolves.toEqual({
      status: 'precondition_failed',
    });
    const fresh = (await client.getEtag(AUTH, url())) ?? '';
    const second = await client.putObject(AUTH, url(), ICS, {
      ifMatch: fresh,
    });
    expect(second.status).toBe('ok');
    expect(server.requests.at(-1)?.ifMatch).toBe(fresh);
  });

  it('every write bumps the collection ctag', async () => {
    const before = server.ctag('home');
    await client.putObject(AUTH, url(), ICS);
    expect(server.ctag('home')).not.toBe(before);
  });

  it('a PUT answered without ETag → etag null', async () => {
    server.putReturnsEtag = false;
    await expect(client.putObject(AUTH, url(), ICS)).resolves.toEqual({
      status: 'ok',
      etag: null,
    });
  });
});

describe('PUT refusals + DELETE (D6)', () => {
  beforeEach(installFake);
  const url = () => `${server.collectionUrl('home')}rl-abc.ics`;
  const ICS = 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n';

  it('PUT to a read-only calendar → ProviderRequestError(caldav_403)', async () => {
    const p = client.putObject(
      AUTH,
      `${server.collectionUrl('shared-ro')}x.ics`,
      ICS,
    );
    expect(await failure(p)).toEqual({
      name: 'ProviderRequestError',
      reason: 'caldav_403',
    });
  });

  it('PUT If-Match into a removed calendar → NotFoundError', async () => {
    server.removeCalendar('home');
    const p = client.putObject(AUTH, url(), ICS, { ifMatch: '"e1"' });
    expect(await failure(p)).toEqual({
      name: 'NotFoundError',
      reason: 'http_404',
    });
  });

  it('DELETE honours If-Match, then 404s', async () => {
    await client.putObject(AUTH, url(), ICS);
    await expect(client.deleteObject(AUTH, url(), '"stale"')).resolves.toEqual({
      status: 'precondition_failed',
    });
    await expect(client.deleteObject(AUTH, url())).resolves.toEqual({
      status: 'ok',
    });
    expect(server.object(url())).toBeNull();
    expect(await failure(client.deleteObject(AUTH, url()))).toEqual({
      name: 'NotFoundError',
      reason: 'http_404',
    });
  });
});

describe('mkcalendar', () => {
  beforeEach(installFake);
  it('creates a VEVENT calendar; a second create → refusal', async () => {
    const at = server.collectionUrl('raid-ledger-1');
    await client.mkcalendar(AUTH, at, 'Raid & Ledger');
    const cals = await client.listCollections(AUTH, FAKE_HOME_SET_URL);
    expect(cals.find((c) => c.id === 'raid-ledger-1')?.displayName).toBe(
      'Raid & Ledger',
    );
    expect(await failure(client.mkcalendar(AUTH, at, 'x'))).toEqual({
      name: 'ProviderRequestError',
      reason: 'http_405',
    });
  });
});

describe('caldavFetch (the seam itself)', () => {
  it('sends Basic auth, Depth, Prefer and redirect: manual; returns headers', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response('<x/>', {
        status: 301,
        headers: { ETag: '"a"', Location: '/n/' },
      }),
    );
    const out = await appleHttp.caldavFetch({
      method: 'PROPFIND',
      url: appleHttp.APPLE_CALDAV_BASE,
      auth: AUTH,
      depth: '0',
      body: '<b/>',
    });
    const basic = Buffer.from(`${AUTH.username}:${AUTH.appPassword}`).toString(
      'base64',
    );
    expect(fetchSpy).toHaveBeenCalledWith(
      appleHttp.APPLE_CALDAV_BASE,
      expect.objectContaining({
        method: 'PROPFIND',
        redirect: 'manual',
        body: '<b/>',
        headers: {
          Authorization: `Basic ${basic}`,
          Depth: '0',
          'Content-Type': 'application/xml; charset=utf-8',
          Prefer: 'return=minimal',
        },
      }),
    );
    expect(out).toEqual({
      status: 301,
      text: '<x/>',
      etag: '"a"',
      location: '/n/',
      retryAfter: null,
    });
  });
});
