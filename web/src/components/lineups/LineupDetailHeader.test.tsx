/**
 * ROK-1063 — failing TDD tests for the lineup detail header.
 *
 * The H1 must render the lineup's stored `title` (NOT the static
 * "Community Lineup" string). When a description is present, it must
 * render below the heading.
 *
 * ROK-1123 — phase advance modal tests appended below.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../../test/render-helpers';
import { createMockLineupDetail } from '../../test/lineup-factories';
import { LineupDetailHeader } from './LineupDetailHeader';

const mockTransitionMutate = vi.fn();
const mockTransitionState = { isPending: false };

vi.mock('../../hooks/use-lineups', () => ({
    useTransitionLineupStatus: () => ({
        mutate: mockTransitionMutate,
        get isPending() {
            return mockTransitionState.isPending;
        },
    }),
    useTogglePublicShare: () => ({
        mutate: vi.fn(),
        isPending: false,
    }),
}));

vi.mock('../../hooks/use-auth', () => ({
    useAuth: vi.fn(() => ({ user: null })),
    isOperatorOrAdmin: vi.fn(() => false),
}));

import { useAuth, isOperatorOrAdmin } from '../../hooks/use-auth';

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

describe('LineupDetailHeader — phase advance modal (ROK-1123)', () => {
    beforeEach(() => {
        mockTransitionMutate.mockReset();
        mockTransitionState.isPending = false;
        vi.mocked(useAuth).mockReturnValue({
            user: { id: 1, role: 'operator' },
        } as ReturnType<typeof useAuth>);
        vi.mocked(isOperatorOrAdmin).mockReturnValue(true);
    });

    it('opens the modal when the next-phase pill is clicked', () => {
        const lineup = buildDetail({ title: 'Modal Test', status: 'building' });
        renderWithProviders(<LineupDetailHeader lineup={lineup} />);

        // The breadcrumb is rendered twice (desktop + mobile). Pick the first.
        const votingButtons = screen.getAllByRole('button', { name: 'Voting' });
        fireEvent.click(votingButtons[0]);

        expect(screen.getByRole('dialog')).toBeInTheDocument();
        expect(
            screen.getByRole('heading', { name: /Advance to Voting\?/ }),
        ).toBeInTheDocument();
    });

    it('shows a Revert title when clicking the previous-phase pill', () => {
        const lineup = buildDetail({ title: 'Revert Test', status: 'voting' });
        renderWithProviders(<LineupDetailHeader lineup={lineup} />);

        const nominatingButtons = screen.getAllByRole('button', {
            name: 'Nominating',
        });
        fireEvent.click(nominatingButtons[0]);

        expect(
            screen.getByRole('heading', { name: /Revert to Nominating\?/ }),
        ).toBeInTheDocument();
    });

    it('fires the transition mutation with the target status when confirmed', () => {
        const lineup = buildDetail({
            id: 42,
            title: 'Confirm Test',
            status: 'building',
        });
        renderWithProviders(<LineupDetailHeader lineup={lineup} />);

        fireEvent.click(screen.getAllByRole('button', { name: 'Voting' })[0]);
        fireEvent.click(
            screen.getByRole('button', { name: 'Advance to Voting' }),
        );

        expect(mockTransitionMutate).toHaveBeenCalledTimes(1);
        const call = mockTransitionMutate.mock.calls[0];
        expect(call[0]).toEqual({
            lineupId: 42,
            body: { status: 'voting' },
        });
    });

    it('does not fire the mutation when Cancel is clicked', () => {
        const lineup = buildDetail({ title: 'Cancel Test', status: 'building' });
        renderWithProviders(<LineupDetailHeader lineup={lineup} />);

        fireEvent.click(screen.getAllByRole('button', { name: 'Voting' })[0]);
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

        expect(mockTransitionMutate).not.toHaveBeenCalled();
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('closes the modal on Escape without firing the mutation', () => {
        const lineup = buildDetail({ title: 'Esc Test', status: 'building' });
        renderWithProviders(<LineupDetailHeader lineup={lineup} />);

        fireEvent.click(screen.getAllByRole('button', { name: 'Voting' })[0]);
        expect(screen.getByRole('dialog')).toBeInTheDocument();

        fireEvent.keyDown(document, { key: 'Escape' });

        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(mockTransitionMutate).not.toHaveBeenCalled();
    });

    it('submits the form (Enter on confirm button) and fires the mutation', () => {
        const lineup = buildDetail({
            id: 7,
            title: 'Enter Test',
            status: 'building',
        });
        renderWithProviders(<LineupDetailHeader lineup={lineup} />);

        fireEvent.click(screen.getAllByRole('button', { name: 'Voting' })[0]);
        const confirm = screen.getByRole('button', {
            name: 'Advance to Voting',
        });
        // Find the enclosing form and dispatch a submit event — same path
        // Enter takes when focus is on the default submit button.
        const form = confirm.closest('form');
        expect(form).not.toBeNull();
        fireEvent.submit(form!);

        expect(mockTransitionMutate).toHaveBeenCalledTimes(1);
        expect(mockTransitionMutate.mock.calls[0][0]).toEqual({
            lineupId: 7,
            body: { status: 'voting' },
        });
    });
});
