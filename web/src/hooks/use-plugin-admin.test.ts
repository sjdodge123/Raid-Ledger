import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';

// Mock auth token
vi.mock('./use-auth', () => ({
    getAuthToken: () => 'test-token',
}));

// Mock API client
const mockGetPlugins = vi.fn();
const mockInstallPlugin = vi.fn();
const mockUninstallPlugin = vi.fn();
const mockActivatePlugin = vi.fn();
const mockDeactivatePlugin = vi.fn();

vi.mock('../lib/api-client', () => ({
    getPlugins: (...args: unknown[]) => mockGetPlugins(...args),
    installPlugin: (...args: unknown[]) => mockInstallPlugin(...args),
    uninstallPlugin: (...args: unknown[]) => mockUninstallPlugin(...args),
    activatePlugin: (...args: unknown[]) => mockActivatePlugin(...args),
    deactivatePlugin: (...args: unknown[]) => mockDeactivatePlugin(...args),
}));

import { usePluginAdmin } from './use-plugin-admin';

function createWrapper() {
    const queryClient = new QueryClient({
        defaultOptions: {
            queries: { retry: false },
            mutations: { retry: false },
        },
    });

    return function Wrapper({ children }: { children: ReactNode }) {
        return createElement(QueryClientProvider, { client: queryClient }, children);
    };
}

describe('usePluginAdmin', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should fetch plugins on mount', async () => {
        const plugins = [
            {
                slug: 'test',
                name: 'Test',
                version: '1.0.0',
                description: 'desc',
                author: { name: 'Author' },
                gameSlugs: [],
                capabilities: [],
                integrations: [],
                status: 'active',
                installedAt: null,
            },
        ];
        mockGetPlugins.mockResolvedValue(plugins);

        const { result } = renderHook(() => usePluginAdmin(), {
            wrapper: createWrapper(),
        });

        await waitFor(() => {
            expect(result.current.plugins.isSuccess).toBe(true);
        });

        expect(result.current.plugins.data).toEqual(plugins);
        expect(mockGetPlugins).toHaveBeenCalledOnce();
    });

    it('should call installPlugin on install mutation', async () => {
        mockGetPlugins.mockResolvedValue([]);
        mockInstallPlugin.mockResolvedValue(undefined);

        const { result } = renderHook(() => usePluginAdmin(), {
            wrapper: createWrapper(),
        });

        await waitFor(() => {
            expect(result.current.plugins.isSuccess).toBe(true);
        });

        await act(async () => {
            await result.current.install.mutateAsync('test-plugin');
        });

        expect(mockInstallPlugin).toHaveBeenCalledWith('test-plugin', expect.anything());
    });

    it('should call uninstallPlugin on uninstall mutation', async () => {
        mockGetPlugins.mockResolvedValue([]);
        mockUninstallPlugin.mockResolvedValue(undefined);

        const { result } = renderHook(() => usePluginAdmin(), {
            wrapper: createWrapper(),
        });

        await waitFor(() => {
            expect(result.current.plugins.isSuccess).toBe(true);
        });

        await act(async () => {
            await result.current.uninstall.mutateAsync('test-plugin');
        });

        expect(mockUninstallPlugin).toHaveBeenCalledWith('test-plugin', expect.anything());
    });

    it('should call activatePlugin on activate mutation', async () => {
        mockGetPlugins.mockResolvedValue([]);
        mockActivatePlugin.mockResolvedValue(undefined);

        const { result } = renderHook(() => usePluginAdmin(), {
            wrapper: createWrapper(),
        });

        await waitFor(() => {
            expect(result.current.plugins.isSuccess).toBe(true);
        });

        await act(async () => {
            await result.current.activate.mutateAsync('test-plugin');
        });

        expect(mockActivatePlugin).toHaveBeenCalledWith('test-plugin', expect.anything());
    });

    it('should call deactivatePlugin on deactivate mutation', async () => {
        mockGetPlugins.mockResolvedValue([]);
        mockDeactivatePlugin.mockResolvedValue(undefined);

        const { result } = renderHook(() => usePluginAdmin(), {
            wrapper: createWrapper(),
        });

        await waitFor(() => {
            expect(result.current.plugins.isSuccess).toBe(true);
        });

        await act(async () => {
            await result.current.deactivate.mutateAsync('test-plugin');
        });

        expect(mockDeactivatePlugin).toHaveBeenCalledWith('test-plugin', expect.anything());
    });
});
