/**
 * ROK-2371: a Google sign-in records `'google'` and never triggers the silent
 * Discord bounce — a failed refresh shows the login page instead of signing
 * the member into whatever Discord account the browser holds.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { attemptSilentReauth, getAuthMethod, setAuthMethod } from './silent-reauth';
import { AUTH_METHOD_KEY, SILENT_GUARD_KEY } from './auth-storage-keys';

describe('silent re-auth after a Google sign-in (ROK-2371)', () => {
    beforeEach(() => {
        localStorage.clear();
        sessionStorage.clear();
    });

    it('records google as the auth method', () => {
        setAuthMethod('google');
        expect(getAuthMethod()).toBe('google');
        expect(localStorage.getItem(AUTH_METHOD_KEY)).toBe('google');
    });

    it('never bounces to Discord and arms no guard', () => {
        setAuthMethod('google');
        expect(attemptSilentReauth('/calendar'), 'a google session must fall through to the login page').toBe(false);
        expect(sessionStorage.getItem(SILENT_GUARD_KEY)).toBeNull();
    });

    it('a later Discord sign-in in the same browser still bounces (control)', () => {
        setAuthMethod('google');
        setAuthMethod('discord');
        expect(attemptSilentReauth('/calendar')).toBe(true);
    });
});
