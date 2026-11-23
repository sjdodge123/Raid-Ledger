/**
 * ROK-2129 F2 (operator ruling 2026-11-07) — the OpenID `userinfo` probe:
 * keys-only recorder, `/userinfo` → `/oauth/userinfo` fallback on a 404, and
 * a failure that is recorded instead of thrown. No BattleTag/id/sub value
 * may reach the summary.
 */
import type { BnetFetch } from './bnet-account-probe.oauth';
import {
  probeUserinfo,
  summariseUserinfo,
} from './bnet-account-probe.userinfo';

const BATTLETAG = 'Thrall#1234';
const ID = 987654321;
const SUB = '987654321';

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status });

const ok = { status: 200, error: null } as const;

describe('summariseUserinfo (keys only)', () => {
  it('records key names, field types and id===sub without any value', () => {
    const body = { sub: SUB, id: ID, battletag: BATTLETAG };
    const summary = summariseUserinfo([
      { path: '/userinfo', result: { ...ok, body } },
    ]);
    expect(summary).toEqual({
      attempts: [{ path: '/userinfo', status: 200, error: null }],
      answeredPath: '/userinfo',
      keys: ['battletag', 'id', 'sub'],
      idType: 'number',
      subType: 'string',
      battletagType: 'string',
      idEqualsSub: true,
      errorCode: null,
    });
    const serialised = JSON.stringify(summary);
    for (const value of [BATTLETAG, 'Thrall', '1234', SUB]) {
      expect(serialised).not.toContain(value);
    }
  });

  it('absent fields are typed absent and idEqualsSub is null', () => {
    const summary = summariseUserinfo([
      { path: '/userinfo', result: { ...ok, body: { sub: SUB } } },
    ]);
    expect(summary).toMatchObject({
      idType: 'absent',
      battletagType: 'absent',
      idEqualsSub: null,
    });
  });

  it('a different id and sub compare false', () => {
    const body = { sub: 'abc', id: 1 };
    const summary = summariseUserinfo([
      { path: '/userinfo', result: { ...ok, body } },
    ]);
    expect(summary.idEqualsSub).toBe(false);
  });

  it('a failed answer keeps only the OAuth error code shape', () => {
    const body = { error: 'invalid_token', error_description: BATTLETAG };
    const summary = summariseUserinfo([
      { path: '/userinfo', result: { status: 401, error: null, body } },
    ]);
    expect(summary).toMatchObject({
      answeredPath: null,
      keys: ['error', 'error_description'],
      errorCode: 'invalid_token',
    });
    expect(JSON.stringify(summary)).not.toContain('Thrall');
  });

  it('an error field that is not a code shape is dropped', () => {
    const body = { error: BATTLETAG };
    const summary = summariseUserinfo([
      { path: '/userinfo', result: { status: 400, error: null, body } },
    ]);
    expect(summary.errorCode).toBeNull();
  });
});

describe('probeUserinfo', () => {
  const signal = (): AbortSignal => new AbortController().signal;

  it('calls oauth.battle.net/userinfo with the bearer token', async () => {
    const seen: Array<{ url: string; auth: unknown }> = [];
    const fetchFn: BnetFetch = (url, init) => {
      seen.push({ url, auth: new Headers(init.headers).get('Authorization') });
      return Promise.resolve(json({ sub: SUB }));
    };
    const summary = await probeUserinfo(fetchFn, 'AT', signal());
    expect(seen).toEqual([
      { url: 'https://oauth.battle.net/userinfo', auth: 'Bearer AT' },
    ]);
    expect(summary.answeredPath).toBe('/userinfo');
  });

  it('a 404 on /userinfo falls back to /oauth/userinfo and records both', async () => {
    const fetchFn: BnetFetch = (url) =>
      Promise.resolve(
        url.endsWith('/oauth/userinfo')
          ? json({ sub: SUB, battletag: BATTLETAG })
          : json({}, 404),
      );
    const summary = await probeUserinfo(fetchFn, 'AT', signal());
    expect(summary.attempts).toEqual([
      { path: '/userinfo', status: 404, error: null },
      { path: '/oauth/userinfo', status: 200, error: null },
    ]);
    expect(summary.answeredPath).toBe('/oauth/userinfo');
    expect(summary.keys).toEqual(['battletag', 'sub']);
  });

  it('a transport failure is recorded, never thrown, and not retried', async () => {
    const fetchFn = jest
      .fn<Promise<Response>, Parameters<BnetFetch>>()
      .mockRejectedValue(new TypeError('fetch failed'));
    const summary = await probeUserinfo(fetchFn, 'AT', signal());
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(summary).toMatchObject({
      attempts: [{ path: '/userinfo', status: null, error: 'network' }],
      answeredPath: null,
      keys: [],
    });
  });

  it('a spent budget records a timeout without calling Blizzard', async () => {
    const run = new AbortController();
    run.abort(new DOMException('spent', 'TimeoutError'));
    const fetchFn = jest.fn<Promise<Response>, Parameters<BnetFetch>>();
    const summary = await probeUserinfo(fetchFn, 'AT', run.signal);
    expect(fetchFn).not.toHaveBeenCalled();
    expect(summary.attempts).toEqual([
      { path: '/userinfo', status: null, error: 'timeout' },
    ]);
  });
});
