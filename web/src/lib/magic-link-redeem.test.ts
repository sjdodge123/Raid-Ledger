import { describe, it, expect, beforeEach, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { toast } from 'sonner';

import { server } from '../test/mocks/server';
import { awaitMagicLinkRedeem, startMagicLinkRedeem } from './magic-link-redeem';
import {
  ACCESS_TOKEN_KEY,
  AUTH_METHOD_KEY,
  ORIGINAL_TOKEN_KEY,
  SILENT_GUARD_KEY,
} from './api/auth-storage-keys';

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

function meReturns(status: number): void {
  server.use(
    http.get(`${API_BASE}/auth/me`, () =>
      HttpResponse.json(status === 200 ? { id: 1 } : {}, { status }),
    ),
  );
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
    expect(localStorage.getItem(ACCESS_TOKEN_KEY)).toBe('session.jwt');
    expect(localStorage.getItem(AUTH_METHOD_KEY)).toBe('magic');
    expect(sessionStorage.getItem(SILENT_GUARD_KEY)).toBeNull();
    expect(storedValues()).not.toContain(MAGIC);
  });

  it('on 401 stores nothing and shows no toast', async () => {
    redeemReturns(401, { message: 'Invalid or expired sign-in link' });

    await startMagicLinkRedeem(MAGIC);

    expect(localStorage.getItem(ACCESS_TOKEN_KEY)).toBeNull();
    expect(localStorage.getItem(AUTH_METHOD_KEY)).toBeNull();
    expect(storedValues()).not.toContain(MAGIC);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('on a network error resolves quietly and stores nothing', async () => {
    server.use(http.post(REDEEM, () => HttpResponse.error()));

    await expect(startMagicLinkRedeem(MAGIC)).resolves.toBeUndefined();

    expect(localStorage.getItem(ACCESS_TOKEN_KEY)).toBeNull();
    expect(localStorage.getItem(AUTH_METHOD_KEY)).toBeNull();
  });

  it('ignores a 200 whose body is not a token response', async () => {
    redeemReturns(200, { nope: true });

    await startMagicLinkRedeem(MAGIC);

    expect(localStorage.getItem(ACCESS_TOKEN_KEY)).toBeNull();
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

describe('ROK-1366 OQ6: a stored session decides whether to redeem', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('keeps a stored token that passes /auth/me and never redeems', async () => {
    const impersonated = jwtFor(USER_A);
    localStorage.setItem(ACCESS_TOKEN_KEY, impersonated);
    localStorage.setItem(ORIGINAL_TOKEN_KEY, jwtFor(ADMIN));
    meReturns(200);
    const seen = redeemReturns(200, { access_token: 'session.jwt' });

    await startMagicLinkRedeem(linkFor(ADMIN));

    expect(seen.calls).toBe(0);
    expect(localStorage.getItem(ACCESS_TOKEN_KEY)).toBe(impersonated);
    expect(localStorage.getItem(ORIGINAL_TOKEN_KEY)).toBe(jwtFor(ADMIN));
  });

  it("redeems the same user's link over their own expired token", async () => {
    localStorage.setItem(ACCESS_TOKEN_KEY, jwtFor(USER_A));
    meReturns(401);
    const seen = redeemReturns(200, { access_token: 'session.jwt' });

    await startMagicLinkRedeem(linkFor(USER_A));

    expect(seen.calls).toBe(1);
    expect(localStorage.getItem(ACCESS_TOKEN_KEY)).toBe('session.jwt');
  });
});

/**
 * OQ6 (operator ruling 2026-09-27): a missing, expired (401/403) or
 * unreadable stored token does not block a redeem — whoever the link is for —
 * once the refresh also fails (the default MSW /auth/refresh answers 401).
 */
describe('ROK-1366 OQ6: an expired or unverifiable stored token never blocks a redeem', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it("redeems user B's link over user A's expired token", async () => {
    localStorage.setItem(ACCESS_TOKEN_KEY, jwtFor(USER_A));
    meReturns(401);
    const seen = redeemReturns(200, { access_token: 'session.jwt' });

    await startMagicLinkRedeem(linkFor(USER_B));

    expect(seen.calls, "an expired session of another user must not block the link").toBe(1);
    expect(localStorage.getItem(ACCESS_TOKEN_KEY)).toBe('session.jwt');
    expect(localStorage.getItem(AUTH_METHOD_KEY)).toBe('magic');
  });

  it('redeems over a stored token that /auth/me answers with 403 (counts as expired)', async () => {
    localStorage.setItem(ACCESS_TOKEN_KEY, jwtFor(USER_A));
    meReturns(403);
    const seen = redeemReturns(200, { access_token: 'session.jwt' });

    await startMagicLinkRedeem(linkFor(USER_B));

    expect(seen.calls, 'a 403 from /auth/me means the stored session is gone').toBe(1);
    expect(localStorage.getItem(ACCESS_TOKEN_KEY)).toBe('session.jwt');
  });

  it('redeems over a stored token whose user it cannot read', async () => {
    localStorage.setItem(ACCESS_TOKEN_KEY, 'not-a-jwt');
    meReturns(401);
    const seen = redeemReturns(200, { access_token: 'session.jwt' });

    await startMagicLinkRedeem(linkFor(USER_B));

    expect(seen.calls, 'an unreadable, invalid stored token must not block the link').toBe(1);
    expect(localStorage.getItem(ACCESS_TOKEN_KEY)).toBe('session.jwt');
  });

});

/**
 * OQ6 review fix: a 429, 5xx or network error from /auth/me proves nothing
 * about the stored session, so it must not be swapped. The redeem is skipped
 * and the stored session is left untouched.
 */
describe('ROK-1366 OQ6: a transient /auth/me failure never swaps a stored session', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it.each([429, 500, 502, 503])('keeps the stored session and skips the redeem on a %i from /auth/me', async (status) => {
    const stored = jwtFor(USER_A);
    localStorage.setItem(ACCESS_TOKEN_KEY, stored);
    meReturns(status);
    const seen = redeemReturns(200, { access_token: 'session.jwt' });

    await startMagicLinkRedeem(linkFor(USER_B));

    expect(seen.calls, `a ${status} from /auth/me must not spend the link or swap the session`).toBe(0);
    expect(localStorage.getItem(ACCESS_TOKEN_KEY)).toBe(stored);
    expect(localStorage.getItem(AUTH_METHOD_KEY)).toBeNull();
  });

  it('keeps the stored session and skips the redeem when /auth/me is unreachable', async () => {
    const stored = jwtFor(USER_A);
    localStorage.setItem(ACCESS_TOKEN_KEY, stored);
    server.use(http.get(`${API_BASE}/auth/me`, () => HttpResponse.error()));
    const seen = redeemReturns(200, { access_token: 'session.jwt' });

    await startMagicLinkRedeem(linkFor(USER_B));

    expect(seen.calls, 'a network error must not spend the link or swap the session').toBe(0);
    expect(localStorage.getItem(ACCESS_TOKEN_KEY)).toBe(stored);
  });
});

/**
 * #1384 (operator ruling 2026-09-28): a refreshable session is a VALID one.
 * The 1h access token expiring must not let a planted link swap a live
 * refresh-cookie session (login CSRF): refresh first, redeem only when the
 * refresh really fails, and treat a thrown refresh as 'unknown'.
 */
describe('ROK-1366 #1384: a refreshable session blocks a planted link', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('keeps the session and never redeems when the expired token refreshes', async () => {
    localStorage.setItem(ACCESS_TOKEN_KEY, jwtFor(USER_A));
    meReturns(401);
    const refresh = refreshReturns(200);
    const seen = redeemReturns(200, { access_token: 'session.jwt' });

    await startMagicLinkRedeem(linkFor(USER_B));

    expect(refresh.calls, 'an expired access token must be refreshed before redeeming').toBe(1);
    expect(seen.calls, "a refreshable session must not be swapped for the link's user").toBe(0);
    expect(localStorage.getItem(ACCESS_TOKEN_KEY)).toBe(REFRESHED);
    expect(localStorage.getItem(AUTH_METHOD_KEY)).toBeNull();
  });

  it('redeems when the expired token cannot be refreshed', async () => {
    localStorage.setItem(ACCESS_TOKEN_KEY, jwtFor(USER_A));
    meReturns(401);
    const refresh = refreshReturns(401);
    const seen = redeemReturns(200, { access_token: 'session.jwt' });

    await startMagicLinkRedeem(linkFor(USER_B));

    expect(refresh.calls).toBe(1);
    expect(seen.calls, 'a failed refresh means there is no session to keep').toBe(1);
    expect(localStorage.getItem(ACCESS_TOKEN_KEY)).toBe('session.jwt');
  });

  it('refreshes first when no token is stored but a prior sign-in is recorded', async () => {
    localStorage.setItem(AUTH_METHOD_KEY, 'discord');
    const refresh = refreshReturns(200);
    const seen = redeemReturns(200, { access_token: 'session.jwt' });

    await startMagicLinkRedeem(linkFor(USER_B));

    expect(refresh.calls, 'a refresh-cookie session must be probed before redeeming').toBe(1);
    expect(seen.calls, 'a live refresh-cookie session must not be swapped').toBe(0);
    expect(localStorage.getItem(ACCESS_TOKEN_KEY)).toBe(REFRESHED);
    expect(localStorage.getItem(AUTH_METHOD_KEY)).toBe('discord');
  });

  it('redeems when the refresh rejects with a 403', async () => {
    localStorage.setItem(ACCESS_TOKEN_KEY, jwtFor(USER_A));
    meReturns(401);
    refreshReturns(403);
    const seen = redeemReturns(200, { access_token: 'session.jwt' });

    await startMagicLinkRedeem(linkFor(USER_B));

    expect(seen.calls, 'a 403 from /auth/refresh means there is no session to keep').toBe(1);
  });
});

