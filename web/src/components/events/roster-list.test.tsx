import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RosterList } from './roster-list';

const mockSignups = [
    {
        id: 1,
        user: { id: 123, discordId: '123456789', username: 'Player1', avatar: null },
        signedUpAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(), // 30 mins ago
        characterId: null,
        character: null,
        confirmationStatus: 'pending' as const,
    },
    {
        id: 2,
        user: { id: 456, discordId: '987654321', username: 'Player2', avatar: 'abc123' },
        signedUpAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // 2 hours ago
        characterId: 'char-uuid-1',
        character: {
            id: 'char-uuid-1',
            name: 'Frostweaver',
            class: 'Mage',
            spec: 'Arcane',
            role: 'dps' as const,
            isMain: true,
            itemLevel: 485,
            avatarUrl: null,
        },
        confirmationStatus: 'confirmed' as const,
    },
];

describe('RosterList', () => {
    it('renders empty state when no signups', () => {
        render(<RosterList signups={[]} />);
        expect(screen.getByText(/No signups yet/)).toBeInTheDocument();
    });

    it('renders user names for pending signups', () => {
        const pendingSignups = [mockSignups[0]];
        render(<RosterList signups={pendingSignups} />);
        expect(screen.getByText('Player1')).toBeInTheDocument();
    });

    it('renders character names for confirmed signups (AC-6)', () => {
        const confirmedSignups = [mockSignups[1]];
        render(<RosterList signups={confirmedSignups} />);
        // Character name should be displayed prominently
        expect(screen.getByText('Frostweaver')).toBeInTheDocument();
        // Username should still be visible (desktop inline + mobile stacked)
        expect(screen.getByText('Player2')).toBeInTheDocument();
        // Class shown in both desktop inline and mobile stacked layouts
        const mageElements = screen.getAllByText('Mage');
        expect(mageElements.length).toBeGreaterThanOrEqual(1);
    });

    it('renders pending confirmation indicator (AC-7)', () => {
        const pendingSignups = [mockSignups[0]];
        render(<RosterList signups={pendingSignups} />);
        expect(screen.getByText('❓')).toBeInTheDocument();
        expect(screen.getByText(/Awaiting confirmation/)).toBeInTheDocument();
    });

    it('renders main character badge', () => {
        const confirmedSignups = [mockSignups[1]];
        render(<RosterList signups={confirmedSignups} />);
        // Main badge appears in both desktop and mobile layouts
        const starElements = screen.getAllByText('⭐');
        expect(starElements.length).toBeGreaterThanOrEqual(1);
    });

    it('renders Discord avatars and initials fallback (ROK-222)', () => {
        render(<RosterList signups={mockSignups} />);
        const avatars = screen.getAllByRole('img');
        // Player1 has no avatar -> shows initials (div), not img
        // Player2 has avatar hash -> shows Discord CDN img via resolveAvatar(toAvatarUser())
        // ROK-465: class icons + role icons also render as <img>, so filter to Discord CDN avatar
        const discordAvatars = avatars.filter((img) =>
            img.getAttribute('src')?.includes('cdn.discordapp.com'),
        );
        expect(discordAvatars).toHaveLength(1);
        expect(discordAvatars[0]).toHaveAttribute('src', expect.stringContaining('987654321'));
        // Verify Player1 shows initials fallback
        expect(screen.getByText('P')).toBeInTheDocument();
    });

    it('shows item level for confirmed characters', () => {
        const confirmedSignups = [mockSignups[1]];
        render(<RosterList signups={confirmedSignups} />);
        expect(screen.getByText('485')).toBeInTheDocument();
    });

    it('renders role icon for confirmed characters', () => {
        const confirmedSignups = [mockSignups[1]];
        render(<RosterList signups={confirmedSignups} />);
        // ROK-465: Role is now rendered as <RoleIcon> (an <img> with alt={role})
        expect(screen.getByAltText('dps')).toBeInTheDocument();
    });

    it('sorts signups alphabetically by username (case-insensitive)', () => {
        const unsortedSignups = [
            {
                id: 3,
                user: { id: 789, discordId: '111', username: 'charlie', avatar: null },
                signedUpAt: new Date(Date.now() - 1000).toISOString(),
                characterId: null,
                character: null,
                confirmationStatus: 'pending' as const,
            },
            {
                id: 1,
                user: { id: 123, discordId: '222', username: 'alice', avatar: null },
                signedUpAt: new Date(Date.now() - 2000).toISOString(),
                characterId: null,
                character: null,
                confirmationStatus: 'pending' as const,
            },
            {
                id: 2,
                user: { id: 456, discordId: '333', username: 'Bob', avatar: null },
                signedUpAt: new Date(Date.now() - 3000).toISOString(),
                characterId: null,
                character: null,
                confirmationStatus: 'pending' as const,
            },
        ];

        const { container } = render(<RosterList signups={unsortedSignups} />);
        const items = container.querySelectorAll('.font-medium.text-foreground');

        // Should be sorted: alice, Bob, charlie (case-insensitive)
        expect(items[0]).toHaveTextContent('alice');
        expect(items[1]).toHaveTextContent('Bob');
        expect(items[2]).toHaveTextContent('charlie');
    });

    it('does not mutate the original signups array', () => {
        const signups = [
            {
                id: 2,
                user: { id: 456, discordId: '222', username: 'zebra', avatar: null },
                signedUpAt: new Date().toISOString(),
                characterId: null,
                character: null,
                confirmationStatus: 'pending' as const,
            },
            {
                id: 1,
                user: { id: 123, discordId: '111', username: 'aardvark', avatar: null },
                signedUpAt: new Date().toISOString(),
                characterId: null,
                character: null,
                confirmationStatus: 'pending' as const,
            },
        ];

        const originalOrder = signups.map((s) => s.user.username);
        render(<RosterList signups={signups} />);

        // Original array should remain unchanged
        expect(signups[0].user.username).toBe(originalOrder[0]);
        expect(signups[1].user.username).toBe(originalOrder[1]);
    });

    // Mobile layout tests (ROK-358)

    it('renders class and spec on mobile secondary line', () => {
        const { container } = render(<RosterList signups={[mockSignups[1]]} />);
        // Mobile secondary line: flex sm:hidden
        const mobileSecondaryLines = container.querySelectorAll('.flex.sm\\:hidden');
        // First sm:hidden div should contain class and spec
        const secondaryLine = mobileSecondaryLines[0];
        expect(secondaryLine).toBeInTheDocument();
        expect(secondaryLine.textContent).toContain('Mage');
        expect(secondaryLine.textContent).toContain('Arcane');
    });

    it('renders iLevel with "iLvl" suffix on mobile secondary line', () => {
        const { container } = render(<RosterList signups={[mockSignups[1]]} />);
        const mobileSecondaryLines = container.querySelectorAll('.flex.sm\\:hidden');
        const secondaryLine = mobileSecondaryLines[0];
        expect(secondaryLine.textContent).toContain('485 iLvl');
    });

    it('renders @username on mobile tertiary line', () => {
        const { container } = render(<RosterList signups={[mockSignups[1]]} />);
        const mobileLines = container.querySelectorAll('.flex.sm\\:hidden');
        // Tertiary line is the last sm:hidden flex div containing @username
        const tertiaryLine = mobileLines[mobileLines.length - 1];
        expect(tertiaryLine.textContent).toContain('@Player2');
    });

    it('renders main character badge on mobile tertiary line', () => {
        const { container } = render(<RosterList signups={[mockSignups[1]]} />);
        const mobileLines = container.querySelectorAll('.flex.sm\\:hidden');
        const tertiaryLine = mobileLines[mobileLines.length - 1];
        expect(tertiaryLine.textContent).toContain('⭐');
    });

    it('renders desktop main badge with hidden sm:inline class', () => {
        const { container } = render(<RosterList signups={[mockSignups[1]]} />);
        const desktopMainBadge = container.querySelector('.hidden.sm\\:inline');
        expect(desktopMainBadge).toBeInTheDocument();
        expect(desktopMainBadge?.textContent).toContain('⭐');
    });

    it('does not render mobile secondary line when character has no class, spec, or iLevel', () => {
        const minimalSignup = {
            id: 3,
            user: { id: 789, discordId: '111', username: 'Player3', avatar: null },
            signedUpAt: new Date(Date.now() - 60 * 1000).toISOString(),
            characterId: 'char-uuid-2',
            character: {
                id: 'char-uuid-2',
                name: 'Plainwalker',
                class: null,
                spec: null,
                role: 'tank' as const,
                isMain: false,
                itemLevel: null,
                avatarUrl: null,
            },
            confirmationStatus: 'confirmed' as const,
        };
        const { container } = render(<RosterList signups={[minimalSignup]} />);
        // The secondary line (class/spec/iLevel) should not render when all are null
        const mobileLines = container.querySelectorAll('.flex.sm\\:hidden');
        // Only the tertiary line (@username) should be present
        expect(mobileLines).toHaveLength(1);
        expect(mobileLines[0].textContent).toContain('@Player3');
    });

    it('username is shown in desktop inline details span for confirmed characters', () => {
        const { container } = render(<RosterList signups={[mockSignups[1]]} />);
        const desktopDetails = container.querySelector('.hidden.sm\\:flex');
        expect(desktopDetails?.textContent).toContain('Player2');
    });

    it('class and spec appear in desktop inline details span', () => {
        const { container } = render(<RosterList signups={[mockSignups[1]]} />);
        const desktopDetails = container.querySelector('.hidden.sm\\:flex');
        expect(desktopDetails?.textContent).toContain('Mage');
        expect(desktopDetails?.textContent).toContain('Arcane');
    });

    it('iLevel appears in desktop inline details span without iLvl suffix', () => {
        const { container } = render(<RosterList signups={[mockSignups[1]]} />);
        const desktopDetails = container.querySelector('.hidden.sm\\:flex');
        // Desktop shows raw item level number without "iLvl" label
        expect(desktopDetails?.textContent).toContain('485');
        expect(desktopDetails?.textContent).not.toContain('iLvl');
    });
});
