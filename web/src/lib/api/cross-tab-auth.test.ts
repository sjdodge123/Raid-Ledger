/**
 * ROK-1754 §3.3: tabs share signals, not a token. `storage` events fire only
 * in OTHER tabs, so dispatching one here simulates a sibling tab's write.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { AUTH_METHOD_KEY } from './auth-storage-keys';
import { getAccessToken, setAccessToken } from './access-token-store';
import { IDENTITY_EPOCH_KEY, bumpIdentityEpoch, installCrossTabAuth } from './cross-tab-auth';

const refresh = vi.hoisted(() => vi.fn());
// Review m1: an identity change uses freshRefresh (never joins a stale in-flight POST).
vi.mock('./refresh-client', () => ({ freshRefresh: refresh }));
const toastInfo = vi.hoisted(() => vi.fn());
vi.mock('../toast', () => ({ toast: { info: toastInfo } }));

/** An unsigned JWT carrying `impersonatedBy` (readClaims never verifies). */
function impersonationJwt(): string {
    const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
    return `${b64({ alg: 'none' })}.${b64({ sub: 7, impersonatedBy: 1, exp: 4102444800 })}.sig`;
}

function siblingTabWrote(key: string, oldValue: string | null, newValue: string | null): void {
    window.dispatchEvent(new StorageEvent('storage', { key, oldValue, newValue }));
}

describe('ROK-1754 B2: cross-tab auth signals', () => {
    let queryClient: QueryClient;
    let uninstall: () => void;

    beforeEach(() => {
        localStorage.clear();
        refresh.mockReset();
        toastInfo.mockReset();
        queryClient = new QueryClient();
        uninstall = installCrossTabAuth(queryClient);
    });
    afterEach(() => uninstall());

    it('marker removed in another tab → this tab drops its token and its [auth, me]', () => {
        setAccessToken('this-tab-token');
        queryClient.setQueryData(['auth', 'me'], { id: 1, username: 'admin' });
        siblingTabWrote(AUTH_METHOD_KEY, 'local', null);
        expect(getAccessToken()).toBeNull();
        expect(queryClient.getQueryData(['auth', 'me'])).toBeNull();
        expect(refresh).not.toHaveBeenCalled();
    });

    it('marker appearing in another tab (a sign-in) re-checks [auth, me] only', () => {
        const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
        siblingTabWrote(AUTH_METHOD_KEY, null, 'discord');
        expect(invalidate).toHaveBeenCalledWith({ queryKey: ['auth', 'me'] });
        expect(refresh).not.toHaveBeenCalled();
    });

    it('epoch bumped in another tab → clearAccessToken, then ONE refresh, then invalidate', async () => {
        setAccessToken('admin-token');
        const order: string[] = [];
        refresh.mockImplementation(async () => {
            order.push(`refresh(held=${getAccessToken()})`);
            return { kind: 'ok', token: 'impersonation-token' };
        });
        const invalidate = vi.spyOn(queryClient, 'invalidateQueries').mockImplementation(async () => {
            order.push('invalidate');
        });
        siblingTabWrote(IDENTITY_EPOCH_KEY, '1', '2');
        await vi.waitFor(() => expect(invalidate).toHaveBeenCalledTimes(1));
        expect(order).toEqual(['refresh(held=null)', 'invalidate']);
        expect(refresh).toHaveBeenCalledTimes(1);
    });

    it('fix-round n1: "Impersonation ended" only after a definite re-mint, never an indeterminate one', async () => {
        const invalidate = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue();
        setAccessToken(impersonationJwt());
        refresh.mockResolvedValue({ kind: 'indeterminate' });
        siblingTabWrote(IDENTITY_EPOCH_KEY, '1', '2');
        await vi.waitFor(() => expect(invalidate).toHaveBeenCalledTimes(1));
        expect(toastInfo).not.toHaveBeenCalled();

        setAccessToken(impersonationJwt());
        refresh.mockResolvedValue({ kind: 'ok', token: 'admin-token' });
        siblingTabWrote(IDENTITY_EPOCH_KEY, '2', '3');
        await vi.waitFor(() => expect(invalidate).toHaveBeenCalledTimes(2));
        expect(toastInfo).toHaveBeenCalledWith('Impersonation ended');
    });

    it('ROK-1599: marker removed in another tab drops the bearer-carrying calendars overview', () => {
        queryClient.setQueryData(['calendars', 'overview'], { feed: { url: 'https://x.test/api/cal/u/a.ics' } });
        siblingTabWrote(AUTH_METHOD_KEY, 'local', null);
        expect(queryClient.getQueryData(['calendars', 'overview'])).toBeUndefined();
    });

    it('ROK-1599: epoch bumped in another tab drops the calendars overview BEFORE the re-mint', async () => {
        queryClient.setQueryData(['calendars', 'overview'], { feed: { url: 'https://x.test/api/cal/u/a.ics' } });
        const seen: unknown[] = [];
        refresh.mockImplementation(async () => {
            seen.push(queryClient.getQueryData(['calendars', 'overview']));
            return { kind: 'ok', token: 'next-token' };
        });
        const invalidate = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue();
        siblingTabWrote(IDENTITY_EPOCH_KEY, '1', '2');
        await vi.waitFor(() => expect(invalidate).toHaveBeenCalledTimes(1));
        expect(seen).toEqual([undefined]);
    });

    it('an unrelated key leaves the token alone', () => {
        setAccessToken('kept');
        siblingTabWrote('raid_ledger_theme', 'a', 'b');
        expect(getAccessToken()).toBe('kept');
    });

    it('bumpIdentityEpoch writes a timestamp, never a credential', () => {
        setAccessToken('secret.jwt.value');
        bumpIdentityEpoch();
        expect(localStorage.getItem(IDENTITY_EPOCH_KEY)).toMatch(/^\d+$/);
    });
});
