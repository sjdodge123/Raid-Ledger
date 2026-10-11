import { describe, it, expect, beforeEach, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { toast } from 'sonner';

import { server } from '../test/mocks/server';
import { awaitMagicLinkRedeem, startMagicLinkRedeem } from './magic-link-redeem';
import {
  AUTH_METHOD_KEY,
  LEGACY_ACCESS_TOKEN_KEY,
  SILENT_GUARD_KEY,
} from './api/auth-storage-keys';
import { getAccessToken, isImpersonatingToken } from './api/access-token-store';

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

const API_BASE = 'http://localhost:3000';
const REDEEM = `${API_BASE}/auth/redeem-magic-link`;
const MAGIC = 'magic.jwt.raw';

interface Seen {
  calls: number;
  contentType: string | null;
  body: unknown;
}

function redeemReturns(status: number, body: Record<string, unknown>): Seen {
  const seen: Seen = { calls: 0, contentType: null, body: null };
  server.use(
    http.post(REDEEM, async ({ request }) => {
      seen.calls += 1;
      seen.contentType = request.headers.get('content-type');
      seen.body = await request.json();
      return HttpResponse.json(body, { status });
    }),
  );
  return seen;
}

const REFRESHED = 'refreshed.jwt';

function refreshReturns(status: number): { calls: number } {
  const seen = { calls: 0 };
  server.use(
    http.post(`${API_BASE}/auth/refresh`, () => {
      seen.calls += 1;
      return status === 200
        ? HttpResponse.json({ access_token: REFRESHED })
        : HttpResponse.text('Unauthorized', { status });
    }),
  );
  return seen;
}

function storedValues(): string[] {
  return Object.keys(localStorage).map((k) => localStorage.getItem(k) ?? '');
}

describe('ROK-1366: startMagicLinkRedeem with no stored session', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.clearAllMocks();
  });

  it('on 200 stores the minted access token and records auth method magic', async () => {
    sessionStorage.setItem(SILENT_GUARD_KEY, String(Date.now()));
    const seen = redeemReturns(200, { access_token: 'session.jwt' });

    await startMagicLinkRedeem(MAGIC);

    expect(seen.calls).toBe(1);
    expect(seen.contentType).toBe('application/json');
    expect(seen.body).toEqual({ token: MAGIC });
    expect(getAccessToken()).toBe('session.jwt');
    expect(localStorage.getItem(AUTH_METHOD_KEY)).toBe('magic');
    expect(sessionStorage.getItem(SILENT_GUARD_KEY)).toBeNull();
    expect(storedValues()).not.toContain(MAGIC);
  });

  it('on 401 stores nothing and shows no toast', async () => {
    redeemReturns(401, { message: 'Invalid or expired sign-in link' });

    await startMagicLinkRedeem(MAGIC);

    expect(getAccessToken()).toBeNull();
    expect(localStorage.getItem(AUTH_METHOD_KEY)).toBeNull();
    expect(storedValues()).not.toContain(MAGIC);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('on a network error resolves quietly and stores nothing', async () => {
    server.use(http.post(REDEEM, () => HttpResponse.error()));

    await expect(startMagicLinkRedeem(MAGIC)).resolves.toBeUndefined();

    expect(getAccessToken()).toBeNull();
    expect(localStorage.getItem(AUTH_METHOD_KEY)).toBeNull();
  });

  it('ignores a 200 whose body is not a token response', async () => {
    redeemReturns(200, { nope: true });

    await startMagicLinkRedeem(MAGIC);

    expect(getAccessToken()).toBeNull();
  });
});

/** A JWT-shaped fixture: only the (unverified) payload segment is read. */
function jwtFor(sub: number, extra: Record<string, unknown> = {}): string {
  const json = JSON.stringify({ sub, exp: 1, ...extra });
  const payload = btoa(json).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `hdr.${payload}.sig`;
}

const linkFor = (sub: number): string => jwtFor(sub, { magicLink: true });
const USER_A = 1;
const USER_B = 2;
const ADMIN = 9;

/**
 * ROK-1754: memory is empty at boot by construction, so the redeem no longer
 * probes a stored access token with /auth/me — the refresh cookie IS the
 * session. With no prior sign-in recorded there is nothing to protect.
 */
describe('ROK-1754: no prior sign-in → redeem without probing', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('redeems at once: no /auth/me probe and no refresh probe', async () => {
    let meCalls = 0;
    server.use(http.get(`${API_BASE}/auth/me`, () => { meCalls += 1; return HttpResponse.json({ id: 1 }); }));
    const refresh = refreshReturns(200);
    const seen = redeemReturns(200, { access_token: 'session.jwt' });

    await startMagicLinkRedeem(linkFor(USER_B));

    expect(meCalls, 'the stored-token /auth/me probe is gone').toBe(0);
    expect(refresh.calls, 'an anonymous visitor makes no refresh probe').toBe(0);
    expect(seen.calls).toBe(1);
    expect(getAccessToken()).toBe('session.jwt');
  });

  it('a legacy stored token purged at load still counts as a prior sign-in (probe first)', async () => {
    localStorage.setItem(LEGACY_ACCESS_TOKEN_KEY, jwtFor(USER_A));
    vi.resetModules();
    const fresh = await import('./magic-link-redeem');
    const store = await import('./api/access-token-store');
    const refresh = refreshReturns(200);
    const seen = redeemReturns(200, { access_token: 'session.jwt' });

    await fresh.startMagicLinkRedeem(linkFor(USER_B));

    expect(localStorage.getItem(LEGACY_ACCESS_TOKEN_KEY)).toBeNull();
    expect(refresh.calls).toBe(1);
    expect(seen.calls, 'a refreshable upgraded session must not be swapped').toBe(0);
    expect(store.getAccessToken()).toBe(REFRESHED);
  });
});

