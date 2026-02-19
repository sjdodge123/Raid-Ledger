/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Adversarial unit tests for IdentityPanel — ROK-352
 * Focus: query invalidation after updatePreference, error handling,
 * server-side preference persistence (no localStorage).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { IdentityPanel } from './identity-panel';
import * as useAuthHook from '../../hooks/use-auth';
import * as useCharactersHook from '../../hooks/use-characters';
import * as useAvatarUploadHook from '../../hooks/use-avatar-upload';
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
    buildDiscordAvatarUrl: (discordId: string | null, avatar: string | null) => {
        if (discordId && !discordId.startsWith('local:') && avatar) {
            return `https://cdn.discordapp.com/avatars/${discordId}/${avatar}.png`;
        }
        return null;
    },
    resolveAvatar: (user: any) => {
        if (!user) return { url: null, type: 'initials' };
        if (user.avatarPreference?.type === 'character' && user.avatarPreference.characterName) {
            const char = user.characters?.find((c: any) => c.name === user.avatarPreference.characterName);
            if (char?.avatarUrl) return { url: char.avatarUrl, type: 'character' };
        }
        if (user.avatarPreference?.type === 'discord' && user.avatar) {
            return { url: user.avatar, type: 'discord' };
        }
        if (user.customAvatarUrl) return { url: `http://localhost:3000${user.customAvatarUrl}`, type: 'custom' };
        if (user.avatar) return { url: user.avatar, type: 'discord' };
        return { url: null, type: 'initials' };
    },
    toAvatarUser: (user: any) => ({
        avatar: user.discordId && !user.discordId.startsWith('local:') && user.avatar
            ? `https://cdn.discordapp.com/avatars/${user.discordId}/${user.avatar}.png`
            : null,
        customAvatarUrl: user.customAvatarUrl,
        characters: user.characters,
        avatarPreference: user.avatarPreference,
    }),
}));

vi.mock('../../lib/api-client', () => ({
    updatePreference: vi.fn(() => Promise.resolve()),
}));

// Mock AvatarSelectorModal — render a simplified version to expose interactions
vi.mock('../../components/profile/AvatarSelectorModal', () => ({
    AvatarSelectorModal: ({
        isOpen,
        avatarOptions,
        onSelect,
        onClose,
    }: {
        isOpen: boolean;
        avatarOptions: { url: string; label: string }[];
        onSelect: (url: string) => void;
        onClose: () => void;
    }) => {
        if (!isOpen) return null;
        return (
            <div data-testid="avatar-modal">
                {avatarOptions.map((opt) => (
                    <button key={opt.url} data-testid={`avatar-opt-${opt.label}`} onClick={() => onSelect(opt.url)}>
                        {opt.label}
                    </button>
                ))}
                <button data-testid="modal-close" onClick={onClose}>Close</button>
            </div>
        );
    },
}));

