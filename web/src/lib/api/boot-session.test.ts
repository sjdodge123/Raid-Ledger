/**
 * ROK-1754 §3.2: the boot re-mints the in-memory token from the refresh cookie
 * for a prior sign-in only; an anonymous visitor makes no request.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AUTH_METHOD_KEY, LEGACY_ACCESS_TOKEN_KEY } from './auth-storage-keys';

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
});
