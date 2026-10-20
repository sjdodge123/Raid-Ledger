import { REDACTED, scrubSecrets, scrubString } from './sentry-scrub.helpers';

const SECRET = 'S3CR3T-VALUE';

describe('scrubSecrets', () => {
  it.each([
    'authorization',
    'Authorization',
    'cookie',
    'access_token',
    'refresh_token',
    'id_token',
    'client_secret',
    'code_verifier',
    'password',
    'credentialsEncrypted',
    'code',
    'state',
  ])('redacts request.data.%s', (key) => {
    const event = { request: { data: { [key]: SECRET, keep: 'ok' } } };
    scrubSecrets(event);
    expect(event.request.data).toEqual({ [key]: REDACTED, keep: 'ok' });
  });

  it('redacts nested keys in extra, contexts and breadcrumbs', () => {
    const event = {
      extra: { job: { deep: { refreshToken: SECRET } } },
      contexts: { oauth: { client_secret: SECRET } },
      breadcrumbs: [{ data: { accessToken: SECRET } }],
    };
    scrubSecrets(event);
    expect(JSON.stringify(event)).not.toContain(SECRET);
    expect(event.extra.job.deep.refreshToken).toBe(REDACTED);
  });

  it('strips secret query params from URLs, query strings, messages and exception values', () => {
    const event = {
      request: {
        url: `https://rl.test/api/calendar-sync/oauth/google/callback?code=${SECRET}&state=${SECRET}&scope=openid`,
        query_string: `code=${SECRET}&state=${SECRET}`,
      },
      breadcrumbs: [
        {
          message: `GET /cb?code=${SECRET}`,
          data: { url: `/cb?access_token=${SECRET}` },
        },
      ],
      message: `callback failed for ?state=${SECRET}`,
      exception: {
        values: [
          { value: `token endpoint said {"refresh_token":"${SECRET}"}` },
        ],
      },
    };
    scrubSecrets(event);
    expect(JSON.stringify(event)).not.toContain(SECRET);
    expect(event.request.url).toContain('scope=openid');
  });

  it('redacts [name, value] query pairs', () => {
    const event = {
      request: {
        query_string: [
          ['code', SECRET],
          ['scope', 'openid'],
        ],
      },
    };
    scrubSecrets(event);
    expect(event.request.query_string).toEqual([
      ['code', REDACTED],
      ['scope', 'openid'],
    ]);
  });

  it('keeps triage codes outside the request (Discord / Postgres `code`)', () => {
    const event = {
      extra: { code: 50007 },
      contexts: { response: { status_code: 500 } },
    };
    scrubSecrets(event);
    expect(event).toEqual({
      extra: { code: 50007 },
      contexts: { response: { status_code: 500 } },
    });
  });

  it('ROK-1592: transaction spans lose code + state in description, data and attributes', () => {
    const url =
      '/api/calendar-sync/oauth/google/callback?code=4/SPAN-CODE&state=SPAN-STATE';
    const event = {
      transaction: `GET ${url}`,
      spans: [
        {
          description: `GET ${url}`,
          data: {
            'http.url': url,
            'http.query': 'code=4/SPAN-CODE&state=SPAN-STATE',
            state: 'SPAN-STATE',
          },
          attributes: { 'url.full': `https://rl.test${url}` },
        },
      ],
    };
    const json = JSON.stringify(scrubSecrets(event));
    expect(json).not.toMatch(/SPAN-CODE|SPAN-STATE/);
    expect(json).toContain(`callback?code=${REDACTED}&state=${REDACTED}`);
  });

  it('returns the same event object and survives cycles without mutating them', () => {
    const extra: Record<string, unknown> = { token: SECRET };
    extra.self = extra;
    const event: { extra: unknown } = { extra };
    expect(scrubSecrets(event)).toBe(event);
    expect(extra.token).toBe(SECRET);
    expect(event.extra).toEqual({ token: REDACTED, self: '[circular]' });
  });

  it('ROK-1779: scrubs frozen caller-owned objects into copies without throwing', () => {
    const headers = Object.freeze({ authorization: `Bearer ${SECRET}` });
    const owned = Object.freeze({
      job: Object.freeze({ refreshToken: SECRET, note: 'keep' }),
      pairs: Object.freeze([Object.freeze(['access_token', SECRET])]),
    });
    const event: { request: unknown; extra: unknown } = {
      request: { headers, query_string: owned.pairs },
      extra: { owned },
    };
    expect(() => scrubSecrets(event)).not.toThrow();
    expect(JSON.stringify(event)).not.toContain(SECRET);
    expect(event.extra).toEqual({
      owned: {
        job: { refreshToken: REDACTED, note: 'keep' },
        pairs: [['access_token', REDACTED]],
      },
    });
    expect(headers.authorization).toBe(`Bearer ${SECRET}`);
    expect(owned.job.refreshToken).toBe(SECRET);
    expect(owned.pairs[0]?.[1]).toBe(SECRET);
  });

  it('ROK-1779: never ships a value deeper than the depth bound unscrubbed', () => {
    let deep: Record<string, unknown> = { note: `?access_token=${SECRET}` };
    for (let i = 0; i < 30; i += 1) deep = { next: deep };
    const event: { extra: unknown } = { extra: deep };
    scrubSecrets(event);
    expect(JSON.stringify(event.extra)).not.toContain(SECRET);
    expect(JSON.stringify(event.extra)).toContain('[truncated]');
  });

  it('ROK-1779: an Error in extra is copied with its message scrubbed', () => {
    const err = new Error(`boom ?access_token=${SECRET}`);
    const event: { extra: unknown } = { extra: { err } };
    scrubSecrets(event);
    expect(JSON.stringify(event.extra)).not.toContain(SECRET);
    expect(JSON.stringify(event.extra)).toContain(
      `boom ?access_token=${REDACTED}`,
    );
    expect(err.message).toContain(SECRET);
  });

  it('ROK-1599: redacts the ICS subscribe-link token in the path', () => {
    const token = 'A'.repeat(21) + '_-' + 'b'.repeat(20);
    expect(scrubString(`GET /api/cal/u/${token}.ics`)).toBe(
      `GET /api/cal/u/${REDACTED}.ics`,
    );
  });

  it('scrubString leaves "error code=50007" prose alone', () => {
    expect(scrubString('Discord error code=50007')).toBe(
      'Discord error code=50007',
    );
  });

  it('ROK-1593: redacts a Google calendar id in a Calendar v3 path, keeps primary', () => {
    const base = 'https://www.googleapis.com/calendar/v3/calendars';
    const raw = `GET ${base}/fixture-owner%40example.test/events?timeMin=x`;
    const plain = `${base}/team-fixture@group.calendar.google.com/events/e1`;
    expect(scrubString(raw)).toBe(`GET ${base}/${REDACTED}/events?timeMin=x`);
    expect(scrubString(plain)).toBe(`${base}/${REDACTED}/events/e1`);
    expect(scrubString(`${base}/primary/events`)).toBe(
      `${base}/primary/events`,
    );
    expect(scrubString(`${base}/primaryfixture@example.test`)).toBe(
      `${base}/${REDACTED}`,
    );
  });

  it('ROK-1598: redacts the iCloud DSID in a CalDAV path, keeps the calendar id', () => {
    const p07 = 'https://p07-caldav.icloud.com/1234567/calendars/home/';
    const port = 'PROPFIND https://caldav.icloud.com:443/987654321/principal/';
    expect(scrubString(p07)).toBe(
      `https://p07-caldav.icloud.com/${REDACTED}/calendars/home/`,
    );
    expect(scrubString(port)).toBe(
      `PROPFIND https://caldav.icloud.com:443/${REDACTED}/principal/`,
    );
    const event = scrubSecrets({
      request: { data: { appPassword: 'abcd-efgh-ijkl-mnop' } },
      breadcrumbs: [{ data: { url: p07, Authorization: 'Basic cmFpZGVy' } }],
    });
    const text = JSON.stringify(event);
    expect(text).not.toContain('1234567');
    expect(text).not.toContain('abcd-efgh-ijkl-mnop');
    expect(text).not.toContain('cmFpZGVy');
    expect(text).toContain('/calendars/home/');
  });

  it('ROK-1593: a span description carrying a calendar id is scrubbed', () => {
    const event = scrubSecrets({
      spans: [
        {
          description:
            'GET https://www.googleapis.com/calendar/v3/calendars/boss-fixture@example.test/events',
        },
      ],
    });
    expect(JSON.stringify(event)).not.toContain('boss-fixture');
  });
});

