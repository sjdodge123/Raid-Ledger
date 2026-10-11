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
vi.mock('./refresh-client', () => ({ refreshWithOutcome: refresh }));

function siblingTabWrote(key: string, oldValue: string | null, newValue: string | null): void {
    window.dispatchEvent(new StorageEvent('storage', { key, oldValue, newValue }));
}

describe('ROK-1754 B2: cross-tab auth signals', () => {
    let queryClient: QueryClient;
    let uninstall: () => void;

    beforeEach(() => {
        localStorage.clear();
        refresh.mockReset();
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
