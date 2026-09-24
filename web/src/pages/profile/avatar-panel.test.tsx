import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AvatarPanel } from './avatar-panel';
import * as useAuthHook from '../../hooks/use-auth';
import * as useCharactersHook from '../../hooks/use-characters';
import * as useAvatarUploadHook from '../../hooks/use-avatar-upload';
import * as apiClient from '../../lib/api-client';

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
    resolveAvatar: (user: Record<string, unknown> | null) => {
        if (!user) return { url: null, type: 'initials' };
        if (user.customAvatarUrl) return { url: `http://localhost:3000${user.customAvatarUrl}`, type: 'custom' };
        if (user.avatar) return { url: user.avatar, type: 'discord' };
        return { url: null, type: 'initials' };
    },
    toAvatarUser: (user: Record<string, unknown>) => ({
        avatar: user.discordId && !user.discordId.startsWith('local:') && user.avatar
            ? `https://cdn.discordapp.com/avatars/${user.discordId}/${user.avatar}.png`
            : null,
        customAvatarUrl: user.customAvatarUrl,
        characters: user.characters,
        avatarPreference: user.avatarPreference,
    }),
    getCurrentUserAvatarData: vi.fn(() => null),
    setCurrentUserAvatarData: vi.fn(),
}));

vi.mock('../../lib/api-client', () => ({
    updatePreference: vi.fn(() => Promise.resolve()),
}));

const mockUser = {
    id: 1,
    username: 'TestUser',
    discordId: '123456789',
    avatar: 'abc123',
    customAvatarUrl: null,
    avatarPreference: null,
};

const createWrapper = () => {
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
    });
    return ({ children }: { children: React.ReactNode }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
};