describe('instrument.ts wiring', () => {
  it('beforeSend runs the scrub', async () => {
    const saved = {
      NODE_ENV: process.env.NODE_ENV,
      DISABLE_TELEMETRY: process.env.DISABLE_TELEMETRY,
      ENABLE_TELEMETRY: process.env.ENABLE_TELEMETRY,
    };
    process.env.NODE_ENV = 'production';
    process.env.ENABLE_TELEMETRY = 'true';
    delete process.env.DISABLE_TELEMETRY;
    jest.resetModules();
    jest.doMock('@sentry/nestjs', () => ({ init: jest.fn() }));
    await import('./instrument.js');
    const sentry = (await import('@sentry/nestjs')) as unknown as {
      init: jest.Mock;
    };
    process.env.NODE_ENV = saved.NODE_ENV;
    if (saved.DISABLE_TELEMETRY !== undefined)
      process.env.DISABLE_TELEMETRY = saved.DISABLE_TELEMETRY;
    if (saved.ENABLE_TELEMETRY === undefined)
      delete process.env.ENABLE_TELEMETRY;
    else process.env.ENABLE_TELEMETRY = saved.ENABLE_TELEMETRY;
    const options = sentry.init.mock.calls[0]?.[0] as {
      beforeSend: (e: object) => object;
    };
    const out = options.beforeSend({
      request: { headers: { authorization: `Bearer ${SECRET}` } },
    });
    expect(JSON.stringify(out)).not.toContain(SECRET);
  });

  it('ROK-1833: no Valheim Link token survives a header, free text or an issue body', () => {
    const token = `rlvl_${'Ab3_-'.repeat(8)}xyz`;
    const event = scrubSecrets({
      request: {
        url: '/api/plugins/valheim/link/v1/messages/character',
        headers: { Authorization: `Bearer ${token}`, 'X-Debug': token },
        data: JSON.stringify({ token, serverId: '7' }),
      },
      message: `pasted ${token} into a note`,
      extra: { body: { issued: { token } } },
      exception: { values: [{ value: `boom ${token}` }] },
    });
    expect(JSON.stringify(event)).not.toContain('rlvl_');
    expect(scrubString(`a ${token} b`)).toBe(`a ${REDACTED} b`);
  });
});
