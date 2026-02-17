/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AvatarPanel } from './avatar-panel';
import * as useAuthHook from '../../hooks/use-auth';
import * as useCharactersHook from '../../hooks/use-characters';
import * as useAvatarUploadHook from '../../hooks/use-avatar-upload';

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
    buildDiscordAvatarUrl: (discordId: string | null, avatar: string | null) => {
        if (discordId && !discordId.startsWith('local:') && avatar) {
            return `https://cdn.discordapp.com/avatars/${discordId}/${avatar}.png`;
        }
        return null;
    },
}));

const mockUser = {
    id: 1,
    username: 'TestUser',
    discordId: '123456789',
    avatar: 'abc123',
    customAvatarUrl: null,
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
    const mockDeleteAvatar = vi.fn();
    const mockRefetch = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();

        // Clear localStorage before each test
        localStorage.clear();

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

    describe('Renders null when no user', () => {
        it('renders nothing when user is null', () => {
            vi.spyOn(useAuthHook, 'useAuth').mockReturnValue({
                user: null,
                isAuthenticated: false,
                refetch: mockRefetch,
            } as any);

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

    describe('Available avatar thumbnail grid (ROK-338)', () => {
        it('renders thumbnail grid with grid-cols-4 on mobile', () => {
            const user = {
                ...mockUser,
                customAvatarUrl: '/custom/avatar.jpg',
            };
            vi.spyOn(useAuthHook, 'useAuth').mockReturnValue({
                user,
                isAuthenticated: true,
                refetch: mockRefetch,
            } as any);

            const { container } = render(<AvatarPanel />, { wrapper: createWrapper() });
            const grid = container.querySelector('.grid.grid-cols-4');
            expect(grid).toBeInTheDocument();
        });

        it('renders thumbnail grid with sm:flex sm:flex-wrap on desktop', () => {
            const user = {
                ...mockUser,
                customAvatarUrl: '/custom/avatar.jpg',
            };
            vi.spyOn(useAuthHook, 'useAuth').mockReturnValue({
                user,
                isAuthenticated: true,
                refetch: mockRefetch,
            } as any);

            const { container } = render(<AvatarPanel />, { wrapper: createWrapper() });
            const grid = container.querySelector('.sm\\:flex.sm\\:flex-wrap');
            expect(grid).toBeInTheDocument();
        });

        it('thumbnail images have mobile size w-12 h-12', () => {
            const user = {
                ...mockUser,
                customAvatarUrl: '/custom/avatar.jpg',
            };
            vi.spyOn(useAuthHook, 'useAuth').mockReturnValue({
                user,
                isAuthenticated: true,
                refetch: mockRefetch,
            } as any);

            const { container } = render(<AvatarPanel />, { wrapper: createWrapper() });
            const thumbnails = container.querySelectorAll('img.w-12.h-12');
            expect(thumbnails.length).toBeGreaterThan(0);
        });

        it('thumbnail images have desktop size sm:w-14 sm:h-14', () => {
            const user = {
                ...mockUser,
                customAvatarUrl: '/custom/avatar.jpg',
            };
            vi.spyOn(useAuthHook, 'useAuth').mockReturnValue({
                user,
                isAuthenticated: true,
                refetch: mockRefetch,
            } as any);

            const { container } = render(<AvatarPanel />, { wrapper: createWrapper() });
            const thumbnails = container.querySelectorAll('img.sm\\:w-14.sm\\:h-14');
            expect(thumbnails.length).toBeGreaterThan(0);
        });
    });

    describe('Avatar options display', () => {
        it('does not render avatar grid when no options are available', () => {
            // User with no discord, no custom avatar, no characters
            const user = {
                id: 1,
                username: 'LocalUser',
                discordId: 'local:xyz',
                avatar: null,
                customAvatarUrl: null,
            };
            vi.spyOn(useAuthHook, 'useAuth').mockReturnValue({
                user,
                isAuthenticated: true,
                refetch: mockRefetch,
            } as any);

            render(<AvatarPanel />, { wrapper: createWrapper() });
            expect(screen.queryByText('Available Avatars')).not.toBeInTheDocument();
        });

        it('renders Available Avatars section when options exist', () => {
            const user = {
                ...mockUser,
                customAvatarUrl: '/custom/avatar.jpg',
            };
            vi.spyOn(useAuthHook, 'useAuth').mockReturnValue({
                user,
                isAuthenticated: true,
                refetch: mockRefetch,
            } as any);

            render(<AvatarPanel />, { wrapper: createWrapper() });
            expect(screen.getByText('Available Avatars')).toBeInTheDocument();
        });

        it('renders Custom label when user has customAvatarUrl', () => {
            const user = {
                ...mockUser,
                customAvatarUrl: '/custom/avatar.jpg',
            };
            vi.spyOn(useAuthHook, 'useAuth').mockReturnValue({
                user,
                isAuthenticated: true,
                refetch: mockRefetch,
            } as any);

            render(<AvatarPanel />, { wrapper: createWrapper() });
            expect(screen.getByText('Custom')).toBeInTheDocument();
        });

        it('renders Discord label for linked discord account', () => {
            render(<AvatarPanel />, { wrapper: createWrapper() });
            // User has discordId '123456789' and avatar 'abc123' → Discord option
            expect(screen.getByText('Discord')).toBeInTheDocument();
        });

        it('renders character avatar options when characters have avatarUrl', () => {
            vi.spyOn(useCharactersHook, 'useMyCharacters').mockReturnValue({
                data: {
                    data: [
                        { name: 'Thrall', avatarUrl: 'https://example.com/thrall.jpg' },
                        { name: 'Jaina', avatarUrl: null },
                    ],
                },
                isLoading: false,
            } as any);

            render(<AvatarPanel />, { wrapper: createWrapper() });
            expect(screen.getByText('Thrall')).toBeInTheDocument();
            // Jaina has no avatarUrl so should not appear
            expect(screen.queryByText('Jaina')).not.toBeInTheDocument();
        });
    });

    describe('Avatar selection', () => {
        it('renders active ring on the selected avatar thumbnail', () => {
            const user = {
                ...mockUser,
                customAvatarUrl: '/custom/avatar.jpg',
            };
            vi.spyOn(useAuthHook, 'useAuth').mockReturnValue({
                user,
                isAuthenticated: true,
                refetch: mockRefetch,
            } as any);

            const { container } = render(<AvatarPanel />, { wrapper: createWrapper() });
            const selectedButton = container.querySelector('.ring-2.ring-emerald-500');
            expect(selectedButton).toBeInTheDocument();
        });

        it('updates selected avatar when a thumbnail is clicked', () => {
            const user = {
                ...mockUser,
                customAvatarUrl: '/custom/avatar.jpg',
            };
            vi.spyOn(useAuthHook, 'useAuth').mockReturnValue({
                user,
                isAuthenticated: true,
                refetch: mockRefetch,
            } as any);

            const { container } = render(<AvatarPanel />, { wrapper: createWrapper() });

            // Click the Discord option (second thumbnail)
            const thumbnailButtons = container.querySelectorAll('button.relative.group');
            if (thumbnailButtons.length > 1) {
                fireEvent.click(thumbnailButtons[1]);
                // The second button should now have the ring
                expect(thumbnailButtons[1]).toHaveClass('ring-2');
                expect(thumbnailButtons[1]).toHaveClass('ring-emerald-500');
            }
        });
    });

    describe('Upload custom button', () => {
        it('renders Upload Custom button', () => {
            render(<AvatarPanel />, { wrapper: createWrapper() });
            expect(screen.getByText('Upload Custom')).toBeInTheDocument();
        });

        it('shows uploading progress text when isUploading is true', () => {
            vi.spyOn(useAvatarUploadHook, 'useAvatarUpload').mockReturnValue({
                upload: mockUpload,
                deleteAvatar: mockDeleteAvatar,
                isUploading: true,
                uploadProgress: 42,
            } as any);

            render(<AvatarPanel />, { wrapper: createWrapper() });
            expect(screen.getByText('Uploading 42%')).toBeInTheDocument();
        });

        it('renders Remove Custom button when user has customAvatarUrl', () => {
            const user = {
                ...mockUser,
                customAvatarUrl: '/custom/avatar.jpg',
            };
            vi.spyOn(useAuthHook, 'useAuth').mockReturnValue({
                user,
                isAuthenticated: true,
                refetch: mockRefetch,
            } as any);

            render(<AvatarPanel />, { wrapper: createWrapper() });
            expect(screen.getByText('Remove Custom')).toBeInTheDocument();
        });

        it('does not render Remove Custom button when user has no customAvatarUrl', () => {
            render(<AvatarPanel />, { wrapper: createWrapper() });
            expect(screen.queryByText('Remove Custom')).not.toBeInTheDocument();
        });
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
