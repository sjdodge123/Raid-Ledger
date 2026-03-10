/**
 * Adversarial unit tests for IdentityPanel Steam integration (ROK-745).
 * Focus: steamConfigured gating, useSteamRedirectFeedback hook behavior.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { IdentityPanel } from './identity-panel';
import * as useAuthHook from '../../hooks/use-auth';
import * as useCharactersHook from '../../hooks/use-characters';
import * as useAvatarUploadHook from '../../hooks/use-avatar-upload';
import * as useSystemStatusHook from '../../hooks/use-system-status';
import * as useSteamLinkHook from '../../hooks/use-steam-link';
import * as toast from '../../lib/toast';

// ── Module mocks ────────────────────────────────────────────────────────────

vi.mock('../../lib/toast', () => ({
    toast: {
        success: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
    },
}));

vi.mock('../../lib/config', () => ({
    API_BASE_URL: 'http://localhost:3000',
}));

vi.mock('../../lib/avatar', () => ({
    isDiscordLinked: (discordId: string | null | undefined) =>
        Boolean(discordId && !discordId.startsWith('local:')),
    buildDiscordAvatarUrl: () => null,
    resolveAvatar: () => ({ url: null, type: 'initials' }),
    toAvatarUser: (user: Record<string, unknown>) => ({
        avatar: null,
        customAvatarUrl: user.customAvatarUrl,
        characters: user.characters,
        avatarPreference: user.avatarPreference,
    }),
}));

vi.mock('../../lib/api-client', () => ({
    updatePreference: vi.fn(() => Promise.resolve()),
    deleteMyAccount: vi.fn(() => Promise.resolve()),
    getMyPreferences: vi.fn(() => Promise.resolve({ autoHeartGames: true })),
}));

vi.mock('../../components/profile/AvatarSelectorModal', () => ({
    AvatarSelectorModal: ({ isOpen }: { isOpen: boolean }) =>
        isOpen ? <div data-testid="avatar-modal" /> : null,
}));

vi.mock('../../components/ui/role-badge', () => ({
    RoleBadge: () => null,
}));

vi.mock('../../components/ui/modal', () => ({
    Modal: ({ isOpen, children }: { isOpen: boolean; children: React.ReactNode }) =>
        isOpen ? <div data-testid="modal">{children}</div> : null,
}));

// ── Helpers ─────────────────────────────────────────────────────────────────

const mockUser = {
    id: 1,
    username: 'TestUser',
    displayName: null,
    discordId: 'local:xyz',
    avatar: null,
    customAvatarUrl: null,
    avatarPreference: null,
    role: 'member' as const,
    onboardingCompletedAt: null,
};

const mockRefetch = vi.fn();
const mockLinkSteam = vi.fn();
const mockUnlinkSteam = { mutate: vi.fn(), isPending: false };
const mockSyncLibrary = { mutate: vi.fn(), isPending: false };
const mockSyncWishlist = { mutate: vi.fn(), isPending: false };

function createWrapper() {
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
    });
    return ({ children }: { children: React.ReactNode }) => (
        <QueryClientProvider client={queryClient}>
            <MemoryRouter>{children}</MemoryRouter>
        </QueryClientProvider>
    );
}

function setupDefaultMocks(overrides?: {
    steamConfigured?: boolean;
    discordConfigured?: boolean;
}) {
    vi.spyOn(useAuthHook, 'useAuth').mockReturnValue({
        user: mockUser,
        isAuthenticated: true,
        refetch: mockRefetch,
    } as unknown as ReturnType<typeof useAuthHook.useAuth>);

    vi.spyOn(useCharactersHook, 'useMyCharacters').mockReturnValue({
        data: { data: [] },
        isLoading: false,
    } as unknown as ReturnType<typeof useCharactersHook.useMyCharacters>);

    vi.spyOn(useAvatarUploadHook, 'useAvatarUpload').mockReturnValue({
        upload: vi.fn(),
        deleteAvatar: vi.fn(),
        isUploading: false,
        uploadProgress: 0,
    } as unknown as ReturnType<typeof useAvatarUploadHook.useAvatarUpload>);

    vi.spyOn(useSystemStatusHook, 'useSystemStatus').mockReturnValue({
        data: {
            isFirstRun: false,
            discordConfigured: overrides?.discordConfigured ?? false,
            blizzardConfigured: false,
            steamConfigured: overrides?.steamConfigured ?? false,
        },
        isLoading: false,
    } as unknown as ReturnType<typeof useSystemStatusHook.useSystemStatus>);

    vi.spyOn(useSteamLinkHook, 'useSteamLink').mockReturnValue({
        linkSteam: mockLinkSteam,
        steamStatus: { data: undefined, isLoading: false },
        unlinkSteam: mockUnlinkSteam,
        syncLibrary: mockSyncLibrary,
        syncWishlist: mockSyncWishlist,
    } as unknown as ReturnType<typeof useSteamLinkHook.useSteamLink>);
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('IdentityPanel — Steam config gating (ROK-745)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('hides Steam section when steamConfigured is false', () => {
        setupDefaultMocks({ steamConfigured: false });
        render(<IdentityPanel />, { wrapper: createWrapper() });
        expect(screen.queryByText('Link Steam Account')).not.toBeInTheDocument();
    });

    it('shows Steam section when steamConfigured is true', () => {
        setupDefaultMocks({ steamConfigured: true });
        render(<IdentityPanel />, { wrapper: createWrapper() });
        expect(screen.getByText('Link Steam Account')).toBeInTheDocument();
    });

    it('hides Steam section when systemStatus is undefined', () => {
        setupDefaultMocks({ steamConfigured: false });
        vi.spyOn(useSystemStatusHook, 'useSystemStatus').mockReturnValue({
            data: undefined,
            isLoading: true,
        } as unknown as ReturnType<typeof useSystemStatusHook.useSystemStatus>);
        render(<IdentityPanel />, { wrapper: createWrapper() });
        expect(screen.queryByText('Link Steam Account')).not.toBeInTheDocument();
    });

    it('shows linked Steam persona when status indicates linked', () => {
        setupDefaultMocks({ steamConfigured: true });
        vi.spyOn(useSteamLinkHook, 'useSteamLink').mockReturnValue({
            linkSteam: mockLinkSteam,
            steamStatus: {
                data: { linked: true, personaName: 'GamerDude', isPublic: true },
                isLoading: false,
            },
            unlinkSteam: mockUnlinkSteam,
            syncLibrary: mockSyncLibrary,
            syncWishlist: mockSyncWishlist,
        } as unknown as ReturnType<typeof useSteamLinkHook.useSteamLink>);

        render(<IdentityPanel />, { wrapper: createWrapper() });
        expect(screen.getByText('GamerDude')).toBeInTheDocument();
        expect(screen.getByText('Linked')).toBeInTheDocument();
    });

    it('shows unlink and sync buttons for linked Steam account', () => {
        setupDefaultMocks({ steamConfigured: true });
        vi.spyOn(useSteamLinkHook, 'useSteamLink').mockReturnValue({
            linkSteam: mockLinkSteam,
            steamStatus: {
                data: { linked: true, personaName: 'GamerDude', isPublic: true },
                isLoading: false,
            },
            unlinkSteam: mockUnlinkSteam,
            syncLibrary: mockSyncLibrary,
            syncWishlist: mockSyncWishlist,
        } as unknown as ReturnType<typeof useSteamLinkHook.useSteamLink>);

        render(<IdentityPanel />, { wrapper: createWrapper() });
        expect(screen.getByText('Sync Library')).toBeInTheDocument();
        expect(screen.getByText('Unlink')).toBeInTheDocument();
    });

    it('shows privacy warning when Steam profile is private', () => {
        setupDefaultMocks({ steamConfigured: true });
        vi.spyOn(useSteamLinkHook, 'useSteamLink').mockReturnValue({
            linkSteam: mockLinkSteam,
            steamStatus: {
                data: { linked: true, personaName: 'PrivateUser', isPublic: false },
                isLoading: false,
            },
            unlinkSteam: mockUnlinkSteam,
            syncLibrary: mockSyncLibrary,
            syncWishlist: mockSyncWishlist,
        } as unknown as ReturnType<typeof useSteamLinkHook.useSteamLink>);

        render(<IdentityPanel />, { wrapper: createWrapper() });
        expect(screen.getByText(/profile is private/i)).toBeInTheDocument();
    });

    it('does not show privacy warning when Steam profile is public', () => {
        setupDefaultMocks({ steamConfigured: true });
        vi.spyOn(useSteamLinkHook, 'useSteamLink').mockReturnValue({
            linkSteam: mockLinkSteam,
            steamStatus: {
                data: { linked: true, personaName: 'PublicUser', isPublic: true },
                isLoading: false,
            },
            unlinkSteam: mockUnlinkSteam,
            syncLibrary: mockSyncLibrary,
            syncWishlist: mockSyncWishlist,
        } as unknown as ReturnType<typeof useSteamLinkHook.useSteamLink>);

        render(<IdentityPanel />, { wrapper: createWrapper() });
        expect(screen.queryByText(/profile is private/i)).not.toBeInTheDocument();
    });
});

describe('useSteamRedirectFeedback (ROK-745)', () => {
    let originalLocation: Location;
    let replaceStateSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        vi.clearAllMocks();
        originalLocation = window.location;
        replaceStateSpy = vi.spyOn(window.history, 'replaceState');
    });

    afterEach(() => {
        // Restore location by setting search back to empty
        Object.defineProperty(window, 'location', {
            value: originalLocation,
            writable: true,
        });
    });

    function setSearchParams(search: string) {
        Object.defineProperty(window, 'location', {
            value: { ...originalLocation, search, pathname: '/profile/identity' },
            writable: true,
        });
    }

    it('shows error toast for ?steam=error', () => {
        setSearchParams('?steam=error');
        setupDefaultMocks({ steamConfigured: true });

        render(<IdentityPanel />, { wrapper: createWrapper() });

        expect(vi.mocked(toast.toast.error)).toHaveBeenCalledWith(
            'Steam linking failed',
        );
    });

    it('shows custom error message from ?steam=error&message=Custom+error', () => {
        setSearchParams('?steam=error&message=Custom+error');
        setupDefaultMocks({ steamConfigured: true });

        render(<IdentityPanel />, { wrapper: createWrapper() });

        expect(vi.mocked(toast.toast.error)).toHaveBeenCalledWith('Custom error');
    });

    it('shows success toast for ?steam=success', () => {
        setSearchParams('?steam=success');
        setupDefaultMocks({ steamConfigured: true });

        render(<IdentityPanel />, { wrapper: createWrapper() });

        expect(vi.mocked(toast.toast.success)).toHaveBeenCalledWith(
            'Steam account linked successfully!',
        );
    });

    it('shows info toast for private profile on ?steam=success&steam_private=true', () => {
        setSearchParams('?steam=success&steam_private=true');
        setupDefaultMocks({ steamConfigured: true });

        render(<IdentityPanel />, { wrapper: createWrapper() });

        expect(vi.mocked(toast.toast.success)).toHaveBeenCalledWith(
            'Steam account linked successfully!',
        );
        expect(vi.mocked(toast.toast.info)).toHaveBeenCalledWith(
            'Set your Steam profile to public so we can sync your game library.',
        );
    });

    it('cleans URL after processing steam param', () => {
        setSearchParams('?steam=success');
        setupDefaultMocks({ steamConfigured: true });

        render(<IdentityPanel />, { wrapper: createWrapper() });

        expect(replaceStateSpy).toHaveBeenCalledWith(
            {},
            '',
            '/profile/identity',
        );
    });

    it('does not show toast or clean URL when no steam param present', () => {
        setSearchParams('');
        setupDefaultMocks({ steamConfigured: true });

        render(<IdentityPanel />, { wrapper: createWrapper() });

        expect(vi.mocked(toast.toast.error)).not.toHaveBeenCalled();
        expect(vi.mocked(toast.toast.success)).not.toHaveBeenCalled();
        expect(replaceStateSpy).not.toHaveBeenCalled();
    });

    it('does not show info toast when steam_private is absent on success', () => {
        setSearchParams('?steam=success');
        setupDefaultMocks({ steamConfigured: true });

        render(<IdentityPanel />, { wrapper: createWrapper() });

        expect(vi.mocked(toast.toast.info)).not.toHaveBeenCalled();
    });

    it('cleans URL for steam=error as well', () => {
        setSearchParams('?steam=error');
        setupDefaultMocks({ steamConfigured: true });

        render(<IdentityPanel />, { wrapper: createWrapper() });

        expect(replaceStateSpy).toHaveBeenCalledWith(
            {},
            '',
            '/profile/identity',
        );
    });
});
