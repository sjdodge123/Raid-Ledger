/**
 * ROK-2361 #9: the Blizzard settings routes require the `blizzard` plugin, and core
 * admin pages compose this hook, so the status GET must wait for the plugin —
 * otherwise every core admin page fires a request that 403s while it is off.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { usePluginStore } from '../../stores/plugin-store';

const adminFetchMock = vi.fn();
vi.mock('./admin-fetch', () => ({ adminFetch: (...a: unknown[]) => adminFetchMock(...a) }));
vi.mock('../use-auth', () => ({ getAuthToken: () => 'test-token' }));

import { useBlizzardSettings } from './use-blizzard-settings';

function renderBlizzardSettings() {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) =>
        createElement(QueryClientProvider, { client: queryClient }, children);
    return renderHook(() => useBlizzardSettings(), { wrapper }).result;
}

function setActivePlugins(slugs: string[]) {
    usePluginStore.setState({ activeSlugs: new Set(slugs), initialized: true, settled: true });
}

describe('useBlizzardSettings — status read follows the blizzard plugin (ROK-2361 #9)', () => {
    beforeEach(() => {
        adminFetchMock.mockReset();
        adminFetchMock.mockResolvedValue({ configured: true });
    });

    afterEach(() => setActivePlugins(['core']));

    it('never requests the Blizzard status while the plugin is inactive', async () => {
        setActivePlugins(['core']);
        const result = renderBlizzardSettings();
        // Let any wrongly-enabled query start before asserting it stayed idle.
        await new Promise((r) => setTimeout(r, 0));
        expect(result.current.blizzardStatus.fetchStatus).toBe('idle');
        expect(adminFetchMock).not.toHaveBeenCalled();
    });

    it('reads the Blizzard status while the plugin is active', async () => {
        setActivePlugins(['core', 'blizzard']);
        const result = renderBlizzardSettings();
        await waitFor(() => expect(result.current.blizzardStatus.data).toEqual({ configured: true }));
        expect(adminFetchMock).toHaveBeenCalledWith('/admin/settings/blizzard');
    });
});
