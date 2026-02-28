/**
 * Adversarial unit tests for IdentityPanel — ROK-444 auto-heart toggle.
 *
 * Verifies:
 * - Auto-heart toggle is only visible when Discord is connected (AC #2)
 * - Toggle reflects current preference state from query
 * - Toggle calls updatePreference with the correct value
 * - Error toast shown when updatePreference fails
 * - Toggle is hidden when Discord is NOT connected
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { IdentityPanel } from './identity-panel';
import * as useAuthHook from '../../hooks/use-auth';
import * as useCharactersHook from '../../hooks/use-characters';
import * as useAvatarUploadHook from '../../hooks/use-avatar-upload';
import * as useSystemStatusHook from '../../hooks/use-system-status';
import * as apiClient from '../../lib/api-client';
import * as toast from '../../lib/toast';

// ─── Module mocks ────────────────────────────────────────────────────────────

vi.mock('../../lib/toast', () => ({
    toast: {
        success: vi.fn(),
        error: vi.fn(),
    },
}));

vi.mock('../../lib/config', () => ({
    API_BASE_URL: 'http://localhost:3000',
}));

vi.mock('../../lib/avatar', () => ({
    isDiscordLinked: (discordId: string | null | undefined) =>
        Boolean(discordId && !discordId.startsWith('local:') && !discordId.startsWith('unlinked:')),
    buildDiscordAvatarUrl: (_discordId: string | null, _avatar: string | null) => null,
    resolveAvatar: () => ({ url: null, type: 'initials' }),
    toAvatarUser: () => ({ avatar: null, customAvatarUrl: null, characters: [], avatarPreference: null }),
}));

vi.mock('../../lib/api-client', () => ({
    updatePreference: vi.fn(() => Promise.resolve()),
    deleteMyAccount: vi.fn(() => Promise.resolve()),
    getMyPreferences: vi.fn(() => Promise.resolve({ autoHeartGames: true })),
}));

vi.mock('../../components/profile/AvatarSelectorModal', () => ({
    AvatarSelectorModal: () => null,
}));

vi.mock('../../components/ui/role-badge', () => ({
    RoleBadge: () => null,
}));

vi.mock('../../components/ui/modal', () => ({
    Modal: ({ isOpen, children }: { isOpen: boolean; children: React.ReactNode }) =>
        isOpen ? <div data-testid="modal">{children}</div> : null,
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

const discordUser = {
    id: 1,
    username: 'DiscordUser',
    displayName: null,
    discordId: '987654321', // valid Discord ID — not prefixed with 'local:'
    avatar: 'abc123',
    customAvatarUrl: null,
    avatarPreference: null,
    role: 'member' as const,
    onboardingCompletedAt: null,
};

const localUser = {
    ...discordUser,
    discordId: 'local:xyz', // local-only user — no Discord linked
};

function createWrapper(prefsData?: Record<string, unknown>) {
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
    });

    // Pre-populate user-preferences cache if provided
    if (prefsData) {
        queryClient.setQueryData(['user-preferences'], prefsData);
    }

    return ({ children }: { children: React.ReactNode }) => (
        <QueryClientProvider client={queryClient}>
            <MemoryRouter>{children}</MemoryRouter>
        </QueryClientProvider>
    );
}

const mockUpload = vi.fn();
const mockDeleteAvatar = vi.fn();
const mockRefetch = vi.fn();

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('IdentityPanel — auto-heart toggle (ROK-444)', () => {
    beforeEach(() => {
        vi.clearAllMocks();

        vi.spyOn(useAuthHook, 'useAuth').mockReturnValue({
            user: discordUser,
            isAuthenticated: true,
            refetch: mockRefetch,
        } as Parameters<typeof vi.spyOn<typeof useAuthHook, 'useAuth'>>[0][keyof typeof useAuthHook]);

        vi.spyOn(useCharactersHook, 'useMyCharacters').mockReturnValue({
            data: { data: [] },
            isLoading: false,
        } as ReturnType<typeof useCharactersHook.useMyCharacters>);

        vi.spyOn(useAvatarUploadHook, 'useAvatarUpload').mockReturnValue({
            upload: mockUpload,
            deleteAvatar: mockDeleteAvatar,
            isUploading: false,
            uploadProgress: 0,
        } as ReturnType<typeof useAvatarUploadHook.useAvatarUpload>);

        vi.spyOn(useSystemStatusHook, 'useSystemStatus').mockReturnValue({
            data: { isFirstRun: false, discordConfigured: true, blizzardConfigured: false },
            isLoading: false,
        } as ReturnType<typeof useSystemStatusHook.useSystemStatus>);
    });

    // ── Visibility (AC #2) ────────────────────────────────────────────────────

    describe('Visibility — only shown when Discord is connected (AC #2)', () => {
        it('shows the auto-heart toggle section when Discord is linked', () => {
            render(<IdentityPanel />, { wrapper: createWrapper({ autoHeartGames: true }) });
            expect(screen.getByText('Auto-heart games')).toBeInTheDocument();
        });

        it('hides the auto-heart toggle when Discord is NOT connected', () => {
            vi.spyOn(useAuthHook, 'useAuth').mockReturnValue({
                user: localUser,
                isAuthenticated: true,
                refetch: mockRefetch,
            } as Parameters<typeof vi.spyOn<typeof useAuthHook, 'useAuth'>>[0][keyof typeof useAuthHook]);

            render(<IdentityPanel />, { wrapper: createWrapper() });
            expect(screen.queryByText('Auto-heart games')).not.toBeInTheDocument();
        });

        it('auto-heart toggle is a switch role button', () => {
            render(<IdentityPanel />, { wrapper: createWrapper({ autoHeartGames: true }) });
            const toggle = screen.getByRole('switch');
            expect(toggle).toBeInTheDocument();
        });

        it('auto-heart description text is visible', () => {
            render(<IdentityPanel />, { wrapper: createWrapper({ autoHeartGames: true }) });
            expect(
                screen.getByText(/automatically heart games you play for 5\+ hours/i),
            ).toBeInTheDocument();
        });
    });

    // ── Toggle state (AC #2) ─────────────────────────────────────────────────

    describe('Toggle state reflects preference', () => {
        it('toggle is checked (aria-checked=true) when autoHeartGames is true', () => {
            render(<IdentityPanel />, { wrapper: createWrapper({ autoHeartGames: true }) });
            const toggle = screen.getByRole('switch');
            expect(toggle).toHaveAttribute('aria-checked', 'true');
        });

        it('toggle is unchecked (aria-checked=false) when autoHeartGames is false', () => {
            render(<IdentityPanel />, { wrapper: createWrapper({ autoHeartGames: false }) });
            const toggle = screen.getByRole('switch');
            expect(toggle).toHaveAttribute('aria-checked', 'false');
        });

        it('toggle defaults to enabled (true) when preference is not set', () => {
            // No preference data — defaults to true via `prefs?.autoHeartGames !== false`
            render(<IdentityPanel />, { wrapper: createWrapper({}) });
            const toggle = screen.getByRole('switch');
            expect(toggle).toHaveAttribute('aria-checked', 'true');
        });
    });

    // ── Toggle interaction ────────────────────────────────────────────────────

    describe('Toggle interaction', () => {
        it('calls updatePreference with false when toggling off from enabled state', async () => {
            const user = userEvent.setup();
            render(<IdentityPanel />, { wrapper: createWrapper({ autoHeartGames: true }) });

            const toggle = screen.getByRole('switch');
            await user.click(toggle);

            await waitFor(() => {
                expect(apiClient.updatePreference).toHaveBeenCalledWith('autoHeartGames', false);
            });
        });

        it('calls updatePreference with true when toggling on from disabled state', async () => {
            const user = userEvent.setup();
            render(<IdentityPanel />, { wrapper: createWrapper({ autoHeartGames: false }) });

            const toggle = screen.getByRole('switch');
            await user.click(toggle);

            await waitFor(() => {
                expect(apiClient.updatePreference).toHaveBeenCalledWith('autoHeartGames', true);
            });
        });

        it('shows error toast when updatePreference fails', async () => {
            vi.mocked(apiClient.updatePreference).mockRejectedValueOnce(
                new Error('Network error'),
            );

            const user = userEvent.setup();
            render(<IdentityPanel />, { wrapper: createWrapper({ autoHeartGames: true }) });

            const toggle = screen.getByRole('switch');
            await user.click(toggle);

            await waitFor(() => {
                expect((toast.toast as { error: ReturnType<typeof vi.fn> }).error).toHaveBeenCalledWith(
                    'Failed to update auto-heart preference',
                );
            });
        });

        it('toggle is disabled while mutation is pending', async () => {
            // Simulate slow response
            vi.mocked(apiClient.updatePreference).mockImplementationOnce(
                () => new Promise(() => {}), // never resolves
            );

            const user = userEvent.setup();
            render(<IdentityPanel />, { wrapper: createWrapper({ autoHeartGames: true }) });

            const toggle = screen.getByRole('switch');
            await user.click(toggle);

            await waitFor(() => {
                expect(toggle).toBeDisabled();
            });
        });
    });

    // ── No localStorage usage ────────────────────────────────────────────────

    describe('No localStorage usage for auto-heart preference', () => {
        it('does not read autoHeartGames from localStorage', () => {
            const getItemSpy = vi.spyOn(Storage.prototype, 'getItem');

            render(<IdentityPanel />, { wrapper: createWrapper({ autoHeartGames: true }) });

            const autoHeartCalls = getItemSpy.mock.calls.filter(
                ([key]) => key === 'autoHeartGames' || key === 'auto_heart_games',
            );
            expect(autoHeartCalls).toHaveLength(0);
        });
    });
});