describe('AvatarPanel', () => {
    const mockUpload = vi.fn();
    const mockUploadAsync = vi.fn(() => Promise.resolve({ customAvatarUrl: '/custom/new.png' }));
    const mockDeleteAvatar = vi.fn();
    const mockRefetch = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();

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
            upload: mockUpload,
            uploadAsync: mockUploadAsync,
            deleteAvatar: mockDeleteAvatar,
            isUploading: false,
            uploadProgress: 0,
        } as unknown as ReturnType<typeof useAvatarUploadHook.useAvatarUpload>);
    });

    describe('Renders null when no user', () => {
        it('renders nothing when user is null', () => {
            vi.spyOn(useAuthHook, 'useAuth').mockReturnValue({
                user: null,
                isAuthenticated: false,
                refetch: mockRefetch,
            } as unknown as ReturnType<typeof useAuthHook.useAuth>);

            const { container } = render(<AvatarPanel />, { wrapper: createWrapper() });
            expect(container.firstChild).toBeNull();
        });
    });

    describe('Section header', () => {
        it('renders Avatar heading', () => {
            render(<AvatarPanel />, { wrapper: createWrapper() });
            expect(screen.getByText('Avatar')).toBeInTheDocument();
        });

        it('renders subtitle text', () => {
            render(<AvatarPanel />, { wrapper: createWrapper() });
            expect(screen.getByText('Choose or upload your profile picture')).toBeInTheDocument();
        });
    });

    function avatarOptionsDisplayGroup1() {
it('does not render avatar grid when no options are available', () => {
            // User with no discord, no custom avatar, no characters
            const user = {
                id: 1,
                username: 'LocalUser',
                discordId: 'local:xyz',
                avatar: null,
                customAvatarUrl: null,
                avatarPreference: null,
            };
            vi.spyOn(useAuthHook, 'useAuth').mockReturnValue({
                user,
                isAuthenticated: true,
                refetch: mockRefetch,
            } as unknown as ReturnType<typeof useAuthHook.useAuth>);

            render(<AvatarPanel />, { wrapper: createWrapper() });
            expect(screen.queryByText('Available Avatars')).not.toBeInTheDocument();
        });

    }

    function avatarOptionsDisplayGroup2() {
it('renders Available Avatars section when options exist', () => {
            const user = {
                ...mockUser,
                customAvatarUrl: '/custom/avatar.jpg',
            };
            vi.spyOn(useAuthHook, 'useAuth').mockReturnValue({
                user,
                isAuthenticated: true,
                refetch: mockRefetch,
            } as unknown as ReturnType<typeof useAuthHook.useAuth>);

            render(<AvatarPanel />, { wrapper: createWrapper() });
            expect(screen.getByText('Available Avatars')).toBeInTheDocument();
        });

    }

    function avatarOptionsDisplayGroup3() {
it('renders Custom label when user has customAvatarUrl', () => {
            const user = {
                ...mockUser,
                customAvatarUrl: '/custom/avatar.jpg',
            };
            vi.spyOn(useAuthHook, 'useAuth').mockReturnValue({
                user,
                isAuthenticated: true,
                refetch: mockRefetch,
            } as unknown as ReturnType<typeof useAuthHook.useAuth>);

            render(<AvatarPanel />, { wrapper: createWrapper() });
            expect(screen.getByText('Custom')).toBeInTheDocument();
        });

it('renders Discord label for linked discord account', () => {
            render(<AvatarPanel />, { wrapper: createWrapper() });
            // User has discordId '123456789' and avatar 'abc123' -> Discord option
            expect(screen.getByText('Discord')).toBeInTheDocument();
        });

    }

    function avatarOptionsDisplayGroup4() {
it('renders character avatar options when characters have avatarUrl', () => {
            vi.spyOn(useCharactersHook, 'useMyCharacters').mockReturnValue({
                data: {
                    data: [
                        { name: 'Thrall', avatarUrl: 'https://example.com/thrall.jpg' },
                        { name: 'Jaina', avatarUrl: null },
                    ],
                },
                isLoading: false,
            } as unknown as ReturnType<typeof useCharactersHook.useMyCharacters>);

            render(<AvatarPanel />, { wrapper: createWrapper() });
            expect(screen.getByText('Thrall')).toBeInTheDocument();
            // Jaina has no avatarUrl so should not appear
            expect(screen.queryByText('Jaina')).not.toBeInTheDocument();
        });

    }

    describe('Avatar options display', () => {
        avatarOptionsDisplayGroup1();
        avatarOptionsDisplayGroup2();
        avatarOptionsDisplayGroup3();
        avatarOptionsDisplayGroup4();
    });

    function avatarSelectionROK352Group1() {
it('calls updatePreference when a thumbnail is clicked', () => {
            const user = {
                ...mockUser,
                customAvatarUrl: '/custom/avatar.jpg',
            };
            vi.spyOn(useAuthHook, 'useAuth').mockReturnValue({
                user,
                isAuthenticated: true,
                refetch: mockRefetch,
            } as unknown as ReturnType<typeof useAuthHook.useAuth>);

            render(<AvatarPanel />, { wrapper: createWrapper() });

            // The Discord tile is a Button named by its option label.
            fireEvent.click(screen.getByRole('button', { name: 'Discord' }));
            expect(apiClient.updatePreference).toHaveBeenCalledWith(
                'avatarPreference',
                { type: 'discord' },
            );
        });

it('marks only the current avatar tile aria-pressed, and the mark follows a selection', () => {
            vi.spyOn(useAuthHook, 'useAuth').mockReturnValue({
                user: { ...mockUser, customAvatarUrl: '/custom/avatar.jpg' },
                isAuthenticated: true,
                refetch: mockRefetch,
            } as unknown as ReturnType<typeof useAuthHook.useAuth>);
            render(<AvatarPanel />, { wrapper: createWrapper() });
            const custom = screen.queryByRole('button', { name: 'Custom' });
            const discord = screen.queryByRole('button', { name: 'Discord' });
            expect(custom, 'the Custom tile should be a Button named "Custom"').not.toBeNull();
            expect(custom?.getAttribute('aria-pressed'), 'the current (custom) tile should be aria-pressed').toBe('true');
            expect(discord?.getAttribute('aria-pressed'), 'a non-current tile should be aria-pressed=false').toBe('false');
            fireEvent.click(discord as HTMLElement);
            expect(discord?.getAttribute('aria-pressed'), 'the picked tile should become pressed').toBe('true');
            expect(custom?.getAttribute('aria-pressed')).toBe('false');
        });

    }

    function avatarSelectionROK352Group2() {
it('calls updatePreference with characterName for character avatar', () => {
            vi.spyOn(useCharactersHook, 'useMyCharacters').mockReturnValue({
                data: {
                    data: [
                        { name: 'Thrall', avatarUrl: 'https://example.com/thrall.jpg' },
                    ],
                },
                isLoading: false,
            } as unknown as ReturnType<typeof useCharactersHook.useMyCharacters>);

            render(<AvatarPanel />, { wrapper: createWrapper() });

            fireEvent.click(screen.getByRole('button', { name: 'Thrall' }));
            expect(apiClient.updatePreference).toHaveBeenCalledWith(
                'avatarPreference',
                { type: 'character', characterName: 'Thrall' },
            );
        });

    }

    describe('Avatar selection (ROK-352)', () => {
        avatarSelectionROK352Group1();
        avatarSelectionROK352Group2();
    });

    function uploadCustomButtonGroup1() {
it('renders Upload Custom button', () => {
            const { container } = render(<AvatarPanel />, { wrapper: createWrapper() });
            expect(screen.getByText('Upload Custom')).toBeInTheDocument();
            expect(screen.queryByRole('button', { name: 'Upload Custom' }),
                'Upload Custom should be the FilePicker trigger Button').not.toBeNull();
            expect(container.querySelector('input[type="file"]'))
                .toHaveAttribute('accept', 'image/png,image/jpeg,image/webp,image/gif');
        });

it('uploads the picked file through uploadAsync', async () => {
            const { container } = render(<AvatarPanel />, { wrapper: createWrapper() });
            const file = new File(['x'], 'me.png', { type: 'image/png' });
            fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, { target: { files: [file] } });
            await vi.waitFor(() => expect(mockUploadAsync).toHaveBeenCalledWith(file));
        });

