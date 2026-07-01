/**
 * ROK-1367: the silent-reauth guard is a TIMESTAMP + cooldown, not a boolean
 * one-shot. A `prompt=none` attempt that fails at Discord returns `?error=...`
 * with the guard still armed; without a cooldown the next mount would loop
 * `/` ↔ Discord forever. These tests pin: fresh guard → suppressed; stale
 * guard → one genuine retry (guard re-armed); non-discord → never fires.
 *
 * `attemptSilentReauth` returns `true` only after it reaches
 * `window.location.assign` (the last line), so the boolean return is a faithful
 * proxy for "did the redirect fire" — jsdom's `location.assign` isn't spyable,
 * and the guard-state assertions cover the arm/re-arm behaviour directly.
 */
import { describe, it, expect, beforeEach } from 'vitest';

import {
    attemptSilentReauth,
    SILENT_REAUTH_COOLDOWN_MS,
} from './silent-reauth';
import { AUTH_METHOD_KEY, SILENT_GUARD_KEY } from './auth-storage-keys';

describe('attemptSilentReauth — ROK-1367 timestamped cooldown guard', () => {
    beforeEach(() => {
        localStorage.clear();
        sessionStorage.clear();
        localStorage.setItem(AUTH_METHOD_KEY, 'discord');
    });

    it('fires and arms a fresh timestamp guard when none exists', () => {
        const before = Date.now();

        expect(attemptSilentReauth('/somewhere')).toBe(true);
        expect(Number(sessionStorage.getItem(SILENT_GUARD_KEY))).toBeGreaterThanOrEqual(before);
    });

    it('no-ops while a fresh guard is within the cooldown', () => {
        const armed = String(Date.now());
        sessionStorage.setItem(SILENT_GUARD_KEY, armed);

        expect(attemptSilentReauth('/somewhere')).toBe(false);
        // Guard left untouched — no re-arm, no clear.
        expect(sessionStorage.getItem(SILENT_GUARD_KEY)).toBe(armed);
    });

    it('clears a stale guard and retries once the cooldown elapses', () => {
        const stale = Date.now() - (SILENT_REAUTH_COOLDOWN_MS + 1_000);
        sessionStorage.setItem(SILENT_GUARD_KEY, String(stale));

        expect(attemptSilentReauth('/somewhere')).toBe(true);
        // Re-armed with a fresh timestamp, not the stale one.
        expect(Number(sessionStorage.getItem(SILENT_GUARD_KEY))).toBeGreaterThan(stale);
    });

    it('does not fire for a non-discord auth method', () => {
        localStorage.setItem(AUTH_METHOD_KEY, 'local');

        expect(attemptSilentReauth('/somewhere')).toBe(false);
    });
});