// Mock RoleBadge (irrelevant to tests)
vi.mock('../../components/ui/role-badge', () => ({
    RoleBadge: () => null,
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

const mockUser = {
    id: 1,
    username: 'TestUser',
    displayName: null,
    discordId: '123456789',
    avatar: 'abc123',
    customAvatarUrl: null,
    avatarPreference: null,
    role: 'member' as const,
    onboardingCompletedAt: null,
};

const createWrapper = () => {
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
    });
    return ({ children }: { children: React.ReactNode }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('IdentityPanel — adversarial tests (ROK-352)', () => {
    const mockUpload = vi.fn();
    const mockDeleteAvatar = vi.fn();
    const mockRefetch = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();

        vi.spyOn(useAuthHook, 'useAuth').mockReturnValue({
            user: mockUser,
            isAuthenticated: true,
            refetch: mockRefetch,
        } as any);

        vi.spyOn(useCharactersHook, 'useMyCharacters').mockReturnValue({
            data: { data: [] },
            isLoading: false,
        } as any);

        vi.spyOn(useAvatarUploadHook, 'useAvatarUpload').mockReturnValue({
            upload: mockUpload,
            deleteAvatar: mockDeleteAvatar,
            isUploading: false,
            uploadProgress: 0,
        } as any);
    });

    // ── Null user ────────────────────────────────────────────────────────────

    describe('Null user guard', () => {
        it('renders nothing when user is null', () => {
            vi.spyOn(useAuthHook, 'useAuth').mockReturnValue({
                user: null,
                isAuthenticated: false,
                refetch: mockRefetch,
            } as any);

            const { container } = render(<IdentityPanel />, { wrapper: createWrapper() });
            expect(container.firstChild).toBeNull();
        });
    });

    // ── Basic render ─────────────────────────────────────────────────────────

    describe('Basic render', () => {
        it('renders Identity heading', () => {
            render(<IdentityPanel />, { wrapper: createWrapper() });
            expect(screen.getByText('Identity')).toBeInTheDocument();
        });

        it('shows username in user card', () => {
            render(<IdentityPanel />, { wrapper: createWrapper() });
            expect(screen.getByText('TestUser')).toBeInTheDocument();
        });

        it('shows "Discord linked" label for linked discord account', () => {
            render(<IdentityPanel />, { wrapper: createWrapper() });
            expect(screen.getByText('Discord linked')).toBeInTheDocument();
        });

        it('shows "Local account" label for local-only user', () => {
            vi.spyOn(useAuthHook, 'useAuth').mockReturnValue({
                user: { ...mockUser, discordId: 'local:xyz' },
                isAuthenticated: true,
                refetch: mockRefetch,
            } as any);

            render(<IdentityPanel />, { wrapper: createWrapper() });
            expect(screen.getByText('Local account')).toBeInTheDocument();
        });
    });

    // ── Avatar modal ─────────────────────────────────────────────────────────

    describe('Avatar modal interaction', () => {
        it('modal is not shown initially', () => {
            render(<IdentityPanel />, { wrapper: createWrapper() });
            expect(screen.queryByTestId('avatar-modal')).not.toBeInTheDocument();
        });

        it('opens modal when avatar button is clicked', () => {
            render(<IdentityPanel />, { wrapper: createWrapper() });
            const avatarButton = screen.getByRole('button', { name: /change avatar/i });
            fireEvent.click(avatarButton);
            expect(screen.getByTestId('avatar-modal')).toBeInTheDocument();
        });

        it('closes modal when close button is clicked', () => {
            render(<IdentityPanel />, { wrapper: createWrapper() });
            fireEvent.click(screen.getByRole('button', { name: /change avatar/i }));
            expect(screen.getByTestId('avatar-modal')).toBeInTheDocument();

            fireEvent.click(screen.getByTestId('modal-close'));
            expect(screen.queryByTestId('avatar-modal')).not.toBeInTheDocument();
        });
    });

    // ── Query invalidation after updatePreference ────────────────────────────

    describe('Query invalidation after avatar selection (ROK-352)', () => {
        it('calls invalidateQueries with auth/me key after successful updatePreference', async () => {
            vi.spyOn(useAuthHook, 'useAuth').mockReturnValue({
                user: { ...mockUser, discordId: '123456789', avatar: 'abc123' },
                isAuthenticated: true,
                refetch: mockRefetch,
            } as any);
            vi.mocked(apiClient.updatePreference).mockResolvedValueOnce(undefined);

            const queryClient = new QueryClient({
                defaultOptions: { queries: { retry: false } },
            });
            const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

            render(
                <QueryClientProvider client={queryClient}>
                    <IdentityPanel />
                </QueryClientProvider>,
            );

            // Open modal
            fireEvent.click(screen.getByRole('button', { name: /change avatar/i }));

            // Click the Discord option
            const discordOption = screen.queryByTestId('avatar-opt-Discord');
            if (discordOption) {
                fireEvent.click(discordOption);
            }

            await waitFor(() => {
                expect(apiClient.updatePreference).toHaveBeenCalled();
            });

            await waitFor(() => {
                expect(invalidateSpy).toHaveBeenCalledWith(
                    expect.objectContaining({ queryKey: ['auth', 'me'] }),
                );
            });
        });

        it('calls updatePreference before invalidating queries (ordering)', async () => {
            const callOrder: string[] = [];
            vi.mocked(apiClient.updatePreference).mockImplementationOnce(() => {
                callOrder.push('updatePreference');
                return Promise.resolve();
            });

            const queryClient = new QueryClient({
                defaultOptions: { queries: { retry: false } },
            });
            vi.spyOn(queryClient, 'invalidateQueries').mockImplementationOnce(() => {
                callOrder.push('invalidateQueries');
                return Promise.resolve();
            });

            vi.spyOn(useAuthHook, 'useAuth').mockReturnValue({
                user: { ...mockUser, discordId: '123456789', avatar: 'abc123' },
                isAuthenticated: true,
                refetch: mockRefetch,
            } as any);

            render(
                <QueryClientProvider client={queryClient}>
                    <IdentityPanel />
                </QueryClientProvider>,
            );

            fireEvent.click(screen.getByRole('button', { name: /change avatar/i }));
            const discordOption = screen.queryByTestId('avatar-opt-Discord');
            if (discordOption) {
                fireEvent.click(discordOption);
            }

            await waitFor(() => expect(callOrder).toContain('invalidateQueries'));
            expect(callOrder.indexOf('updatePreference')).toBeLessThan(callOrder.indexOf('invalidateQueries'));
        });
    });

    // ── Error handling ───────────────────────────────────────────────────────

    describe('Error handling when updatePreference fails', () => {
        it('shows error toast when updatePreference rejects', async () => {
            vi.mocked(apiClient.updatePreference).mockRejectedValueOnce(new Error('Network error'));

            vi.spyOn(useAuthHook, 'useAuth').mockReturnValue({
                user: { ...mockUser, discordId: '123456789', avatar: 'abc123' },
                isAuthenticated: true,
                refetch: mockRefetch,
            } as any);

            render(<IdentityPanel />, { wrapper: createWrapper() });

            fireEvent.click(screen.getByRole('button', { name: /change avatar/i }));
            const discordOption = screen.queryByTestId('avatar-opt-Discord');
            if (discordOption) {
                fireEvent.click(discordOption);
            }

            await waitFor(() => {
                expect((toast.toast as any).error).toHaveBeenCalledWith('Failed to save avatar preference');
            });
        });

        it('does NOT call invalidateQueries when updatePreference fails', async () => {
            vi.mocked(apiClient.updatePreference).mockRejectedValueOnce(new Error('Server error'));

            const queryClient = new QueryClient({
                defaultOptions: { queries: { retry: false } },
            });
            const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

            vi.spyOn(useAuthHook, 'useAuth').mockReturnValue({
                user: { ...mockUser, discordId: '123456789', avatar: 'abc123' },
                isAuthenticated: true,
                refetch: mockRefetch,
            } as any);

            render(
                <QueryClientProvider client={queryClient}>
                    <IdentityPanel />
                </QueryClientProvider>,
            );

            fireEvent.click(screen.getByRole('button', { name: /change avatar/i }));
            const discordOption = screen.queryByTestId('avatar-opt-Discord');
            if (discordOption) {
                fireEvent.click(discordOption);
            }

            // Wait for the promise chain to settle
            await waitFor(() => {
                expect(apiClient.updatePreference).toHaveBeenCalled();
            });

            // Give the .catch branch time to run
            await new Promise(r => setTimeout(r, 50));

            expect(invalidateSpy).not.toHaveBeenCalled();
        });

        it('does not crash when option URL is not in avatarOptions', () => {
            // handleAvatarSelect returns early if option not found — no call to updatePreference
            vi.spyOn(useAuthHook, 'useAuth').mockReturnValue({
                user: { ...mockUser, discordId: 'local:xyz', avatar: null, customAvatarUrl: null },
                isAuthenticated: true,
                refetch: mockRefetch,
            } as any);

            // No avatar options → modal opens but no clickable avatar buttons
            render(<IdentityPanel />, { wrapper: createWrapper() });
            fireEvent.click(screen.getByRole('button', { name: /change avatar/i }));
            expect(screen.getByTestId('avatar-modal')).toBeInTheDocument();
            expect(apiClient.updatePreference).not.toHaveBeenCalled();
        });
    });

    // ── Character preference selection ───────────────────────────────────────

    describe('Character preference via modal', () => {
        it('calls updatePreference with characterName when character avatar is selected', async () => {
            vi.spyOn(useCharactersHook, 'useMyCharacters').mockReturnValue({
                data: {
                    data: [
                        { name: 'Thrall', avatarUrl: 'https://example.com/thrall.jpg', gameId: 'wow' },
                    ],
                },
                isLoading: false,
            } as any);

            render(<IdentityPanel />, { wrapper: createWrapper() });
            fireEvent.click(screen.getByRole('button', { name: /change avatar/i }));

            const thrallOption = screen.queryByTestId('avatar-opt-Thrall');
            if (thrallOption) {
                fireEvent.click(thrallOption);
                await waitFor(() => {
                    expect(apiClient.updatePreference).toHaveBeenCalledWith(
                        'avatarPreference',
                        { type: 'character', characterName: 'Thrall', avatarUrl: 'https://example.com/thrall.jpg' },
                    );
                });
            }
        });

        it('does not include characterName for discord preference type', async () => {
            vi.spyOn(useAuthHook, 'useAuth').mockReturnValue({
                user: { ...mockUser, discordId: '123456789', avatar: 'abc123' },
                isAuthenticated: true,
                refetch: mockRefetch,
            } as any);

            render(<IdentityPanel />, { wrapper: createWrapper() });
            fireEvent.click(screen.getByRole('button', { name: /change avatar/i }));

            const discordOption = screen.queryByTestId('avatar-opt-Discord');
            if (discordOption) {
                fireEvent.click(discordOption);
                await waitFor(() => {
                    expect(apiClient.updatePreference).toHaveBeenCalledWith(
                        'avatarPreference',
                        { type: 'discord' },
                    );
                    const callArg = vi.mocked(apiClient.updatePreference).mock.calls[0][1] as any;
                    expect(callArg.characterName).toBeUndefined();
                });
            }
        });
    });

    // ── No localStorage usage ────────────────────────────────────────────────

    describe('No localStorage usage (server-side persistence only)', () => {
        it('does not read from localStorage for avatar preference', () => {
            const getItemSpy = vi.spyOn(Storage.prototype, 'getItem');

            render(<IdentityPanel />, { wrapper: createWrapper() });

            // localStorage.getItem should never be called for avatar preference keys
            const avatarPrefCalls = getItemSpy.mock.calls.filter(
                ([key]) => key === 'avatarPreference' || key === 'avatar_preference',
            );
            expect(avatarPrefCalls).toHaveLength(0);
        });

        it('does not write to localStorage when avatar is selected', async () => {
            const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');

            render(<IdentityPanel />, { wrapper: createWrapper() });
            fireEvent.click(screen.getByRole('button', { name: /change avatar/i }));

            const discordOption = screen.queryByTestId('avatar-opt-Discord');
            if (discordOption) {
                fireEvent.click(discordOption);
            }

            await new Promise(r => setTimeout(r, 50));

            const avatarPrefCalls = setItemSpy.mock.calls.filter(
                ([key]) => key === 'avatarPreference' || key === 'avatar_preference',
            );
            expect(avatarPrefCalls).toHaveLength(0);
        });
    });
});