it('shows uploading progress text when isUploading is true', () => {
            vi.spyOn(useAvatarUploadHook, 'useAvatarUpload').mockReturnValue({
                upload: mockUpload,
                deleteAvatar: mockDeleteAvatar,
                isUploading: true,
                uploadProgress: 42,
            } as unknown as ReturnType<typeof useAvatarUploadHook.useAvatarUpload>);

            render(<AvatarPanel />, { wrapper: createWrapper() });
            expect(screen.getByText('Uploading 42%')).toBeInTheDocument();
            // Ruling 7 exception: the percentage stays the visible label (no spinner swap), and the picker is closed.
            const trigger = screen.queryByRole('button', { name: 'Uploading 42%' });
            expect(trigger, 'the trigger should keep "Uploading 42%" as its visible name').not.toBeNull();
            expect(trigger).toBeDisabled();
            expect(trigger).not.toHaveAttribute('aria-busy');
        });

    }

    function uploadCustomButtonGroup2() {
it('renders Remove Custom button when user has customAvatarUrl', () => {
            const user = {
                ...mockUser,
                customAvatarUrl: '/custom/avatar.jpg',
            };
            vi.spyOn(useAuthHook, 'useAuth').mockReturnValue({
                user,
                isAuthenticated: true,
                refetch: mockRefetch,
            } as unknown as ReturnType<typeof useAuthHook.useAuth>);

            render(<AvatarPanel />, { wrapper: createWrapper() });
            const remove = screen.getByRole('button', { name: 'Remove Custom' });
            expect(remove.className, 'Remove Custom should wear the destructive-soft variant').toContain('bg-danger/10');
            fireEvent.click(remove);
            expect(mockDeleteAvatar).toHaveBeenCalledOnce();
        });

it('does not render Remove Custom button when user has no customAvatarUrl', () => {
            render(<AvatarPanel />, { wrapper: createWrapper() });
            expect(screen.queryByText('Remove Custom')).not.toBeInTheDocument();
        });

    }

    describe('Upload custom button', () => {
        uploadCustomButtonGroup1();
        uploadCustomButtonGroup2();
    });

    describe('Preview image', () => {
        it('renders current user avatar preview image', () => {
            render(<AvatarPanel />, { wrapper: createWrapper() });
            const img = screen.getByAltText('TestUser');
            expect(img).toBeInTheDocument();
        });

        it('shows current avatar label text', () => {
            render(<AvatarPanel />, { wrapper: createWrapper() });
            expect(screen.getByText('Click below to change')).toBeInTheDocument();
        });
    });
});