/**
 * #1384 review fix: only a 401/403 from /auth/refresh proves the session is
 * gone. A 429 (an attacker on the victim's NAT can drain the shared refresh
 * bucket), a 5xx, a network error or an unparseable 200 is indeterminate —
 * the stored session is kept and the link is left unspent.
 */
describe('ROK-1366 #1384: an indeterminate refresh never swaps a stored session', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  function expectKept(seen: Seen, stored: string, why: string): void {
    expect(seen.calls, why).toBe(0);
    expect(localStorage.getItem(ACCESS_TOKEN_KEY)).toBe(stored);
    expect(localStorage.getItem(AUTH_METHOD_KEY)).toBeNull();
  }

  it.each([429, 500, 502, 503])('keeps the session and skips the redeem on a %i from /auth/refresh', async (status) => {
    const stored = jwtFor(USER_A);
    localStorage.setItem(ACCESS_TOKEN_KEY, stored);
    meReturns(401);
    const refresh = refreshReturns(status);
    const seen = redeemReturns(200, { access_token: 'session.jwt' });

    await startMagicLinkRedeem(linkFor(USER_B));

    expect(refresh.calls).toBe(1);
    expectKept(seen, stored, `a ${status} from /auth/refresh must not spend the link or swap the session`);
  });

  it('keeps the session and skips the redeem when /auth/refresh is unreachable', async () => {
    const stored = jwtFor(USER_A);
    localStorage.setItem(ACCESS_TOKEN_KEY, stored);
    meReturns(401);
    server.use(http.post(`${API_BASE}/auth/refresh`, () => HttpResponse.error()));
    const seen = redeemReturns(200, { access_token: 'session.jwt' });

    await expect(startMagicLinkRedeem(linkFor(USER_B))).resolves.toBeUndefined();

    expectKept(seen, stored, 'a network error on refresh must not spend the link or swap the session');
  });

  it('keeps the session and skips the redeem when /auth/refresh answers 200 with a malformed body', async () => {
    const stored = jwtFor(USER_A);
    localStorage.setItem(ACCESS_TOKEN_KEY, stored);
    meReturns(401);
    server.use(http.post(`${API_BASE}/auth/refresh`, () => HttpResponse.json({ nope: true })));
    const seen = redeemReturns(200, { access_token: 'session.jwt' });

    await startMagicLinkRedeem(linkFor(USER_B));

    expectKept(seen, stored, 'an unparseable refresh 200 must not spend the link or swap the session');
  });
});

