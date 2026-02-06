import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AttendeeAvatars } from './AttendeeAvatars';

describe('AttendeeAvatars', () => {
    const mockSignups = [
        { id: 1, username: 'Player1', avatar: 'https://cdn.discord.com/avatar1.png' },
        { id: 2, username: 'Player2', avatar: 'https://cdn.discord.com/avatar2.png' },
        { id: 3, username: 'Player3', avatar: null },
        { id: 4, username: 'Player4', avatar: 'https://cdn.discord.com/avatar4.png' },
        { id: 5, username: 'Player5', avatar: null },
    ];

    it('renders correct number of avatars', () => {
        render(<AttendeeAvatars signups={mockSignups} totalCount={5} />);

        const avatars = screen.getAllByRole('img');
        // 3 have actual images, 2 have initials (no img role)
        expect(avatars).toHaveLength(3);
    });

    it('shows +N badge when totalCount exceeds visible signups', () => {
        render(<AttendeeAvatars signups={mockSignups} totalCount={8} />);

        // 8 total - 5 visible = +3
        expect(screen.getByText('+3')).toBeInTheDocument();
    });

    it('does not show +N badge when all signups are visible', () => {
        render(<AttendeeAvatars signups={mockSignups} totalCount={5} />);

        expect(screen.queryByText(/^\+\d+$/)).not.toBeInTheDocument();
    });

    it('handles null avatarUrl with initials fallback', () => {
        const signupWithoutAvatar = [
            { id: 1, username: 'TestUser', avatar: null },
        ];

        render(<AttendeeAvatars signups={signupWithoutAvatar} totalCount={1} />);

        // Should show first letter as initials
        expect(screen.getByText('T')).toBeInTheDocument();
    });

    it('respects maxVisible prop', () => {
        render(<AttendeeAvatars signups={mockSignups} totalCount={10} maxVisible={3} />);

        // 10 total - 3 visible = +7
        expect(screen.getByText('+7')).toBeInTheDocument();
    });

    it('shows username as title attribute (tooltip)', () => {
        render(<AttendeeAvatars signups={mockSignups.slice(0, 1)} totalCount={1} />);

        const avatar = screen.getByTitle('Player1');
        expect(avatar).toBeInTheDocument();
    });

    it('returns null when signups array is empty', () => {
        const { container } = render(<AttendeeAvatars signups={[]} totalCount={0} />);

        expect(container.firstChild).toBeNull();
    });

    it('applies correct size classes for sm size', () => {
        render(<AttendeeAvatars signups={mockSignups.slice(0, 1)} totalCount={1} size="sm" />);

        const avatar = screen.getByTitle('Player1');
        expect(avatar.className).toContain('w-5');
        expect(avatar.className).toContain('h-5');
    });

    it('applies correct size classes for md size', () => {
        render(<AttendeeAvatars signups={mockSignups.slice(0, 1)} totalCount={1} size="md" />);

        const avatar = screen.getByTitle('Player1');
        expect(avatar.className).toContain('w-6');
        expect(avatar.className).toContain('h-6');
    });

    it('applies correct size classes for xs size', () => {
        render(<AttendeeAvatars signups={mockSignups.slice(0, 1)} totalCount={1} size="xs" />);

        const avatar = screen.getByTitle('Player1');
        expect(avatar.className).toContain('w-4');
        expect(avatar.className).toContain('h-4');
    });
});
