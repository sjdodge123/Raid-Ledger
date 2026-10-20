/**
 * ROK-1598 L3 (spec §4.2 T16–T22): `AppleCalendarAdapter` driven through
 * `FakeCalDavServer` behind the `caldavFetch` seam — the shared read + write
 * conformance suites (T16), the ctag cursor (T17/T18), auth failures (T19),
 * the 412 rules (T20, D6), the picker (T21), password connect (T22) and
 * `withDiscovery` (§2.3).
 */
import {
  ProviderAuthError,
  ProviderRequestError,
  TransientError,
} from '../calendar-provider.errors';
import type {
  CalDavCredentials,
  CopyEventInput,
  CopyRef,
} from '../calendar-provider.interface';
import { describeCalendarReadConformance } from '../testing/calendar-read.conformance.spec-helpers';
import { describeCalendarWriteConformance } from '../testing/calendar-write.conformance.spec-helpers';
import * as appleHttp from './apple-caldav-http';
import type { CalDavHttpRequest } from './apple-caldav-http';
import {
  FAKE_CALDAV_CREDENTIALS,
  FAKE_HOME_SET_URL,
  FAKE_PARTITION_ORIGIN,
  FAKE_PRINCIPAL_URL,
  FakeCalDavServer,
} from './apple-caldav.spec-helpers';
import { AppleCalendarAdapter } from './apple.adapter';

const CREDS: CalDavCredentials = {
  kind: 'caldav',
  ...FAKE_CALDAV_CREDENTIALS,
  principalUrl: FAKE_PRINCIPAL_URL,
  homeSetUrl: FAKE_HOME_SET_URL,
};
const RANGE = {
  start: new Date('2026-11-01T00:00:00.000Z'),
  end: new Date('2026-11-29T00:00:00.000Z'),
};
const COPY: CopyEventInput = {
  copyId: 'rl:0123456789ab:42:7',
  title: 'Raid Night',
  description: 'https://raid.example/events/42',
  url: 'https://raid.example/events/42',
  start: new Date('2026-11-05T19:00:00.000Z'),
  end: new Date('2026-11-05T22:00:00.000Z'),
  tentative: false,
};

let server: FakeCalDavServer;
let persist: jest.Mock<Promise<void>, [CalDavCredentials]>;

function setup(login = FAKE_CALDAV_CREDENTIALS): AppleCalendarAdapter {
  server = new FakeCalDavServer(login);
  jest.spyOn(appleHttp, 'caldavFetch').mockImplementation(server.handle);
  persist = jest.fn<Promise<void>, [CalDavCredentials]>();
  persist.mockResolvedValue(undefined);
  return new AppleCalendarAdapter(persist);
}

afterEach(() => jest.restoreAllMocks());

const urlOf = (ref: CopyRef) =>
  `${server.collectionUrl(ref.calendarId)}${ref.providerEventId}`;
const sent = (method: CalDavHttpRequest['method'], from = 0) =>
  server.requests.slice(from).filter((r) => r.method === method);

/** Stub one method's answers; everything else reaches the fake. */
function answer(method: CalDavHttpRequest['method'], status: number): void {
  const reply = {
    status,
    text: '',
    etag: null,
    location: null,
    retryAfter: null,
  };
  jest
    .spyOn(appleHttp, 'caldavFetch')
    .mockImplementation((req) =>
      req.method === method ? Promise.resolve(reply) : server.handle(req),
    );
}

// T16: the shared suites, unchanged, with `home` as the main calendar.
describeCalendarReadConformance(() => {
  const provider = setup();
  return {
    provider,
    credentials: CREDS,
    primaryCalendarId: 'home',
    seedEvent: (id, e) => void server.seedEvent(id, e),
    failNextRead: (kind) => server.failNext(kind),
  };
}, 'AppleCalendarAdapter');

describeCalendarWriteConformance(() => {
  const provider = setup();
  return {
    provider,
    credentials: CREDS,
    primaryCalendarId: 'home',
    removeCalendarRemotely: (id) => server.removeCalendar(id),
    readCopy: (ref) => {
      const obj = server.object(urlOf(ref));
      if (!obj) return Promise.resolve(null);
      const title = /^SUMMARY:([^\r\n]*)/m.exec(obj.ics)?.[1] ?? '';
      const busy = /^TRANSP:OPAQUE\r?$/m.test(obj.ics);
      return Promise.resolve({ title, busy });
    },
  };
}, 'AppleCalendarAdapter');

