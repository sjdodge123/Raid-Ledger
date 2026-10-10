import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
    DEACTIVATED_LOGIN_PATH,
    endDeactivatedSession,
    isDeactivatedResponse,
    readErrorCode,
} from './deactivated-session';
import {
    ACCESS_TOKEN_KEY,
    AUTH_METHOD_KEY,
    ORIGINAL_TOKEN_KEY,
    USER_CACHE_KEY,
} from './auth-storage-keys';
import { toast } from '../toast';

vi.mock('../toast', () => ({ toast: { error: vi.fn() } }));

/**
 * ROK-1753: the API answers a deactivated user's requests AND refresh with
 * 401 `{ code: 'USER_DEACTIVATED' }`. The web treats that as terminal.
 */

function jsonResponse(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

describe('readErrorCode', () => {
    it('returns the body code without consuming the original body', async () => {
        const res = jsonResponse(401, { code: 'USER_DEACTIVATED', message: 'Account deactivated' });

        expect(await readErrorCode(res)).toBe('USER_DEACTIVATED');
        expect(await res.json()).toEqual({ code: 'USER_DEACTIVATED', message: 'Account deactivated' });
    });

    it('returns null for a non-JSON body or a body without a string code', async () => {
        expect(await readErrorCode(new Response('nope', { status: 401 }))).toBeNull();
        expect(await readErrorCode(jsonResponse(401, { code: 7 }))).toBeNull();
        expect(await readErrorCode(jsonResponse(401, null))).toBeNull();
    });
});

describe('isDeactivatedResponse', () => {
    it('is true for a 401 or 403 carrying USER_DEACTIVATED', async () => {
        expect(await isDeactivatedResponse(jsonResponse(401, { code: 'USER_DEACTIVATED' }))).toBe(true);
        expect(await isDeactivatedResponse(jsonResponse(403, { code: 'USER_DEACTIVATED' }))).toBe(true);
    });

    it('is false for a plain expired-token 401 and for other statuses', async () => {
        expect(await isDeactivatedResponse(jsonResponse(401, { message: 'Unauthorized' }))).toBe(false);
        expect(await isDeactivatedResponse(jsonResponse(401, { code: 'USER_SUSPENDED' }))).toBe(false);
        expect(await isDeactivatedResponse(jsonResponse(200, { code: 'USER_DEACTIVATED' }))).toBe(false);
    });
});

describe('endDeactivatedSession', () => {
    beforeEach(() => {
        localStorage.clear();
        localStorage.setItem(ACCESS_TOKEN_KEY, 'tok');
        localStorage.setItem(ORIGINAL_TOKEN_KEY, 'admin-tok');
        localStorage.setItem(USER_CACHE_KEY, '{"id":1}');
        localStorage.setItem(AUTH_METHOD_KEY, 'discord');
    });

    it('clears the shared session (incl. the auth-method marker) and redirects to the login notice', () => {
        const redirect = vi.fn();

        endDeactivatedSession(redirect);

        expect(localStorage.getItem(ACCESS_TOKEN_KEY)).toBeNull();
        expect(localStorage.getItem(ORIGINAL_TOKEN_KEY)).toBeNull();
        expect(localStorage.getItem(USER_CACHE_KEY)).toBeNull();
        // The marker gates every refresh probe and the silent Discord re-auth.
        expect(localStorage.getItem(AUTH_METHOD_KEY)).toBeNull();
        expect(redirect).toHaveBeenCalledWith(DEACTIVATED_LOGIN_PATH);
        expect(DEACTIVATED_LOGIN_PATH).toBe('/login?error=deactivated');
    });

    describe('already on /login (password sign-in hits USER_DEACTIVATED)', () => {
        beforeEach(() => vi.mocked(toast.error).mockClear());
        afterEach(() => window.history.replaceState({}, '', '/'));

        it('toasts the deactivated notice in place and does NOT redirect', () => {
            window.history.replaceState({}, '', '/login');
            const redirect = vi.fn();

            const redirecting = endDeactivatedSession(redirect);

            expect({ redirecting, redirects: redirect.mock.calls }).toEqual({ redirecting: false, redirects: [] });
            expect(toast.error).toHaveBeenCalledWith('Your account has been deactivated.');
            expect(localStorage.getItem(AUTH_METHOD_KEY)).toBeNull();
        });

        it('leaves the toast to the login page when ?error=deactivated is already showing it', () => {
            window.history.replaceState({}, '', '/login?error=deactivated');

            endDeactivatedSession(vi.fn());

            expect(toast.error).not.toHaveBeenCalled();
        });
    });
});
