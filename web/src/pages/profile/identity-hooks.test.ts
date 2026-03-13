/**
 * Tests for identity-hooks.ts (ROK-548).
 * Covers: useAutoHeart, useSteamRedirectFeedback.
 *
 * These are extracted hooks shared across preferences, watched-games,
 * and integrations panels. Tests verify:
 * - Correct preference key ('autoHeartGames') used by useAutoHeart
 * - useSteamRedirectFeedback shows toasts and cleans URL params
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { createElement, type ReactNode } from 'react';

// --- Module mocks (must be before imports of the mocked modules) ---

vi.mock('../../lib/toast', () => ({
    toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock('../../lib/api-client', () => ({
    getMyPreferences: vi.fn(),
    updatePreference: vi.fn(),
}));

import {
    useAutoHeart,
    useSteamRedirectFeedback,
} from './identity-hooks';
import { toast } from '../../lib/toast';
import { getMyPreferences, updatePreference } from '../../lib/api-client';

const mockGetMyPreferences = getMyPreferences as ReturnType<typeof vi.fn>;
const mockUpdatePreference = updatePreference as ReturnType<typeof vi.fn>;
const mockToast = toast as {
    success: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
    info: ReturnType<typeof vi.fn>;
};

function createWrapper() {
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const wrapper = ({ children }: { children: ReactNode }) =>
        createElement(
            QueryClientProvider,
            { client: queryClient },
            createElement(MemoryRouter, null, children),
        );
    return { queryClient, wrapper };
}

// ─────────────────────────────────────────────────────────────────────────────
// useAutoHeart
// ─────────────────────────────────────────────────────────────────────────────

describe('useAutoHeart', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('does not fetch preferences when not authenticated', async () => {
        mockGetMyPreferences.mockResolvedValue({ autoHeartGames: true });
        const { queryClient, wrapper } = createWrapper();
        renderHook(() => useAutoHeart(false, true), { wrapper });
        await new Promise((r) => setTimeout(r, 50));
        expect(mockGetMyPreferences).not.toHaveBeenCalled();
        queryClient.clear();
    });

    it('does not fetch preferences when no Discord linked', async () => {
        mockGetMyPreferences.mockResolvedValue({ autoHeartGames: true });
        const { queryClient, wrapper } = createWrapper();
        renderHook(() => useAutoHeart(true, false), { wrapper });
        await new Promise((r) => setTimeout(r, 50));
        expect(mockGetMyPreferences).not.toHaveBeenCalled();
        queryClient.clear();
    });

    it('fetches preferences using getMyPreferences when authenticated with Discord', async () => {
        mockGetMyPreferences.mockResolvedValue({ autoHeartGames: true });
        const { queryClient, wrapper } = createWrapper();
        renderHook(() => useAutoHeart(true, true), { wrapper });
        await waitFor(() => expect(mockGetMyPreferences).toHaveBeenCalledTimes(1));
        queryClient.clear();
    });

    it('defaults autoHeartEnabled to true when preference key is absent', async () => {
        mockGetMyPreferences.mockResolvedValue({});
        const { queryClient, wrapper } = createWrapper();
        const { result } = renderHook(() => useAutoHeart(true, true), { wrapper });
        await waitFor(() => expect(result.current.autoHeartEnabled).toBe(true));
        queryClient.clear();
    });

    it('autoHeartEnabled is true when preference is explicitly true', async () => {
        mockGetMyPreferences.mockResolvedValue({ autoHeartGames: true });
        const { queryClient, wrapper } = createWrapper();
        const { result } = renderHook(() => useAutoHeart(true, true), { wrapper });
        await waitFor(() => expect(result.current.autoHeartEnabled).toBe(true));
        queryClient.clear();
    });

    it('autoHeartEnabled is false when preference is explicitly false', async () => {
        mockGetMyPreferences.mockResolvedValue({ autoHeartGames: false });
        const { queryClient, wrapper } = createWrapper();
        const { result } = renderHook(() => useAutoHeart(true, true), { wrapper });
        await waitFor(() => expect(result.current.autoHeartEnabled).toBe(false));
        queryClient.clear();
    });

    it('calls updatePreference with key "autoHeartGames" on toggle', async () => {
        mockGetMyPreferences.mockResolvedValue({ autoHeartGames: true });
        mockUpdatePreference.mockResolvedValue(undefined);
        const { queryClient, wrapper } = createWrapper();
        const { result } = renderHook(() => useAutoHeart(true, true), { wrapper });
        await waitFor(() => expect(result.current.autoHeartEnabled).toBe(true));
        act(() => { result.current.toggleAutoHeart(false); });
        await waitFor(() =>
            expect(mockUpdatePreference).toHaveBeenCalledWith('autoHeartGames', false),
        );
        queryClient.clear();
    });

    it('shows error toast when updatePreference fails', async () => {
        mockGetMyPreferences.mockResolvedValue({ autoHeartGames: true });
        mockUpdatePreference.mockRejectedValue(new Error('network error'));
        const { queryClient, wrapper } = createWrapper();
        const { result } = renderHook(() => useAutoHeart(true, true), { wrapper });
        await waitFor(() => expect(result.current.autoHeartEnabled).toBe(true));
        act(() => { result.current.toggleAutoHeart(false); });
        await waitFor(() =>
            expect(mockToast.error).toHaveBeenCalledWith('Failed to update auto-heart preference'),
        );
        queryClient.clear();
    });

    it('isPending is false before any toggle', async () => {
        mockGetMyPreferences.mockResolvedValue({ autoHeartGames: true });
        const { queryClient, wrapper } = createWrapper();
        const { result } = renderHook(() => useAutoHeart(true, true), { wrapper });
        expect(result.current.isPending).toBe(false);
        queryClient.clear();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// useAutoHeart — preference key consistency check
// ─────────────────────────────────────────────────────────────────────────────

describe('useAutoHeart preference key consistency (ROK-548 AC: both panels share same key)', () => {
    it('uses "autoHeartGames" as the preference key for mutation, not any other key', async () => {
        mockGetMyPreferences.mockResolvedValue({ autoHeartGames: true });
        mockUpdatePreference.mockResolvedValue(undefined);
        const { queryClient, wrapper } = createWrapper();
        const { result } = renderHook(() => useAutoHeart(true, true), { wrapper });
        await waitFor(() => expect(result.current.autoHeartEnabled).toBe(true));
        act(() => { result.current.toggleAutoHeart(true); });
        await waitFor(() => expect(mockUpdatePreference).toHaveBeenCalled());
        const [keyArg] = mockUpdatePreference.mock.calls[0];
        expect(keyArg).toBe('autoHeartGames');
        queryClient.clear();
    });

    it('uses "user-preferences" as the query key (matches both panel hooks)', async () => {
        mockGetMyPreferences.mockResolvedValue({ autoHeartGames: true });
        const { queryClient, wrapper } = createWrapper();
        renderHook(() => useAutoHeart(true, true), { wrapper });
        await waitFor(() => expect(mockGetMyPreferences).toHaveBeenCalled());
        const cached = queryClient.getQueryData(['user-preferences']);
        expect(cached).toEqual({ autoHeartGames: true });
        queryClient.clear();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// useSteamRedirectFeedback
// ─────────────────────────────────────────────────────────────────────────────

describe('useSteamRedirectFeedback', () => {
    let replaceStateSpy: ReturnType<typeof vi.spyOn>;

    function mockLocationSearch(params: Record<string, string>, pathname = '/profile/integrations') {
        const search = new URLSearchParams(params).toString();
        Object.defineProperty(window, 'location', {
            writable: true,
            configurable: true,
            value: {
                search: search ? `?${search}` : '',
                pathname,
                href: `http://localhost${pathname}${search ? `?${search}` : ''}`,
            },
        });
    }

    beforeEach(() => {
        vi.clearAllMocks();
        replaceStateSpy = vi.spyOn(window.history, 'replaceState').mockImplementation(() => undefined);
    });

    afterEach(() => {
        replaceStateSpy.mockRestore();
        Object.defineProperty(window, 'location', {
            writable: true,
            configurable: true,
            value: { search: '', pathname: '/', href: 'http://localhost/' },
        });
    });

    it('shows success toast when steam=success', () => {
        mockLocationSearch({ steam: 'success' });
        const { wrapper } = createWrapper();
        renderHook(() => useSteamRedirectFeedback(), { wrapper });
        expect(mockToast.success).toHaveBeenCalledWith('Steam account linked successfully!');
    });

    it('shows info toast when steam=success and steam_private=true', () => {
        mockLocationSearch({ steam: 'success', steam_private: 'true' });
        const { wrapper } = createWrapper();
        renderHook(() => useSteamRedirectFeedback(), { wrapper });
        expect(mockToast.info).toHaveBeenCalledWith(
            'Set your Steam profile to public so we can sync your game library.',
        );
    });

    it('does not show info toast when steam_private is not "true"', () => {
        mockLocationSearch({ steam: 'success', steam_private: 'false' });
        const { wrapper } = createWrapper();
        renderHook(() => useSteamRedirectFeedback(), { wrapper });
        expect(mockToast.info).not.toHaveBeenCalled();
    });

    it('shows error toast with message when steam=error and message param present', () => {
        mockLocationSearch({ steam: 'error', message: 'OAuth cancelled' });
        const { wrapper } = createWrapper();
        renderHook(() => useSteamRedirectFeedback(), { wrapper });
        expect(mockToast.error).toHaveBeenCalledWith('OAuth cancelled');
    });

    it('shows fallback error toast when steam=error with no message param', () => {
        mockLocationSearch({ steam: 'error' });
        const { wrapper } = createWrapper();
        renderHook(() => useSteamRedirectFeedback(), { wrapper });
        expect(mockToast.error).toHaveBeenCalledWith('Steam linking failed');
    });

    it('calls replaceState to clean URL when steam param is present', () => {
        mockLocationSearch({ steam: 'success' }, '/profile/integrations');
        const { wrapper } = createWrapper();
        renderHook(() => useSteamRedirectFeedback(), { wrapper });
        expect(replaceStateSpy).toHaveBeenCalledWith({}, '', '/profile/integrations');
    });

    it('does not call replaceState when no steam param present', () => {
        mockLocationSearch({});
        const { wrapper } = createWrapper();
        renderHook(() => useSteamRedirectFeedback(), { wrapper });
        expect(replaceStateSpy).not.toHaveBeenCalled();
    });

    it('does not show any toast when no steam param present', () => {
        mockLocationSearch({});
        const { wrapper } = createWrapper();
        renderHook(() => useSteamRedirectFeedback(), { wrapper });
        expect(mockToast.success).not.toHaveBeenCalled();
        expect(mockToast.error).not.toHaveBeenCalled();
        expect(mockToast.info).not.toHaveBeenCalled();
    });
});
