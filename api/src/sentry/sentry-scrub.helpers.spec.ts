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

  it('returns the same event object and survives cycles', () => {
    const extra: Record<string, unknown> = { token: SECRET };
    extra.self = extra;
    const event = { extra };
    expect(scrubSecrets(event)).toBe(event);
    expect(extra.token).toBe(REDACTED);
  });

  it('scrubString leaves "error code=50007" prose alone', () => {
    expect(scrubString('Discord error code=50007')).toBe(
      'Discord error code=50007',
    );
  });
});

describe('instrument.ts wiring', () => {
  it('beforeSend runs the scrub', async () => {
    const saved = {
      NODE_ENV: process.env.NODE_ENV,
      DISABLE_TELEMETRY: process.env.DISABLE_TELEMETRY,
    };
    process.env.NODE_ENV = 'production';
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
    const options = sentry.init.mock.calls[0]?.[0] as {
      beforeSend: (e: object) => object;
    };
    const out = options.beforeSend({
      request: { headers: { authorization: `Bearer ${SECRET}` } },
    });
    expect(JSON.stringify(out)).not.toContain(SECRET);
  });
});
