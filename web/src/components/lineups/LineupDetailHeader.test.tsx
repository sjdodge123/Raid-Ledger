/**
 * ROK-1063 — failing TDD tests for the lineup detail header.
 *
 * The H1 must render the lineup's stored `title` (NOT the static
 * "Community Lineup" string). When a description is present, it must
 * render below the heading.
 */
import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../test/render-helpers';
import { createMockLineupDetail } from '../../test/lineup-factories';
import { LineupDetailHeader } from './LineupDetailHeader';

vi.mock('../../hooks/use-lineups', () => ({
    useTransitionLineupStatus: () => ({
        mutate: vi.fn(),
        isPending: false,
    }),
}));

vi.mock('../../hooks/use-auth', () => ({
    useAuth: () => ({ user: null }),
    isOperatorOrAdmin: () => false,
}));

// Provide a type cast so test factory overrides for title/description work
// even before the contract types are updated.
type DetailOverrides = Partial<
    ReturnType<typeof createMockLineupDetail> & {
        title: string;
        description: string | null;
    }
>;

function buildDetail(overrides: DetailOverrides) {
    return createMockLineupDetail(
        overrides as Parameters<typeof createMockLineupDetail>[0],
    ) as ReturnType<typeof createMockLineupDetail> & {
        title: string;
        description: string | null;
    };
}

describe('LineupDetailHeader — title (ROK-1063)', () => {
    it('renders the lineup title as the H1 heading', () => {
        const lineup = buildDetail({ title: 'Spring Raid Picks' });
        renderWithProviders(<LineupDetailHeader lineup={lineup} />);

        const heading = screen.getByRole('heading', { level: 1 });
        expect(heading).toHaveTextContent('Spring Raid Picks');
    });

    it('does NOT render the hardcoded "Community Lineup" string as H1', () => {
        const lineup = buildDetail({ title: 'Winter Picks' });
        renderWithProviders(<LineupDetailHeader lineup={lineup} />);

        const heading = screen.getByRole('heading', { level: 1 });
        expect(heading.textContent ?? '').not.toMatch(/community lineup/i);
    });
});

describe('LineupDetailHeader — description (ROK-1063)', () => {
    it('renders description text below the heading when present', () => {
        const lineup = buildDetail({
            title: 'Any title',
            description: 'Community-picked games for this Friday.',
        });
        renderWithProviders(<LineupDetailHeader lineup={lineup} />);

        expect(
            screen.getByText(/Community-picked games for this Friday\./),
        ).toBeInTheDocument();
    });
});

describe('LineupDetailHeader — private badge (ROK-1065)', () => {
    it('renders the Private badge when visibility is private', () => {
        const lineup = buildDetail({
            title: 'Stealth Night',
            visibility: 'private',
        } as DetailOverrides);
        renderWithProviders(<LineupDetailHeader lineup={lineup} />);

        expect(screen.getByTestId('lineup-private-badge')).toBeInTheDocument();
    });

    it('does not render the Private badge when visibility is public', () => {
        const lineup = buildDetail({ title: 'Raid Night' });
        renderWithProviders(<LineupDetailHeader lineup={lineup} />);

        expect(screen.queryByTestId('lineup-private-badge')).toBeNull();
    });
});
