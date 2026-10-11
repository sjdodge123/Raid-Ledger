/**
 * ROK-1754 §3.2: the boot re-mints the in-memory token from the refresh cookie
 * for a prior sign-in only; an anonymous visitor makes no request.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AUTH_METHOD_KEY, LEGACY_ACCESS_TOKEN_KEY, LEGACY_MIGRATION_PENDING_KEY } from './auth-storage-keys';

const refresh = vi.hoisted(() => vi.fn());
vi.mock('./refresh-client', () => ({ refreshWithOutcome: refresh }));
vi.mock('../magic-link-redeem', () => ({
    isMagicLinkRedeemPending: () => false,
    awaitMagicLinkRedeem: () => Promise.resolve(),
}));

/** Fresh module state per test (boot + the load-time legacy purge). */
async function load() {
    vi.resetModules();
    return import('./boot-session');
}

describe('ROK-1754 B2: boot session', () => {
    beforeEach(() => {
        localStorage.clear();
        refresh.mockReset();
    });
    afterEach(() => vi.useRealTimers());

    it('an anonymous visitor makes no refresh and the boot is settled at once', async () => {
        const boot = await load();
        const outcome = boot.startBootSession();
        expect(boot.isBootSettled()).toBe(true);
        await expect(outcome).resolves.toBe('anonymous');
        expect(refresh).not.toHaveBeenCalled();
    });

    it('a prior sign-in refreshes exactly once and stays unsettled until it resolves', async () => {
        localStorage.setItem(AUTH_METHOD_KEY, 'discord');
        let resolve!: (o: unknown) => void;
        refresh.mockReturnValue(new Promise((r) => { resolve = r; }));
        const boot = await load();
        const outcome = boot.startBootSession();
        boot.startBootSession();
        await Promise.resolve();
        expect(boot.isBootSettled()).toBe(false);
        resolve({ kind: 'ok', token: 't' });
        await expect(outcome).resolves.toBe('ok');
        expect(boot.isBootSettled()).toBe(true);
        expect(refresh).toHaveBeenCalledTimes(1);
    });

    it('a legacy stored token (an upgrading user, no marker) is purged and re-minted', async () => {
        localStorage.setItem(LEGACY_ACCESS_TOKEN_KEY, 'old-bundle-jwt');
        refresh.mockResolvedValue({ kind: 'rejected' });
        const boot = await load();
        await expect(boot.startBootSession()).resolves.toBe('rejected');
        expect(refresh).toHaveBeenCalledTimes(1);
        expect(localStorage.getItem(LEGACY_ACCESS_TOKEN_KEY)).toBeNull();
    });

    it('a hung refresh settles as indeterminate after BOOT_TIMEOUT_MS (the app renders)', async () => {
        vi.useFakeTimers();
        localStorage.setItem(AUTH_METHOD_KEY, 'local');
        refresh.mockReturnValue(new Promise(() => {}));
        const boot = await load();
        const outcome = boot.startBootSession();
        await vi.advanceTimersByTimeAsync(boot.BOOT_TIMEOUT_MS);
        await expect(outcome).resolves.toBe('indeterminate');
        expect(boot.isBootSettled()).toBe(true);
    });

    it('review m2: a purged legacy session that re-mints writes the marker, so the next load still boots', async () => {
        localStorage.setItem(LEGACY_ACCESS_TOKEN_KEY, 'old-bundle-jwt');
        refresh.mockResolvedValue({ kind: 'ok', token: 't' });
        const boot = await load();
        await expect(boot.startBootSession()).resolves.toBe('ok');
        expect(localStorage.getItem(AUTH_METHOD_KEY)).toBe('local');
    });

    it('review m2: an existing marker is never overwritten', async () => {
        localStorage.setItem(AUTH_METHOD_KEY, 'discord');
        refresh.mockResolvedValue({ kind: 'ok', token: 't' });
        const boot = await load();
        await boot.startBootSession();
        expect(localStorage.getItem(AUTH_METHOD_KEY)).toBe('discord');
    });

    it('review m3: /auth/success exchanges its own code — no boot refresh races it', async () => {
        localStorage.setItem(AUTH_METHOD_KEY, 'discord');
        window.history.pushState({}, '', '/auth/success');
        try {
            const boot = await load();
            await expect(boot.startBootSession()).resolves.toBe('anonymous');
            expect(refresh).not.toHaveBeenCalled();
        } finally {
            window.history.pushState({}, '', '/');
        }
    });

    describe('review r1: the legacy migration is retry-safe', () => {
        it('ok → marker written, pending flag settled', async () => {
            localStorage.setItem(LEGACY_ACCESS_TOKEN_KEY, 'old-bundle-jwt');
            refresh.mockResolvedValue({ kind: 'ok', token: 't' });
            const boot = await load();
            await expect(boot.startBootSession()).resolves.toBe('ok');
            expect(localStorage.getItem(AUTH_METHOD_KEY)).toBe('local');
            expect(localStorage.getItem(LEGACY_MIGRATION_PENDING_KEY)).toBeNull();
        });

        it('rejected → no marker, pending flag settled, the next load boots anonymous', async () => {
            localStorage.setItem(LEGACY_ACCESS_TOKEN_KEY, 'old-bundle-jwt');
            refresh.mockResolvedValue({ kind: 'rejected' });
            const first = await load();
            await expect(first.startBootSession()).resolves.toBe('rejected');
            expect(localStorage.getItem(AUTH_METHOD_KEY)).toBeNull();
            expect(localStorage.getItem(LEGACY_MIGRATION_PENDING_KEY)).toBeNull();
            const next = await load();
            await expect(next.startBootSession()).resolves.toBe('anonymous');
            expect(refresh).toHaveBeenCalledTimes(1);
        });

        it('indeterminate (429/5xx/network) → flag kept; the NEXT load retries the migration and heals', async () => {
            localStorage.setItem(LEGACY_ACCESS_TOKEN_KEY, 'old-bundle-jwt');
            refresh.mockResolvedValueOnce({ kind: 'indeterminate' });
            const first = await load();
            await expect(first.startBootSession()).resolves.toBe('indeterminate');
            expect(localStorage.getItem(LEGACY_ACCESS_TOKEN_KEY)).toBeNull();
            expect(localStorage.getItem(LEGACY_MIGRATION_PENDING_KEY)).toBe('1');
            expect(localStorage.getItem(AUTH_METHOD_KEY)).toBeNull();

            refresh.mockResolvedValueOnce({ kind: 'ok', token: 't' });
            const next = await load();
            await expect(next.startBootSession()).resolves.toBe('ok');
            expect(refresh).toHaveBeenCalledTimes(2);
            expect(localStorage.getItem(AUTH_METHOD_KEY)).toBe('local');
            expect(localStorage.getItem(LEGACY_MIGRATION_PENDING_KEY)).toBeNull();
        });

        it('a refresh that throws counts as indeterminate and keeps the flag', async () => {
            localStorage.setItem(LEGACY_ACCESS_TOKEN_KEY, 'old-bundle-jwt');
            refresh.mockRejectedValue(new TypeError('Failed to fetch'));
            const boot = await load();
            await expect(boot.startBootSession()).resolves.toBe('indeterminate');
            expect(localStorage.getItem(LEGACY_MIGRATION_PENDING_KEY)).toBe('1');
        });
    });
});
