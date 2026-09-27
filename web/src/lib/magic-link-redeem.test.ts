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

function redeemReturns(status: number, body: unknown): Seen {
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

describe('ROK-1366 OQ6: a stored session decides whether to redeem', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('keeps a stored token that passes /auth/me and never redeems', async () => {
    localStorage.setItem(ACCESS_TOKEN_KEY, 'still-valid');
    localStorage.setItem(ORIGINAL_TOKEN_KEY, 'admin-original');
    meReturns(200);
    const seen = redeemReturns(200, { access_token: 'session.jwt' });

    await startMagicLinkRedeem(MAGIC);

    expect(seen.calls).toBe(0);
    expect(localStorage.getItem(ACCESS_TOKEN_KEY)).toBe('still-valid');
    expect(localStorage.getItem(ORIGINAL_TOKEN_KEY)).toBe('admin-original');
  });

  it('redeems over a stored token that /auth/me rejects, ending any impersonation', async () => {
    localStorage.setItem(ACCESS_TOKEN_KEY, 'expired');
    localStorage.setItem(ORIGINAL_TOKEN_KEY, 'admin-original');
    meReturns(401);
    const seen = redeemReturns(200, { access_token: 'session.jwt' });

    await startMagicLinkRedeem(MAGIC);

    expect(seen.calls).toBe(1);
    expect(localStorage.getItem(ACCESS_TOKEN_KEY)).toBe('session.jwt');
    expect(localStorage.getItem(ORIGINAL_TOKEN_KEY)).toBeNull();
  });
});

describe('ROK-1366: awaitMagicLinkRedeem', () => {
  it('resolves at once when no redeem was started', async () => {
    await expect(awaitMagicLinkRedeem()).resolves.toBeUndefined();
  });
});
