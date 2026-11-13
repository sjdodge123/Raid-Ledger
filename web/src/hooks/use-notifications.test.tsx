/**
 * A notification-preference save still in flight at logout must not write the
 * previous viewer's preferences back into the cache when it fails: the logout
 * drop (`dropViewerPrivateCaches`) bumps a generation the rollback checks.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { clearAccessToken } from '../lib/api/access-token-store';
import { toast } from '../lib/toast';
import { patchPreferences } from './notifications-api';
import { useNotificationPreferences } from './use-notifications';
import { dropViewerPrivateCaches } from './viewer-private-caches';

vi.mock('../lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('./notifications-api', () => ({
    fetchNotifications: vi.fn(),
    fetchUnreadCount: vi.fn(),
    markNotificationRead: vi.fn(),
    markAllNotificationsRead: vi.fn(),
    // Hoisted above the constants: the literal mirrors PREVIOUS_VIEWER_PREFS.
    fetchPreferences: vi.fn(async () => ({ userId: 7, channelPrefs: {} })),
    patchPreferences: vi.fn(),
    fetchChannelAvailability: vi.fn(async () => ({ discord: { available: false } })),
}));

const PREFS_KEY = ['notifications', 'preferences'];
const PREVIOUS_VIEWER_PREFS = { userId: 7, channelPrefs: {} };

/** A pending promise whose rejection the test triggers. */
function deferredFailure(): { promise: Promise<never>; fail: (e: Error) => void } {
    let fail: (e: Error) => void = () => undefined;
    const promise = new Promise<never>((_, reject) => { fail = reject; });
    return { promise, fail };
}

async function renderPrefs(queryClient: QueryClient) {
    const wrapper = ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const view = renderHook(() => useNotificationPreferences(), { wrapper });
    await waitFor(() => { expect(view.result.current.preferences).toEqual(PREVIOUS_VIEWER_PREFS); });
    return view;
}

describe('useNotificationPreferences — rollback across a logout', () => {
    let queryClient: QueryClient;

    beforeEach(() => {
        vi.clearAllMocks();
        clearAccessToken();
        queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    });

    it('a failed save after the logout drop does not write the previous viewer’s preferences back', async () => {
        const { result } = await renderPrefs(queryClient);
        const patch = deferredFailure();
        vi.mocked(patchPreferences).mockReturnValue(patch.promise);
        act(() => { result.current.updatePreferences({ channelPrefs: { new_event: { push: false } } }); });
        await waitFor(() => { expect(patchPreferences).toHaveBeenCalledTimes(1); });

        act(() => { dropViewerPrivateCaches(queryClient); });
        const setQueryData = vi.spyOn(queryClient, 'setQueryData');
        await act(async () => { patch.fail(new Error('network down')); });
        await waitFor(() => { expect(toast.error).toHaveBeenCalledTimes(1); });

        expect(setQueryData, 'the rollback wrote the previous viewer’s preferences after logout').not.toHaveBeenCalled();
        expect(queryClient.getQueryData(PREFS_KEY)).toBeUndefined();
    });

    it('a failed save with no logout in between still rolls the optimistic change back', async () => {
        const { result } = await renderPrefs(queryClient);
        const patch = deferredFailure();
        vi.mocked(patchPreferences).mockReturnValue(patch.promise);
        act(() => { result.current.updatePreferences({ channelPrefs: { new_event: { push: false } } }); });
        await waitFor(() => { expect(patchPreferences).toHaveBeenCalledTimes(1); });

        const setQueryData = vi.spyOn(queryClient, 'setQueryData');
        await act(async () => { patch.fail(new Error('network down')); });
        await waitFor(() => { expect(toast.error).toHaveBeenCalledTimes(1); });

        expect(setQueryData).toHaveBeenCalledWith(PREFS_KEY, PREVIOUS_VIEWER_PREFS);
    });
});
