import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DiscordJoinStep } from './discord-join-step';

vi.mock('../../hooks/use-discord-onboarding', () => ({
    useServerInvite: vi.fn(),
}));

vi.mock('../icons/DiscordIcon', () => ({
    DiscordIcon: ({ className }: { className?: string }) => (
        <svg data-testid="discord-icon" className={className} />
    ),
}));

import { useServerInvite } from '../../hooks/use-discord-onboarding';
const mockUseServerInvite = useServerInvite as unknown as ReturnType<typeof vi.fn>;

describe('DiscordJoinStep', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('Loading state', () => {
        it('shows a loading spinner when invite is loading', () => {
            mockUseServerInvite.mockReturnValue({ data: undefined, isLoading: true });

            const { container } = render(<DiscordJoinStep />);

            const spinner = container.querySelector('.animate-spin');
            expect(spinner).not.toBeNull();
        });

        it('does not show the Join Server button while loading', () => {
            mockUseServerInvite.mockReturnValue({ data: undefined, isLoading: true });

            render(<DiscordJoinStep />);

            expect(screen.queryByText(/join server/i)).not.toBeInTheDocument();
        });
    });

    describe('With invite URL available', () => {
        beforeEach(() => {
            mockUseServerInvite.mockReturnValue({
                data: { url: 'https://discord.gg/abc123', guildName: 'Test Guild' },
                isLoading: false,
            });
        });

        it('renders the "Join Server" link when invite URL is available', () => {
            render(<DiscordJoinStep />);

            expect(screen.getByText(/join server/i)).toBeInTheDocument();
        });

        it('renders the invite URL as an anchor tag', () => {
            render(<DiscordJoinStep />);

            const link = screen.getByRole('link', { name: /join server/i });
            expect(link).toBeInTheDocument();
            expect(link).toHaveAttribute('href', 'https://discord.gg/abc123');
        });

        it('opens invite link in a new tab', () => {
            render(<DiscordJoinStep />);

            const link = screen.getByRole('link', { name: /join server/i });
            expect(link).toHaveAttribute('target', '_blank');
        });

        it('has rel="noopener noreferrer" for security', () => {
            render(<DiscordJoinStep />);

            const link = screen.getByRole('link', { name: /join server/i });
            expect(link).toHaveAttribute('rel', 'noopener noreferrer');
        });

        it('shows the guild name in the heading', () => {
            render(<DiscordJoinStep />);

            expect(screen.getByText(/test guild/i)).toBeInTheDocument();
        });

        it('shows a Discord icon', () => {
            render(<DiscordJoinStep />);

            const icons = screen.getAllByTestId('discord-icon');
            expect(icons.length).toBeGreaterThan(0);
        });

        it('Join Server link meets minimum 44px touch target height (min-h-[44px])', () => {
            render(<DiscordJoinStep />);

            const link = screen.getByRole('link', { name: /join server/i });
            expect(link.className).toContain('min-h-[44px]');
        });
    });

    describe('With no invite URL available (null)', () => {
        beforeEach(() => {
            mockUseServerInvite.mockReturnValue({
                data: { url: null, guildName: 'Test Guild' },
                isLoading: false,
            });
        });

        it('shows fallback message when invite URL is null', () => {
            render(<DiscordJoinStep />);

            expect(screen.getByText(/discord server invite is not available/i)).toBeInTheDocument();
        });

        it('does not render the Join Server button when invite URL is null', () => {
            render(<DiscordJoinStep />);

            expect(screen.queryByText(/join server/i)).not.toBeInTheDocument();
        });

        it('suggests user can skip the step', () => {
            render(<DiscordJoinStep />);

            expect(screen.getByText(/skip this step/i)).toBeInTheDocument();
        });
    });

    describe('With no data (data is undefined)', () => {
        beforeEach(() => {
            mockUseServerInvite.mockReturnValue({
                data: undefined,
                isLoading: false,
            });
        });

        it('falls back to "our Discord server" when guildName is undefined', () => {
            render(<DiscordJoinStep />);

            expect(screen.getByText(/join our discord server/i)).toBeInTheDocument();
        });

        it('shows fallback message when data is undefined (no URL)', () => {
            render(<DiscordJoinStep />);

            expect(screen.getByText(/discord server invite is not available/i)).toBeInTheDocument();
        });
    });

    describe('With null guildName', () => {
        it('falls back to "our Discord server" when guildName is null', () => {
            mockUseServerInvite.mockReturnValue({
                data: { url: 'https://discord.gg/xyz', guildName: null },
                isLoading: false,
            });

            render(<DiscordJoinStep />);

            expect(screen.getByText(/join our discord server/i)).toBeInTheDocument();
        });
    });

    describe('Informational text', () => {
        beforeEach(() => {
            mockUseServerInvite.mockReturnValue({
                data: { url: 'https://discord.gg/abc', guildName: 'My Community' },
                isLoading: false,
            });
        });

        it('renders descriptive paragraph about the Discord server', () => {
            render(<DiscordJoinStep />);

            expect(screen.getByText(/community discord server/i)).toBeInTheDocument();
        });

        it('renders info about being able to join later', () => {
            render(<DiscordJoinStep />);

            expect(screen.getByText(/join the server later/i)).toBeInTheDocument();
        });
    });
});