/**
 * #1384 (operator ruling 2026-09-28): a refreshable session is a VALID one.
 * A planted link must not swap a live refresh-cookie session (login CSRF):
 * refresh first, redeem only when the refresh really fails (401/403).
 */
describe('ROK-1366 #1384: a refreshable session blocks a planted link', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem(AUTH_METHOD_KEY, 'discord');
  });

  it('keeps the session and never redeems when the refresh cookie is live', async () => {
    const refresh = refreshReturns(200);
    const seen = redeemReturns(200, { access_token: 'session.jwt' });

    await startMagicLinkRedeem(linkFor(USER_B));

    expect(refresh.calls, 'a refresh-cookie session must be probed before redeeming').toBe(1);
    expect(seen.calls, "a refreshable session must not be swapped for the link's user").toBe(0);
    expect(getAccessToken()).toBe(REFRESHED);
    expect(localStorage.getItem(AUTH_METHOD_KEY)).toBe('discord');
  });

  it.each([401, 403])('redeems when the refresh rejects with a %i', async (status) => {
    const refresh = refreshReturns(status);
    const seen = redeemReturns(200, { access_token: 'session.jwt' });

    await startMagicLinkRedeem(linkFor(USER_B));

    expect(refresh.calls).toBe(1);
    expect(seen.calls, `a ${status} from /auth/refresh means there is no session to keep`).toBe(1);
    expect(getAccessToken()).toBe('session.jwt');
    expect(localStorage.getItem(AUTH_METHOD_KEY)).toBe('magic');
  });
});

/**
 * #1384 review fix: only a 401/403 from /auth/refresh proves the session is
 * gone. A 429 (an attacker on the victim's NAT can drain the shared refresh
 * bucket), a 5xx, a network error or an unparseable 200 is indeterminate —
 * the session is kept and the link is left unspent.
 */
describe('ROK-1366 #1384: an indeterminate refresh never swaps a session', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem(AUTH_METHOD_KEY, 'local');
  });

  function expectKept(seen: Seen, why: string): void {
    expect(seen.calls, why).toBe(0);
    expect(getAccessToken()).toBeNull();
    expect(localStorage.getItem(AUTH_METHOD_KEY)).toBe('local');
  }

  it.each([429, 500, 502, 503])('keeps the session and skips the redeem on a %i from /auth/refresh', async (status) => {
    const refresh = refreshReturns(status);
    const seen = redeemReturns(200, { access_token: 'session.jwt' });

    await startMagicLinkRedeem(linkFor(USER_B));

    expect(refresh.calls).toBe(1);
    expectKept(seen, `a ${status} from /auth/refresh must not spend the link or swap the session`);
  });

  it('keeps the session and skips the redeem when /auth/refresh is unreachable', async () => {
    server.use(http.post(`${API_BASE}/auth/refresh`, () => HttpResponse.error()));
    const seen = redeemReturns(200, { access_token: 'session.jwt' });

    await expect(startMagicLinkRedeem(linkFor(USER_B))).resolves.toBeUndefined();

    expectKept(seen, 'a network error on refresh must not spend the link or swap the session');
  });

  it('keeps the session and skips the redeem when /auth/refresh answers 200 with a malformed body', async () => {
    server.use(http.post(`${API_BASE}/auth/refresh`, () => HttpResponse.json({ nope: true })));
    const seen = redeemReturns(200, { access_token: 'session.jwt' });

    await startMagicLinkRedeem(linkFor(USER_B));

    expectKept(seen, 'an unparseable refresh 200 must not spend the link or swap the session');
  });
});

/**
 * ROK-1754 D1 (supersedes the #1384 "never probe while impersonating" cases):
 * impersonation lives server-side on the refresh family, so the probe renews
 * it. A live impersonation blocks every link — the admin's, the impersonated
 * user's, or a planted one — and its claim survives.
 */
describe('ROK-1754: a live impersonation never lets a link swap the session', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem(AUTH_METHOD_KEY, 'local');
  });

  it.each([
    ['the admin', ADMIN],
    ['the impersonated user', USER_A],
    ['another user (planted link)', USER_B],
  ])("keeps the impersonation and never redeems %s's link", async (_who, sub) => {
    const renewed = jwtFor(USER_A, { impersonatedBy: ADMIN, exp: 4102444800 });
    server.use(http.post(`${API_BASE}/auth/refresh`, () => HttpResponse.json({ access_token: renewed })));
    const seen = redeemReturns(200, { access_token: 'session.jwt' });

    await startMagicLinkRedeem(linkFor(sub));

    expect(seen.calls, 'a live impersonation must not be replaced by a link').toBe(0);
    expect(getAccessToken()).toBe(renewed);
    expect(isImpersonatingToken()).toBe(true);
  });
});

describe('ROK-1366: awaitMagicLinkRedeem', () => {
  it('resolves at once when no redeem was started', async () => {
    await expect(awaitMagicLinkRedeem()).resolves.toBeUndefined();
  });
});
