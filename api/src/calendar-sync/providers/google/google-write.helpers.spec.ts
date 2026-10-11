/**
 * ROK-1596 G1: Google Calendar write helpers — the exact request bodies
 * (confirmed + tentative), the rlCopyId write half of spec §5 (F3), every
 * status mapping, Retry-After in both forms, and that no error ever carries
 * the access token or a response body. No real network: the seam is spied.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import * as googleHttp from './google-http';
import {
  GOOGLE_CALENDAR_API,
  buildGoogleEventBody,
  deleteGoogleCalendar,
  deleteGoogleEvent,
  findGoogleEventByCopyId,
  getGoogleCalendar,
  insertGoogleCalendar,
  insertGoogleEvent,
  patchGoogleEvent,
} from './google-write.helpers';
import {
  NotFoundError,
  ProviderAuthError,
  ProviderRequestError,
  RateLimitError,
  TransientError,
} from '../calendar-provider.errors';
import type { CopyEventInput } from '../calendar-provider.interface';
import {
  buildCopyId,
  deriveInstanceId,
  parseCopyId,
} from '../rl-copy-id.helpers';

type Json = Record<string, unknown>;
const fixture = (name: string): Json =>
  JSON.parse(
    readFileSync(join(__dirname, '__fixtures__', `${name}.json`), 'utf8'),
  ) as Json;

const TOKEN = 'ya29.access-token-sentinel';
const CAL = 'fixture-rl-calendar@group.calendar.google.com';
const CAL_URL = `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(CAL)}`;
const INSTANCE = deriveInstanceId('raid.example.test');
const COPY_ID = buildCopyId({ instanceId: INSTANCE, eventId: 42, userId: 7 });
const EVENT_URL = 'https://raid.example.test/events/42';
const NOW = Date.parse('2026-10-11T12:00:00Z');

const input = (tentative: boolean): CopyEventInput => ({
  copyId: COPY_ID,
  title: 'Molten Core',
  description: `${EVENT_URL}\n\nAdded by Raid Ledger`,
  url: EVENT_URL,
  start: new Date('2026-10-20T19:00:00Z'),
  end: new Date('2026-10-20T22:00:00Z'),
  tentative,
});

let req: jest.SpyInstance;
beforeEach(() => {
  req = jest.spyOn(googleHttp, 'googleJsonRequest');
});
afterEach(() => jest.restoreAllMocks());

const reply = (
  status: number,
  json: unknown = null,
  retryAfter: string | null = null,
) => req.mockResolvedValueOnce({ status, json, retryAfter });

const caught = async (p: Promise<unknown>): Promise<unknown> =>
  p.then(
    () => {
      throw new Error('expected a rejection');
    },
    (err: unknown) => err,
  );

describe('buildGoogleEventBody', () => {
  it('builds the exact confirmed body: plain title, Busy', () => {
    expect(buildGoogleEventBody(input(false))).toEqual({
      summary: 'Molten Core',
      description: `${EVENT_URL}\n\nAdded by Raid Ledger`,
      transparency: 'opaque',
      start: { dateTime: '2026-10-20T19:00:00.000Z' },
      end: { dateTime: '2026-10-20T22:00:00.000Z' },
      extendedProperties: { private: { rlCopyId: COPY_ID } },
      source: { title: 'Raid Ledger', url: EVENT_URL },
    });
  });

  it('builds the exact tentative body: (Tentative) prefix, Free', () => {
    expect(buildGoogleEventBody(input(true))).toEqual({
      summary: '(Tentative) Molten Core',
      description: `${EVENT_URL}\n\nAdded by Raid Ledger`,
      transparency: 'transparent',
      start: { dateTime: '2026-10-20T19:00:00.000Z' },
      end: { dateTime: '2026-10-20T22:00:00.000Z' },
      extendedProperties: { private: { rlCopyId: COPY_ID } },
      source: { title: 'Raid Ledger', url: EVENT_URL },
    });
  });

  it('builds the benched body (F11): (Bench) prefix, Free; bench wins', () => {
    for (const tentative of [false, true]) {
      const body = buildGoogleEventBody({ ...input(tentative), benched: true });
      expect(body.summary).toBe('(Bench) Molten Core');
      expect(body.transparency).toBe('transparent');
    }
  });

  it('sends only the allowed keys, at every level', () => {
    for (const tentative of [false, true]) {
      const body = buildGoogleEventBody(input(tentative));
      expect(Object.keys(body).sort()).toEqual([
        'description',
        'end',
        'extendedProperties',
        'source',
        'start',
        'summary',
        'transparency',
      ]);
      expect(Object.keys(body.extendedProperties.private)).toEqual([
        'rlCopyId',
      ]);
      expect(Object.keys(body.source).sort()).toEqual(['title', 'url']);
    }
  });

  it('stamps an rlCopyId that parseCopyId reads back (F3 write half)', () => {
    const body = buildGoogleEventBody(input(true));
    const raw = body.extendedProperties.private.rlCopyId;
    expect(parseCopyId(raw, INSTANCE)).toEqual({ eventId: 42, userId: 7 });
  });

  it('writes the bounds as UTC ISO whatever the input zone offset', () => {
    const body = buildGoogleEventBody({
      ...input(false),
      start: new Date('2026-10-20T21:00:00+02:00'),
    });
    expect(body.start.dateTime).toBe('2026-10-20T19:00:00.000Z');
  });
});

describe('calendar request shapes', () => {
  it('calendars.insert POSTs {summary:"Raid Ledger"}', async () => {
    reply(200, fixture('calendar-insert-ok'));
    await expect(insertGoogleCalendar(TOKEN)).resolves.toEqual({
      id: CAL,
      summary: 'Raid Ledger',
    });
    expect(req).toHaveBeenCalledWith(
      'POST',
      `${GOOGLE_CALENDAR_API}/calendars`,
      TOKEN,
      { summary: 'Raid Ledger' },
    );
  });

  it('calendars.get GETs the encoded id with no body', async () => {
    reply(200, fixture('calendar-insert-ok'));
    await expect(getGoogleCalendar(TOKEN, CAL)).resolves.toEqual({
      id: CAL,
      summary: 'Raid Ledger',
    });
    expect(req).toHaveBeenCalledWith('GET', CAL_URL, TOKEN, undefined);
  });

  it('calendars.delete DELETEs the encoded id', async () => {
    reply(204);
    await expect(deleteGoogleCalendar(TOKEN, CAL)).resolves.toBeUndefined();
    expect(req).toHaveBeenCalledWith('DELETE', CAL_URL, TOKEN, undefined);
  });
});

describe('event request shapes', () => {
  it('events.insert POSTs the copy body and returns id + etag', async () => {
    const ok = fixture('event-insert-ok');
    reply(200, ok);
    await expect(
      insertGoogleEvent(TOKEN, 'primary', input(false)),
    ).resolves.toEqual({
      calendarId: 'primary',
      providerEventId: 'fixtureevt0001',
      etag: ok.etag,
    });
    expect(req).toHaveBeenCalledWith(
      'POST',
      `${GOOGLE_CALENDAR_API}/calendars/primary/events`,
      TOKEN,
      buildGoogleEventBody(input(false)),
    );
  });

  it('events.patch PATCHes the same event id with the new body', async () => {
    const ok = fixture('event-patch-ok');
    reply(200, ok);
    const ref = await patchGoogleEvent(
      TOKEN,
      CAL,
      'fixtureevt0001',
      input(true),
    );
    expect(ref).toEqual({
      calendarId: CAL,
      providerEventId: 'fixtureevt0001',
      etag: ok.etag,
    });
    expect(req).toHaveBeenCalledWith(
      'PATCH',
      `${CAL_URL}/events/fixtureevt0001`,
      TOKEN,
      { ...buildGoogleEventBody(input(true)), status: 'confirmed' },
    );
  });
});

describe('findGoogleEventByCopyId (review M1)', () => {
  it('events.list looks a copy up by privateExtendedProperty=rlCopyId=<id> (M1)', async () => {
    const list = fixture('events-list-copy');
    reply(200, list);
    const ref = await findGoogleEventByCopyId(TOKEN, CAL, COPY_ID);
    expect(ref).toEqual({
      calendarId: CAL,
      providerEventId: 'fixtureevt0001',
      etag: (list.items as Json[])[0]?.etag,
    });
    const [method, url, token, body] = req.mock.calls[0] as unknown[];
    expect([method, token, body]).toEqual(['GET', TOKEN, undefined]);
    const parsed = new URL(url as string);
    expect(`${parsed.origin}${parsed.pathname}`).toBe(`${CAL_URL}/events`);
    expect(parsed.searchParams.get('privateExtendedProperty')).toBe(
      `rlCopyId=${COPY_ID}`,
    );
    expect(parsed.searchParams.has('showDeleted')).toBe(false);
  });

  it('events.list with no items → null; a reply without items → TransientError', async () => {
    reply(200, { ...fixture('events-list-copy'), items: [] });
    await expect(
      findGoogleEventByCopyId(TOKEN, CAL, COPY_ID),
    ).resolves.toBeNull();
    reply(200, { kind: 'calendar#events' });
    await expect(
      findGoogleEventByCopyId(TOKEN, CAL, COPY_ID),
    ).rejects.toBeInstanceOf(TransientError);
  });

  it('events.delete DELETEs the encoded event id', async () => {
    reply(204);
    await deleteGoogleEvent(TOKEN, CAL, 'evt/1');
    expect(req).toHaveBeenCalledWith(
      'DELETE',
      `${CAL_URL}/events/evt%2F1`,
      TOKEN,
      undefined,
    );
  });

  it('a 2xx without an id is a TransientError, not a silent success', async () => {
    reply(200, {});
    const err = await caught(insertGoogleEvent(TOKEN, CAL, input(false)));
    expect(err).toBeInstanceOf(TransientError);
    expect((err as TransientError).reason).toBe('malformed_response');
  });
});

describe('status mapping', () => {
  const run = () => insertGoogleEvent(TOKEN, CAL, input(false));

  it.each([
    [401, null, ProviderAuthError, 'http_401'],
    [403, fixture('error-403-scope'), ProviderAuthError, 'scope'],
    [403, { error: { code: 403 } }, ProviderAuthError, 'http_403'],
    [404, fixture('error-404'), NotFoundError, 'http_404'],
    [410, null, NotFoundError, 'http_410'],
    [400, { error: { code: 400 } }, ProviderRequestError, 'http_400'],
    [409, null, ProviderRequestError, 'http_409'],
    [422, null, ProviderRequestError, 'http_422'],
    [500, null, TransientError, 'http_500'],
    [503, null, TransientError, 'http_503'],
  ])(
    'maps %i to the right class and reason',
    async (status, json, Cls, why) => {
      reply(status, json);
      const err = await caught(run());
      expect(err).toBeInstanceOf(Cls);
      expect((err as ProviderAuthError).reason).toBe(why);
    },
  );

  it('maps every write call through the same table (delete 410)', async () => {
    reply(410);
    const err = await caught(deleteGoogleEvent(TOKEN, CAL, 'gone'));
    expect(err).toBeInstanceOf(NotFoundError);
  });

  it('maps a 403 rateLimitExceeded to RateLimitError', async () => {
    const body = fixture('error-429');
    reply(403, { error: { ...(body.error as Json), code: 403 } });
    expect(await caught(run())).toBeInstanceOf(RateLimitError);
  });

  it('maps a network failure and a timeout to TransientError', async () => {
    req.mockRejectedValueOnce(new TypeError('fetch failed'));
    const net = await caught(run());
    expect(net).toBeInstanceOf(TransientError);
    expect((net as TransientError).reason).toBe('network');
    const timeout = new Error('aborted');
    timeout.name = 'TimeoutError';
    req.mockRejectedValueOnce(timeout);
    expect(((await caught(run())) as TransientError).reason).toBe('timeout');
  });

  it('never puts the token or the response body in an error', async () => {
    reply(403, fixture('error-403-scope'));
    const err = (await caught(run())) as Error;
    const text = `${err.message} ${JSON.stringify(err)}`;
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain('insufficient authentication scopes');
    expect(text).not.toContain('Molten Core');
  });
});

describe('Retry-After on a 429', () => {
  const run = () => insertGoogleEvent(TOKEN, CAL, input(false));
  beforeEach(() => jest.spyOn(Date, 'now').mockReturnValue(NOW));

  it('reads delta seconds', async () => {
    reply(429, fixture('error-429'), '30');
    const err = await caught(run());
    expect(err).toBeInstanceOf(RateLimitError);
    expect((err as RateLimitError).retryAfterMs).toBe(30_000);
    expect((err as RateLimitError).reason).toBe('http_429');
  });

  it('reads an HTTP date relative to now', async () => {
    const at = new Date(NOW + 90_000).toUTCString();
    reply(429, fixture('error-429'), at);
    const err = (await caught(run())) as RateLimitError;
    expect(err.retryAfterMs).toBe(90_000);
  });

  it('falls back to 60 s when the header is missing or junk', async () => {
    reply(429, null, null);
    expect(((await caught(run())) as RateLimitError).retryAfterMs).toBe(60_000);
    reply(429, null, 'soon');
    expect(((await caught(run())) as RateLimitError).retryAfterMs).toBe(60_000);
  });
});

describe('googleJsonRequest (the seam, fetch stubbed)', () => {
  it('sends a bearer token + JSON body and parses the reply', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response('{"id":"x"}', {
        status: 200,
        headers: { 'Retry-After': '5' },
      }),
    );
    const res = await googleHttp.googleJsonRequest('PATCH', CAL_URL, TOKEN, {
      a: 1,
    });
    expect(res).toEqual({ status: 200, json: { id: 'x' }, retryAfter: '5' });
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(CAL_URL);
    expect(init.method).toBe('PATCH');
    expect(init.body).toBe('{"a":1}');
    expect(init.headers).toEqual({
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    });
  });

  it('omits body + Content-Type without a body; a 204 reads as null', async () => {
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const res = await googleHttp.googleJsonRequest('DELETE', CAL_URL, TOKEN);
    expect(res).toEqual({ status: 204, json: null, retryAfter: null });
    const init = fetchSpy.mock.calls[0]?.[1] as RequestInit;
    expect(init.body).toBeUndefined();
    expect(init.headers).not.toHaveProperty('Content-Type');
  });
});
