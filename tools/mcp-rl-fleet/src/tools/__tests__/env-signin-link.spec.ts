// rl_env_signin_link — slot URL resolution, admin login, endpoint passthrough,
// and the redaction contract (admin password + admin token never in output).
import { describe, it, expect, vi } from 'vitest';
import { execute, scrub, type SigninLinkDeps } from '../env-signin-link.js';
import type { FixedSeedResult } from '../env-admin-seed.js';

const PASSWORD = 'pw-SECRET-7f3a9c';
const ADMIN_TOKEN = 'eyJADMIN.admin-token-payload.sig';
const LINK = 'https://slot-2.example.test/events/5#token=eyJUSER.magic.sig';

type Reply = { status: number; body: unknown };

function jsonResponse({ status, body }: Reply): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function makeDeps(opts: {
  login?: Reply;
  link?: Reply;
  envs?: Array<{ slug: string | null; slot: string | null }>;
  seed?: FixedSeedResult;
}): { deps: SigninLinkDeps; fetchMock: ReturnType<typeof vi.fn> } {
  const fetchMock = vi.fn(async (url: string) => {
    if (url.endsWith('/api/auth/local')) {
      return jsonResponse(opts.login ?? { status: 200, body: { access_token: ADMIN_TOKEN, user: { id: 1 } } });
    }
    return jsonResponse(opts.link ?? { status: 200, body: { url: LINK, userId: 1, expiresInSeconds: 900 } });
  });
  const deps: SigninLinkDeps = {
    listEnvs: async () => ({ ok: true, envs: opts.envs ?? [{ slug: 'rok-1', slot: '2' }] }),
    seedPassword: async () => opts.seed ?? { ok: true, password: PASSWORD },
    fetch: fetchMock as unknown as typeof fetch,
    publicDomain: 'example.test',
  };
  return { deps, fetchMock };
}

function linkCallBody(fetchMock: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const call = fetchMock.mock.calls.find((c) => String(c[0]).endsWith('/sign-in-link'));
  expect(call, 'expected a POST to /api/admin/test/sign-in-link').toBeDefined();
  return JSON.parse((call![1] as RequestInit).body as string);
}

function expectNoSecrets(result: unknown): void {
  const text = JSON.stringify(result);
  expect(text.includes(PASSWORD), `admin password leaked into result: ${text}`).toBe(false);
  expect(text.includes(ADMIN_TOKEN), `admin token leaked into result: ${text}`).toBe(false);
}

