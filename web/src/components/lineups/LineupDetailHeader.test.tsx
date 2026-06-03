/**
 * ROK-1323 — the lineup detail header is now a compact top bar after the
 * legacy-chrome strip. The H1 title / description / status badge / 4-phase
 * breadcrumb / "Started by…" meta / Edit + Abort buttons / PublicShareRow all
 * moved out: title + meta live in the per-phase composite's JourneyHero, and
 * operator/share affordances live in the LineupOperatorMenu `⋮` dropdown.
 *
 * These tests cover what the header still owns: back navigation, the private
 * badge, the operator `⋮` menu (operator-or-creator visibility + items), and
 * the member-visible Copy-link affordance. The phase-advance modal is exercised
 * through the menu's Advance item.
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

function asOperator() {
    vi.mocked(useAuth).mockReturnValue({
        user: { id: 99, role: 'operator' },
    } as ReturnType<typeof useAuth>);
    vi.mocked(isOperatorOrAdmin).mockReturnValue(true);
}

describe('LineupDetailHeader — compact bar (ROK-1323)', () => {
    beforeEach(() => {
        vi.mocked(useAuth).mockReturnValue({ user: null } as ReturnType<typeof useAuth>);
        vi.mocked(isOperatorOrAdmin).mockReturnValue(false);
    });

    it('renders a back button', () => {
        const lineup = buildDetail({ title: 'Spring Raid Picks' });
        renderWithProviders(<LineupDetailHeader lineup={lineup} />);
        expect(screen.getByRole('button', { name: /go back/i })).toBeInTheDocument();
    });

    it('does NOT render a legacy H1 title block', () => {
        const lineup = buildDetail({ title: 'Winter Picks' });
        renderWithProviders(<LineupDetailHeader lineup={lineup} />);
        expect(screen.queryByTestId('community-lineup-title')).toBeNull();
        expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
    });

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

describe('LineupDetailHeader — member copy-link (ROK-1323)', () => {
    beforeEach(() => {
        vi.mocked(useAuth).mockReturnValue({
            user: { id: 2, role: 'member' },
        } as ReturnType<typeof useAuth>);
        vi.mocked(isOperatorOrAdmin).mockReturnValue(false);
    });

    it('shows the member Copy-link affordance when share is enabled', () => {
        const lineup = buildDetail({ title: 'Shared', publicShareEnabled: true });
        renderWithProviders(<LineupDetailHeader lineup={lineup} />);
        expect(screen.getByTestId('lineup-share-copy')).toBeInTheDocument();
    });

    it('hides the Copy-link affordance when share is disabled', () => {
        const lineup = buildDetail({ title: 'Closed', publicShareEnabled: false });
        renderWithProviders(<LineupDetailHeader lineup={lineup} />);
        expect(screen.queryByTestId('lineup-share-copy')).toBeNull();
    });

    it('does not render the operator menu trigger for a plain member', () => {
        const lineup = buildDetail({ title: 'No menu', publicShareEnabled: true });
        renderWithProviders(<LineupDetailHeader lineup={lineup} />);
        expect(screen.queryByTestId('lineup-operator-menu-trigger')).toBeNull();
    });
});

describe('LineupDetailHeader — operator ⋮ menu (ROK-1323)', () => {
    beforeEach(() => {
        mockTransitionMutate.mockReset();
        mockTransitionState.isPending = false;
        asOperator();
    });

    it('renders the menu trigger, closed by default', () => {
        const lineup = buildDetail({ title: 'Menu Test', status: 'building' });
        renderWithProviders(<LineupDetailHeader lineup={lineup} />);
        expect(screen.getByTestId('lineup-operator-menu-trigger')).toBeInTheDocument();
        expect(screen.queryByTestId('lineup-operator-menu')).toBeNull();
    });

    it('opens the menu and exposes Edit / Advance / Abort', () => {
        const lineup = buildDetail({ title: 'Menu Open', status: 'building' });
        renderWithProviders(<LineupDetailHeader lineup={lineup} />);
        fireEvent.click(screen.getByTestId('lineup-operator-menu-trigger'));
        expect(screen.getByTestId('lineup-operator-menu')).toBeInTheDocument();
        expect(screen.getByTestId('lineup-operator-menu-edit')).toBeInTheDocument();
        expect(screen.getByTestId('lineup-operator-menu-advance')).toBeInTheDocument();
        expect(screen.getByTestId('lineup-operator-menu-abort')).toBeInTheDocument();
    });

    it('opens the phase-transition modal from the Advance item', () => {
        const lineup = buildDetail({ title: 'Advance', status: 'building' });
        renderWithProviders(<LineupDetailHeader lineup={lineup} />);
        fireEvent.click(screen.getByTestId('lineup-operator-menu-trigger'));
        fireEvent.click(screen.getByTestId('lineup-operator-menu-advance'));
        expect(
            screen.getByRole('heading', { name: /Advance to Voting\?/ }),
        ).toBeInTheDocument();
    });

    it('fires the transition mutation when the advance is confirmed', () => {
        const lineup = buildDetail({ id: 42, title: 'Confirm', status: 'building' });
        renderWithProviders(<LineupDetailHeader lineup={lineup} />);
        fireEvent.click(screen.getByTestId('lineup-operator-menu-trigger'));
        fireEvent.click(screen.getByTestId('lineup-operator-menu-advance'));
        fireEvent.click(screen.getByRole('button', { name: 'Advance to Voting' }));
        expect(mockTransitionMutate).toHaveBeenCalledTimes(1);
        expect(mockTransitionMutate.mock.calls[0][0]).toEqual({
            lineupId: 42,
            body: { status: 'voting' },
        });
    });

    it('offers a Revert item that opens a Revert modal', () => {
        const lineup = buildDetail({ title: 'Revert', status: 'voting' });
        renderWithProviders(<LineupDetailHeader lineup={lineup} />);
        fireEvent.click(screen.getByTestId('lineup-operator-menu-trigger'));
        fireEvent.click(screen.getByTestId('lineup-operator-menu-revert'));
        expect(
            screen.getByRole('heading', { name: /Revert to Nominating\?/ }),
        ).toBeInTheDocument();
    });
});

describe('LineupDetailHeader — non-operator creator (ROK-1323)', () => {
    beforeEach(() => {
        // The viewer is the lineup creator but NOT an operator/admin.
        vi.mocked(useAuth).mockReturnValue({
            user: { id: 1, role: 'member' },
        } as ReturnType<typeof useAuth>);
        vi.mocked(isOperatorOrAdmin).mockReturnValue(false);
    });

    it('still shows the menu with Edit, but no operator-only items', () => {
        // createdBy.id defaults to 1 in the factory → viewer is the creator.
        const lineup = buildDetail({ title: 'Creator Edit', status: 'building' });
        renderWithProviders(<LineupDetailHeader lineup={lineup} />);
        fireEvent.click(screen.getByTestId('lineup-operator-menu-trigger'));
        expect(screen.getByTestId('lineup-operator-menu-edit')).toBeInTheDocument();
        expect(screen.queryByTestId('lineup-operator-menu-advance')).toBeNull();
        expect(screen.queryByTestId('lineup-operator-menu-abort')).toBeNull();
    });
});
