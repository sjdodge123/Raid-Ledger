/**
 * Tests for identity-hooks.ts (ROK-548).
 * Covers: useAutoHeart, resolveCurrentAvatar, useHasDiscordLinked,
 * useSteamRedirectFeedback, useAvatarSelection.
 *
 * These are extracted hooks shared across avatar, preferences, and
 * watched-games panels. Tests verify:
 * - Correct preference key ('autoHeartGames') used by useAutoHeart
 * - resolveCurrentAvatar returns optimistic URL when provided
 * - useHasDiscordLinked delegates correctly to isDiscordLinked
 * - useSteamRedirectFeedback shows toasts and cleans URL params
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { createElement, type ReactNode } from 'react';

// --- Module mocks (must be before imports of the mocked modules) ---

vi.mock('../../hooks/use-auth', () => ({
    useAuth: vi.fn(() => ({ logout: vi.fn() })),
}));

vi.mock('../../hooks/use-avatar-upload', () => ({
    useAvatarUpload: vi.fn(() => ({
        upload: vi.fn(),
        deleteAvatar: vi.fn(),
        isUploading: false,
        uploadProgress: 0,
    })),
}));

vi.mock('../../lib/avatar', () => ({
    resolveAvatar: vi.fn(),
    toAvatarUser: vi.fn((u: unknown) => u),
    isDiscordLinked: vi.fn((id: string | null) =>
        Boolean(id && !id.startsWith('local:') && !id.startsWith('unlinked:')),
    ),
}));

vi.mock('../../lib/toast', () => ({
    toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock('../../lib/api-client', () => ({
    getMyPreferences: vi.fn(),
    updatePreference: vi.fn(),
    deleteMyAccount: vi.fn(),
}));

import {
    useAutoHeart,
    resolveCurrentAvatar,
    useHasDiscordLinked,
    useSteamRedirectFeedback,
    useAvatarSelection,
} from './identity-hooks';
import { toast } from '../../lib/toast';
import { getMyPreferences, updatePreference } from '../../lib/api-client';
import { isDiscordLinked, resolveAvatar, toAvatarUser } from '../../lib/avatar';

const mockGetMyPreferences = getMyPreferences as ReturnType<typeof vi.fn>;
const mockUpdatePreference = updatePreference as ReturnType<typeof vi.fn>;
const mockIsDiscordLinked = isDiscordLinked as ReturnType<typeof vi.fn>;
const mockResolveAvatar = resolveAvatar as ReturnType<typeof vi.fn>;
const mockToAvatarUser = toAvatarUser as ReturnType<typeof vi.fn>;
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
// resolveCurrentAvatar (pure function — no hooks)
// ─────────────────────────────────────────────────────────────────────────────

describe('resolveCurrentAvatar', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockToAvatarUser.mockImplementation((u: unknown) => u);
    });

    it('returns optimistic URL when provided', () => {
        const user = { avatar: 'https://cdn.discord.com/avatar.png', discordId: '123' };
        const result = resolveCurrentAvatar(user, [], 'https://optimistic.com/avatar.jpg');
        expect(result).toBe('https://optimistic.com/avatar.jpg');
    });

    it('falls back to resolveAvatar result when optimistic URL is null', () => {
        mockResolveAvatar.mockReturnValueOnce({ url: 'https://resolved.com/avatar.png', type: 'discord' });
        const user = { avatar: 'https://cdn.discord.com/avatar.png', discordId: '123' };
        const result = resolveCurrentAvatar(user, [], null);
        expect(result).toBe('https://resolved.com/avatar.png');
    });

    it('returns /default-avatar.svg when resolveAvatar returns null url and no optimistic', () => {
        mockResolveAvatar.mockReturnValueOnce({ url: null, type: 'initials' });
        const user = { avatar: null, discordId: null };
        const result = resolveCurrentAvatar(user, [], null);
        expect(result).toBe('/default-avatar.svg');
    });

    it('passes characters array to toAvatarUser spread', () => {
        mockResolveAvatar.mockReturnValueOnce({ url: null, type: 'initials' });
        const user = { avatar: null, discordId: null };
        const chars = [{ gameId: 1, name: 'Thrall', avatarUrl: 'https://char.png' }];
        resolveCurrentAvatar(user, chars, null);
        expect(mockToAvatarUser).toHaveBeenCalledWith(
            expect.objectContaining({ characters: chars }),
        );
    });

    it('does not call resolveAvatar when optimistic URL is provided', () => {
        const user = { avatar: null, discordId: null };
        resolveCurrentAvatar(user, [], 'https://optimistic.png');
        expect(mockResolveAvatar).not.toHaveBeenCalled();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// useHasDiscordLinked (thin wrapper around isDiscordLinked)
// ─────────────────────────────────────────────────────────────────────────────

describe('useHasDiscordLinked', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockIsDiscordLinked.mockImplementation((id: string | null) =>
            Boolean(id && !id.startsWith('local:') && !id.startsWith('unlinked:')),
        );
    });

    it('returns true for a real Discord ID', () => {
        const { result } = renderHook(() => useHasDiscordLinked('123456789'));
        expect(result.current).toBe(true);
    });

    it('returns false for null', () => {
        mockIsDiscordLinked.mockReturnValueOnce(false);
        const { result } = renderHook(() => useHasDiscordLinked(null));
        expect(result.current).toBe(false);
    });

    it('returns false for local: prefixed ID', () => {
        mockIsDiscordLinked.mockReturnValueOnce(false);
        const { result } = renderHook(() => useHasDiscordLinked('local:abc'));
        expect(result.current).toBe(false);
    });

    it('returns false for unlinked: prefixed ID', () => {
        mockIsDiscordLinked.mockReturnValueOnce(false);
        const { result } = renderHook(() => useHasDiscordLinked('unlinked:xyz'));
        expect(result.current).toBe(false);
    });

    it('delegates to isDiscordLinked with the given discordId', () => {
        renderHook(() => useHasDiscordLinked('999'));
        expect(mockIsDiscordLinked).toHaveBeenCalledWith('999');
    });
});

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
        // prefs?.autoHeartGames !== false => true when key missing
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
// Both PreferencesPanel and WatchedGamesPanel use useAutoHeart from
// identity-hooks.ts. This ensures a single source-of-truth for the key.
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
        // Verify the cache has been populated under 'user-preferences'
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
        // Override window.location.search by overriding the getter
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
        // Reset location
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

// ─────────────────────────────────────────────────────────────────────────────
// useAvatarSelection
// ─────────────────────────────────────────────────────────────────────────────

describe('useAvatarSelection', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('starts with null optimistic URL', () => {
        const { queryClient, wrapper } = createWrapper();
        const options = [
            { url: 'https://discord.com/avatar.png', label: 'Discord', type: 'discord' as const },
        ];
        const { result } = renderHook(() => useAvatarSelection(options), { wrapper });
        expect(result.current.optimisticUrl).toBeNull();
        queryClient.clear();
    });

    it('sets optimistic URL immediately when valid URL is selected', async () => {
        // Use a never-resolving promise so the optimistic URL remains set during assertion
        mockUpdatePreference.mockReturnValue(new Promise(() => {}));
        const { queryClient, wrapper } = createWrapper();
        const options = [
            { url: 'https://discord.com/avatar.png', label: 'Discord', type: 'discord' as const },
        ];
        const { result } = renderHook(() => useAvatarSelection(options), { wrapper });
        act(() => { result.current.handleAvatarSelect('https://discord.com/avatar.png'); });
        expect(result.current.optimisticUrl).toBe('https://discord.com/avatar.png');
        queryClient.clear();
    });

    it('does nothing when URL is not found in options', () => {
        const { queryClient, wrapper } = createWrapper();
        const options = [
            { url: 'https://discord.com/avatar.png', label: 'Discord', type: 'discord' as const },
        ];
        const { result } = renderHook(() => useAvatarSelection(options), { wrapper });
        act(() => { result.current.handleAvatarSelect('https://unknown.com/other.png'); });
        expect(result.current.optimisticUrl).toBeNull();
        expect(mockUpdatePreference).not.toHaveBeenCalled();
        queryClient.clear();
    });

    it('calls updatePreference with "avatarPreference" key for non-character type', async () => {
        mockUpdatePreference.mockResolvedValue(undefined);
        const { queryClient, wrapper } = createWrapper();
        const options = [
            { url: 'https://discord.com/avatar.png', label: 'Discord', type: 'discord' as const },
        ];
        const { result } = renderHook(() => useAvatarSelection(options), { wrapper });
        act(() => { result.current.handleAvatarSelect('https://discord.com/avatar.png'); });
        await waitFor(() =>
            expect(mockUpdatePreference).toHaveBeenCalledWith('avatarPreference', { type: 'discord' }),
        );
        queryClient.clear();
    });

    it('includes characterName in preference for character type', async () => {
        mockUpdatePreference.mockResolvedValue(undefined);
        const { queryClient, wrapper } = createWrapper();
        const options = [
            {
                url: 'https://char.example.com/avatar.png',
                label: 'Thrall',
                type: 'character' as const,
                characterName: 'Thrall',
            },
        ];
        const { result } = renderHook(() => useAvatarSelection(options), { wrapper });
        act(() => { result.current.handleAvatarSelect('https://char.example.com/avatar.png'); });
        await waitFor(() =>
            expect(mockUpdatePreference).toHaveBeenCalledWith('avatarPreference', {
                type: 'character',
                characterName: 'Thrall',
            }),
        );
        queryClient.clear();
    });

    it('does not include characterName in preference for non-character type', async () => {
        mockUpdatePreference.mockResolvedValue(undefined);
        const { queryClient, wrapper } = createWrapper();
        const options = [
            { url: 'https://custom.example.com/avatar.png', label: 'Custom', type: 'custom' as const },
        ];
        const { result } = renderHook(() => useAvatarSelection(options), { wrapper });
        act(() => { result.current.handleAvatarSelect('https://custom.example.com/avatar.png'); });
        await waitFor(() => expect(mockUpdatePreference).toHaveBeenCalled());
        const [, prefArg] = mockUpdatePreference.mock.calls[0];
        expect(prefArg).not.toHaveProperty('characterName');
        queryClient.clear();
    });

    it('clears optimistic URL after successful update', async () => {
        mockUpdatePreference.mockResolvedValue(undefined);
        const { queryClient, wrapper } = createWrapper();
        const options = [
            { url: 'https://discord.com/avatar.png', label: 'Discord', type: 'discord' as const },
        ];
        const { result } = renderHook(() => useAvatarSelection(options), { wrapper });
        act(() => { result.current.handleAvatarSelect('https://discord.com/avatar.png'); });
        await waitFor(() => expect(result.current.optimisticUrl).toBeNull());
        queryClient.clear();
    });

    it('shows error toast and clears optimistic URL when update fails', async () => {
        mockUpdatePreference.mockRejectedValue(new Error('save failed'));
        const { queryClient, wrapper } = createWrapper();
        const options = [
            { url: 'https://discord.com/avatar.png', label: 'Discord', type: 'discord' as const },
        ];
        const { result } = renderHook(() => useAvatarSelection(options), { wrapper });
        act(() => { result.current.handleAvatarSelect('https://discord.com/avatar.png'); });
        await waitFor(() =>
            expect(mockToast.error).toHaveBeenCalledWith('Failed to save avatar preference'),
        );
        expect(result.current.optimisticUrl).toBeNull();
        queryClient.clear();
    });
});