describe('AppleCalendarAdapter.fetchBusy — ctag cursor (D7)', () => {
  it('T17: nothing changed → unchanged, no REPORT, cursor returned', async () => {
    const a = setup();
    server.seedEvent('home', { start: COPY.start, end: COPY.end, busy: true });
    const first = await a.fetchBusy(CREDS, RANGE, ['home', 'shared-ro']);
    expect(first.blocks).toHaveLength(1);
    const mark = server.requests.length;
    const again = await a.fetchBusy(
      CREDS,
      RANGE,
      ['home', 'shared-ro'],
      first.cursor,
    );
    expect(again).toEqual({
      blocks: [],
      unchanged: true,
      cursor: first.cursor,
    });
    expect(sent('REPORT', mark)).toHaveLength(0);
  });

  const DAY = 86_400_000;
  interface CursorCase {
    name: string;
    ids: string[];
    range: { start: Date; end: Date };
    change: () => void;
  }
  const CASES: CursorCase[] = [
    {
      name: 'home ctag bumped',
      ids: ['home'],
      range: RANGE,
      change: () => {
        server.seedEvent('home', {
          start: COPY.start,
          end: COPY.end,
          busy: true,
        });
      },
    },
    {
      name: 'range moved a day',
      ids: ['home'],
      range: {
        start: new Date(RANGE.start.getTime() + DAY),
        end: new Date(RANGE.end.getTime() + DAY),
      },
      change: () => undefined,
    },
    {
      name: 'calendar id added',
      ids: ['home', 'shared-ro'],
      range: RANGE,
      change: () => undefined,
    },
  ];
  it.each(CASES)(
    'T18: $name → full REPORT of every requested calendar, new cursor',
    async ({ ids, range, change }) => {
      const a = setup();
      const first = await a.fetchBusy(CREDS, RANGE, ['home']);
      change();
      const mark = server.requests.length;
      const next = await a.fetchBusy(CREDS, range, ids, first.cursor);
      expect(next.unchanged).toBeUndefined();
      expect(sent('REPORT', mark)).toHaveLength(ids.length);
      expect(next.cursor).not.toEqual(first.cursor);
    },
  );
});

describe('AppleCalendarAdapter — errors and 412 rules', () => {
  it('T19: a 401 rejects fetchBusy and upsertEvent with ProviderAuthError', async () => {
    const a = setup();
    server.failNext('auth');
    await expect(a.fetchBusy(CREDS, RANGE, ['home'])).rejects.toBeInstanceOf(
      ProviderAuthError,
    );
    server.failNext('auth');
    await expect(
      a.upsertEvent(CREDS, 'home', COPY, null),
    ).rejects.toBeInstanceOf(ProviderAuthError);
  });

  it('T20: our copy edited in Apple Calendar → 412 → etag re-read → PUT wins, same id', async () => {
    const a = setup();
    const ref = await a.upsertEvent(CREDS, 'home', COPY, null);
    server.editObject(urlOf(ref));
    const edited = server.object(urlOf(ref))?.etag;
    const mark = server.requests.length;
    const next = await a.upsertEvent(CREDS, 'home', COPY, ref);
    expect(next.providerEventId).toBe(ref.providerEventId);
    expect(sent('PUT', mark).map((r) => r.ifMatch)).toEqual([ref.etag, edited]);
    expect(next.etag).toBe(server.object(urlOf(ref))?.etag);
  });

  it('a second 412 on update is TransientError(etag_conflict)', async () => {
    const a = setup();
    const ref = await a.upsertEvent(CREDS, 'home', COPY, null);
    answer('PUT', 412);
    await expect(a.upsertEvent(CREDS, 'home', COPY, ref)).rejects.toEqual(
      new TransientError('etag_conflict'),
    );
  });

  it('a PUT with no ETag header falls back to a Depth-0 getetag', async () => {
    const a = setup();
    server.putReturnsEtag = false;
    const ref = await a.upsertEvent(CREDS, 'home', COPY, null);
    expect(ref.etag).toBe(server.object(urlOf(ref))?.etag);
    expect(sent('PUT')[0]?.ifNoneMatch).toBe('*');
  });

  it('deleteEvent after a user edit (412) deletes once unconditionally', async () => {
    const a = setup();
    const ref = await a.upsertEvent(CREDS, 'home', COPY, null);
    server.editObject(urlOf(ref));
    await a.deleteEvent(CREDS, ref);
    expect(server.object(urlOf(ref))).toBeNull();
    expect(sent('DELETE').map((r) => r.ifMatch)).toEqual([ref.etag, null]);
  });

  it('a refused MKCALENDAR is ProviderRequestError(mkcalendar_refused)', async () => {
    const a = setup();
    answer('MKCALENDAR', 403);
    await expect(a.ensureRaidLedgerCalendar(CREDS, null)).rejects.toEqual(
      new ProviderRequestError('mkcalendar_refused'),
    );
  });

  it('the dedicated calendar is MKCALENDAR raid-ledger-<uuid>/ named "Raid Ledger"', async () => {
    const a = setup();
    const id = await a.ensureRaidLedgerCalendar(CREDS, null);
    expect(id).toMatch(/^raid-ledger-[0-9a-f-]{36}$/);
    const rows = await a.listCalendars(CREDS);
    expect(rows.find((r) => r.id === id)?.name).toBe('Raid Ledger');
  });

  it('OAuth credentials are refused; the OAuth methods are unsupported', async () => {
    const a = setup();
    const oauth = {
      kind: 'oauth' as const,
      accessToken: 'x',
      refreshToken: 'y',
      expiresAt: '2030-01-01T00:00:00Z',
      scopes: [],
    };
    await expect(a.listCalendars(oauth)).rejects.toEqual(
      new ProviderAuthError('credentials_kind'),
    );
    await expect(a.buildAuthUrl()).rejects.toEqual(
      new ProviderRequestError('not_oauth'),
    );
    await expect(a.refresh()).rejects.toBeInstanceOf(ProviderRequestError);
    await expect(a.isConfigured()).resolves.toBe(true);
    await expect(a.disconnect()).resolves.toBeUndefined();
    expect(server.requests).toHaveLength(0);
  });
});

