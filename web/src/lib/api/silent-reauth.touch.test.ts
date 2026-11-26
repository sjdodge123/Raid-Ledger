/**
 * ROK-2370 (ruling Q4, AC5): on a touch device — `(pointer: coarse)`, which
 * covers phones and iPads — the automatic `prompt=none` Discord bounce only
 * fires when THIS browser finished a Discord OAuth sign-in in the last 14
 * days. Otherwise a failed refresh falls through to our login page. Desktop
 * (fine pointer) is unchanged.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
    attemptSilentReauth,
    clearAuthMethod,
    DISCORD_OAUTH_FRESH_MS,
    recordDiscordOAuth,
} from './silent-reauth';
import { AUTH_METHOD_KEY, DISCORD_OAUTH_AT_KEY } from './auth-storage-keys';

function stubPointer(coarse: boolean): void {
    vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
        matches: coarse && query === '(pointer: coarse)',
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
    }));
}

describe('attemptSilentReauth — touch-device 14-day Discord OAuth gate (ROK-2370)', () => {
    beforeEach(() => {
        localStorage.clear();
        sessionStorage.clear();
        localStorage.setItem(AUTH_METHOD_KEY, 'discord');
    });
    afterEach(() => vi.restoreAllMocks());

    it('touch + Discord OAuth sign-in within 14 days → bounces to /auth/discord/silent', () => {
        stubPointer(true);
        localStorage.setItem(DISCORD_OAUTH_AT_KEY, String(Date.now() - 60_000));

        expect(attemptSilentReauth('/somewhere')).toBe(true);
    });

    it('touch + Discord OAuth sign-in older than 14 days → falls through to the login page', () => {
        stubPointer(true);
        localStorage.setItem(DISCORD_OAUTH_AT_KEY, String(Date.now() - DISCORD_OAUTH_FRESH_MS - 1_000));

        expect(attemptSilentReauth('/somewhere')).toBe(false);
    });

    it('touch + no Discord OAuth sign-in on record → falls through to the login page', () => {
        stubPointer(true);

        expect(attemptSilentReauth('/somewhere')).toBe(false);
    });

    it('touch + junk timestamp → falls through to the login page', () => {
        stubPointer(true);
        localStorage.setItem(DISCORD_OAUTH_AT_KEY, 'not-a-number');

        expect(attemptSilentReauth('/somewhere')).toBe(false);
    });

    it('non-touch (fine pointer) + no Discord OAuth timestamp → unchanged, still bounces', () => {
        stubPointer(false);

        expect(attemptSilentReauth('/somewhere')).toBe(true);
    });

    it('recordDiscordOAuth stores now; clearAuthMethod (logout) removes it', () => {
        recordDiscordOAuth(1_234);
        expect(localStorage.getItem(DISCORD_OAUTH_AT_KEY)).toBe('1234');

        clearAuthMethod();
        expect(localStorage.getItem(DISCORD_OAUTH_AT_KEY)).toBeNull();
    });
});