/**
 * #1384 review fix (supersedes the 2026-09-27 OQ6 impersonation cases): while
 * impersonating, the refresh cookie is the admin's and is still live, but the
 * client may not probe it (it would swap the bearer back to the admin). An
 * unprobed refresh is 'unknown', so an expired impersonation blocks every
 * link — the admin's, the impersonated user's, or an attacker's.
 */
describe('ROK-1366 #1384: an expired impersonation never lets a link swap the admin session', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it.each([
    ['the admin', ADMIN],
    ['the impersonated user', USER_A],
    ['another user (planted link)', USER_B],
  ])("keeps the impersonation and never redeems %s's link", async (_who, sub) => {
    const impersonated = jwtFor(USER_A);
    localStorage.setItem(ACCESS_TOKEN_KEY, impersonated);
    localStorage.setItem(ORIGINAL_TOKEN_KEY, jwtFor(ADMIN));
    meReturns(401);
    const refresh = refreshReturns(200);
    const seen = redeemReturns(200, { access_token: 'session.jwt' });

    await startMagicLinkRedeem(linkFor(sub));

    expect(refresh.calls, "the admin's refresh cookie must not be probed while impersonating").toBe(0);
    expect(seen.calls, "an expired impersonation must not let a link replace the admin's live session").toBe(0);
    expect(localStorage.getItem(ACCESS_TOKEN_KEY)).toBe(impersonated);
    expect(localStorage.getItem(ORIGINAL_TOKEN_KEY)).toBe(jwtFor(ADMIN));
  });
});

describe('ROK-1366: awaitMagicLinkRedeem', () => {
  it('resolves at once when no redeem was started', async () => {
    await expect(awaitMagicLinkRedeem()).resolves.toBeUndefined();
  });
});