describe('AppleCalendarAdapter — picker, connect, discovery', () => {
  it('T21: home is primary + writable, shared-ro read-only, reminders absent, ids are segments', async () => {
    const rows = await setup().listCalendars(CREDS);
    expect(rows).toEqual([
      {
        id: 'home',
        name: 'Home',
        primary: true,
        writable: true,
        isRaidLedger: false,
      },
      {
        id: 'shared-ro',
        name: 'Shared',
        primary: false,
        writable: false,
        isRaidLedger: false,
      },
    ]);
    expect(rows.map((r) => r.id).join()).not.toMatch(/1234567|\//);
  });

  it('T22: subject is the lowercased email, label the trimmed one, creds carry the home set', async () => {
    const login = { ...FAKE_CALDAV_CREDENTIALS, username: 'Me@iCloud.com' };
    const a = setup(login);
    const out = await a.connectWithPassword({
      email: 'Me@iCloud.com ',
      appPassword: login.appPassword,
    });
    expect(out).toEqual({
      accountSubject: 'me@icloud.com',
      accountLabel: 'Me@iCloud.com',
      credentials: {
        kind: 'caldav',
        ...login,
        principalUrl: FAKE_PRINCIPAL_URL,
        homeSetUrl: FAKE_HOME_SET_URL,
      },
    });
    expect(sent('PROPFIND').at(-1)?.depth).toBe('1');
  });

  it('T22: a wrong password → ProviderAuthError naming neither input', async () => {
    const a = setup();
    const email = 'Someone@iCloud.example';
    const appPassword = 'wrong-pass-zzzz';
    const err: unknown = await a
      .connectWithPassword({ email, appPassword })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderAuthError);
    const text =
      err instanceof Error ? `${err.message} ${err.stack ?? ''}` : '';
    expect(text).not.toMatch(/someone@icloud\.example|wrong-pass-zzzz/i);
  });

  it('no stored home set → discovers, persists, then lists', async () => {
    const a = setup();
    const { homeSetUrl: _h, principalUrl: _p, ...bare } = CREDS;
    const rows = await a.listCalendars(bare);
    expect(rows.map((r) => r.id)).toEqual(['home', 'shared-ro']);
    expect(persist).toHaveBeenCalledWith({ ...CREDS });
  });

  it('a moved home set (404) → rediscovers once, persists the new one, retries', async () => {
    const a = setup();
    const stale = {
      ...CREDS,
      homeSetUrl: `${FAKE_PARTITION_ORIGIN}/7654321/calendars/`,
    };
    const out = await a.fetchBusy(stale, RANGE, ['home']);
    expect(out.missingCalendarIds).toBeUndefined();
    expect(persist).toHaveBeenCalledTimes(1);
    expect(persist).toHaveBeenCalledWith(CREDS);
  });

  it('a stored home set that works is never rediscovered or persisted', async () => {
    const a = setup();
    await a.fetchBusy(CREDS, RANGE, ['home']);
    expect(persist).not.toHaveBeenCalled();
    expect(sent('PROPFIND').map((r) => r.url)).toEqual([FAKE_HOME_SET_URL]);
  });
});
