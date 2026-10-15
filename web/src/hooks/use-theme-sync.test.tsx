import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useCalendarLayerFilterStore } from '../stores/calendar-layer-filter-store';
import { useThemeSync } from './use-theme-sync';

const LAYER = 'pelican:server-schedule';

const auth = vi.hoisted(() => ({ user: null as { id: number } | null }));
const prefsByUser = vi.hoisted(() => new Map<number, Record<string, unknown>>());

vi.mock('./use-auth', () => ({
    useAuth: () => ({ user: auth.user, isAuthenticated: auth.user !== null }),
    useViewerCacheScope: () => auth.user?.id ?? 'anon',
    getAuthToken: () => (auth.user ? 'token' : null),
}));

vi.mock('../lib/api-client', () => ({
    getMyPreferences: vi.fn(async () => {
        const id = auth.user?.id;
        if (id === undefined) throw new Error('unauthenticated');
        return prefsByUser.get(id) ?? {};
    }),
    updatePreference: vi.fn(async () => undefined),
}));

function renderSync() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    return renderHook(() => useThemeSync(), { wrapper });
}

function hidden(): string[] {
    return [...useCalendarLayerFilterStore.getState().hiddenLayers];
}

describe('useThemeSync — calendar hidden layers (ROK-1775)', () => {
    beforeEach(() => {
        auth.user = null;
        prefsByUser.clear();
        useCalendarLayerFilterStore.getState()._reset();
    });

    it('loads calendarHiddenLayers at login and marks the store hydrated', async () => {
        prefsByUser.set(1, { calendarHiddenLayers: [LAYER] });
        auth.user = { id: 1 };
        renderSync();
        await waitFor(() => expect(useCalendarLayerFilterStore.getState().hydrated).toBe(true));
        expect(hidden()).toEqual([LAYER]);
    });

    it('a viewer with no saved pref sees every layer, even after another viewer hid one', async () => {
        useCalendarLayerFilterStore.setState({ hiddenLayers: new Set([LAYER]) }); // stale set in memory
        auth.user = { id: 2 };
        renderSync();
        await waitFor(() => expect(useCalendarLayerFilterStore.getState().hydrated).toBe(true));
        expect(hidden()).toEqual([]);
    });

    it('user A hides a layer, logs out, user B (no pref) logs in → the layer is visible for B', async () => {
        prefsByUser.set(1, { calendarHiddenLayers: [LAYER] });
        auth.user = { id: 1 };
        const { rerender } = renderSync();
        await waitFor(() => expect(hidden()).toEqual([LAYER]));

        auth.user = null; // logout
        rerender();
        expect(hidden()).toEqual([]);
        expect(useCalendarLayerFilterStore.getState().hydrated).toBe(false);

        auth.user = { id: 2 }; // user B, nothing saved
        rerender();
        await waitFor(() => expect(useCalendarLayerFilterStore.getState().hydrated).toBe(true));
        expect(hidden()).toEqual([]);
    });

    it('a viewer who logs out and back in gets their SAVED preference, not the snapshot cached before they left', async () => {
        prefsByUser.set(4, {});
        auth.user = { id: 4 };
        const { rerender } = renderSync();
        await waitFor(() => expect(useCalendarLayerFilterStore.getState().hydrated).toBe(true));
        expect(hidden()).toEqual([]);

        prefsByUser.set(4, { calendarHiddenLayers: [LAYER] }); // the toggle write landed server-side
        auth.user = null; // logout
        rerender();
        expect(useCalendarLayerFilterStore.getState().hydrated).toBe(false);

        auth.user = { id: 4 }; // same viewer signs back in
        rerender();
        await waitFor(() => expect(useCalendarLayerFilterStore.getState().hydrated).toBe(true));
        expect(hidden()).toEqual([LAYER]);
    });

    it('a failed preference load still hydrates, so layers are not held off forever', async () => {
        auth.user = { id: 3 };
        const { getMyPreferences } = await import('../lib/api-client');
        vi.mocked(getMyPreferences).mockRejectedValueOnce(new Error('offline'));
        renderSync();
        await waitFor(() => expect(useCalendarLayerFilterStore.getState().hydrated).toBe(true));
        expect(hidden()).toEqual([]);
    });
});