describe('rl_env_signin_link — happy path', () => {
  it('resolves the slot URL, logs in as admin@local and returns the link for the admin by default', async () => {
    const { deps, fetchMock } = makeDeps({});
    const result = await execute({ slug: 'rok-1', path: '/events/5' }, deps);
    expect(result).toEqual({
      ok: true,
      url: LINK,
      user_id: 1,
      expires_in_seconds: 900,
      base_url: 'https://slot-2.example.test',
    });
    const [loginUrl, loginInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(loginUrl).toBe('https://slot-2.example.test/api/auth/local');
    expect(JSON.parse(loginInit.body as string)).toEqual({ email: 'admin@local', password: PASSWORD });
    const linkCall = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(linkCall[0]).toBe('https://slot-2.example.test/api/admin/test/sign-in-link');
    expect((linkCall[1].headers as Record<string, string>).authorization).toBe(`Bearer ${ADMIN_TOKEN}`);
    expect(linkCallBody(fetchMock)).toEqual({ userId: 1, path: '/events/5' });
    expectNoSecrets(result);
  });

  it('never uses the per-slug public_url host', async () => {
    const { deps, fetchMock } = makeDeps({});
    await execute({ slug: 'rok-1' }, deps);
    for (const c of fetchMock.mock.calls) expect(String(c[0])).not.toContain('rok-1test');
  });

  it('fails closed, naming the envs, when another env shares the slot', async () => {
    const { deps, fetchMock } = makeDeps({ envs: [{ slug: 'rok-1', slot: '2' }, { slug: 'other', slot: '2' }] });
    const result = await execute({ slug: 'rok-1' }, deps);
    expect(result).toEqual({
      ok: false,
      error: 'slot_shared',
      message: 'slot 2 hosts 2 envs (rok-1, other); destroy the others so the slot URL routes to "rok-1"',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('treats one env listed as several containers (allinone + pg) as one env', async () => {
    const { deps } = makeDeps({ envs: [{ slug: 'rok-1', slot: '2' }, { slug: 'rok-1', slot: '2' }] });
    expect((await execute({ slug: 'rok-1' }, deps)).ok).toBe(true);
  });

  it('ignores envs on other slots', async () => {
    const { deps } = makeDeps({ envs: [{ slug: 'rok-1', slot: '2' }, { slug: 'other', slot: '1' }] });
    expect((await execute({ slug: 'rok-1' }, deps)).ok).toBe(true);
  });

  it('refuses a link whose origin is not the slot base_url, without returning it', async () => {
    const offOrigin = 'https://evil.example/#token=eyJUSER.magic.sig';
    const { deps } = makeDeps({ link: { status: 200, body: { url: offOrigin, userId: 1, expiresInSeconds: 900 } } });
    const result = await execute({ slug: 'rok-1' }, deps);
    expect(result).toEqual({
      ok: false,
      error: 'signin_link_wrong_origin',
      status: 200,
      message: 'endpoint returned a link off https://slot-2.example.test',
    });
    expect(JSON.stringify(result)).not.toContain('magic.sig');
  });
});

describe('rl_env_signin_link — target selection', () => {
  it('forwards user_id as userId', async () => {
    const { deps, fetchMock } = makeDeps({});
    await execute({ slug: 'rok-1', user_id: 42 }, deps);
    expect(linkCallBody(fetchMock)).toEqual({ userId: 42 });
  });

  it('forwards username instead of an id', async () => {
    const { deps, fetchMock } = makeDeps({});
    await execute({ slug: 'rok-1', username: 'Roknua' }, deps);
    expect(linkCallBody(fetchMock)).toEqual({ username: 'Roknua' });
  });

  it('rejects user_id and username together without any network call', async () => {
    const { deps, fetchMock } = makeDeps({});
    const result = await execute({ slug: 'rok-1', user_id: 2, username: 'x' }, deps);
    expect(result).toMatchObject({ ok: false, error: 'invalid_params' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a protocol-relative path', async () => {
    const { deps } = makeDeps({});
    const result = await execute({ slug: 'rok-1', path: '//evil.test/x' }, deps);
    expect(result).toMatchObject({ ok: false, error: 'invalid_params' });
  });
});

describe('rl_env_signin_link — endpoint error passthrough', () => {
  it.each([
    [404, 'User not found'],
    [400, 'Provide exactly one of userId or username'],
  ])('surfaces HTTP %i with the endpoint message', async (status, message) => {
    const { deps } = makeDeps({ link: { status, body: { statusCode: status, message } } });
    const result = await execute({ slug: 'rok-1', username: 'ghost' }, deps);
    expect(result).toEqual({ ok: false, error: 'signin_link_failed', status, message });
  });

  it('scrubs the admin token if an error message echoes it', async () => {
    const { deps } = makeDeps({ link: { status: 400, body: { message: `bad bearer ${ADMIN_TOKEN}` } } });
    const result = await execute({ slug: 'rok-1' }, deps);
    expect(result.message).toBe('bad bearer ***');
    expectNoSecrets(result);
  });

  it('reports env_not_found for an unknown slug', async () => {
    const { deps, fetchMock } = makeDeps({});
    const result = await execute({ slug: 'nope' }, deps);
    expect(result).toMatchObject({ ok: false, error: 'env_not_found' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('rl_env_signin_link — admin login failure is redacted', () => {
  it('returns status + a short message only, never the response body', async () => {
    const { deps } = makeDeps({
      login: { status: 401, body: { message: `Invalid credentials for ${PASSWORD}`, access_token: ADMIN_TOKEN } },
    });
    const result = await execute({ slug: 'rok-1' }, deps);
    expect(result).toEqual({
      ok: false,
      error: 'admin_login_failed',
      status: 401,
      message: 'admin@local login returned HTTP 401',
    });
    expectNoSecrets(result);
  });

  it('reports admin_seed_failed when the password cannot be re-asserted', async () => {
    const { deps, fetchMock } = makeDeps({ seed: { ok: false, reason: 'seed_failed' } });
    const result = await execute({ slug: 'rok-1' }, deps);
    expect(result).toMatchObject({ ok: false, error: 'admin_seed_failed' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses (no login attempt) when the VM has no stable RL_ADMIN_PASSWORD', async () => {
    const { deps, fetchMock } = makeDeps({ seed: { ok: false, reason: 'no_fixed_password' } });
    const result = await execute({ slug: 'rok-1' }, deps);
    expect(result).toMatchObject({ ok: false, error: 'admin_seed_failed' });
    expect(result.message).toContain('set RL_ADMIN_PASSWORD in /srv/rl-infra/.env');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('scrubs secrets from a thrown network error', async () => {
    const { deps } = makeDeps({});
    deps.fetch = (async () => {
      throw new Error(`connect failed, body had ${PASSWORD}`);
    }) as unknown as typeof fetch;
    const result = await execute({ slug: 'rok-1' }, deps);
    expect(result).toMatchObject({ ok: false, error: 'request_failed' });
    expectNoSecrets(result);
  });
});

describe('scrub', () => {
  it('replaces every secret and caps length', () => {
    expect(scrub('a SECRET b SECRET', ['SECRET'])).toBe('a *** b ***');
    expect(scrub('x'.repeat(500), []).length).toBeLessThanOrEqual(201);
  });
});
