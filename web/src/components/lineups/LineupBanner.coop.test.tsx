/**
 * Co-op pill on the LineupBanner nomination thumbnails (ROK-1401).
 *
 * The banner entry DTO gains the raw `cooptimusOnlineMax` additively, so the
 * pill sits under the existing "N own" caption. Per-entry gating: an enriched
 * entry gets a pill, an unenriched sibling in the SAME banner gets nothing.
 */
import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../test/render-helpers';
import { createMockBanner } from '../../test/lineup-factories';
import { LineupBanner } from './LineupBanner';

vi.mock('../../hooks/use-lineups', () => ({
    useLineupBanner: vi.fn(),
    useActiveLineups: vi.fn(() => ({ data: [], isLoading: false })),
}));
vi.mock('./NominateModal', () => ({ NominateModal: () => null }));
vi.mock('./start-lineup-modal', () => ({ StartLineupModal: () => null }));
vi.mock('../../hooks/use-auth', () => ({
    useAuth: vi.fn(() => ({ user: null })),
    isOperatorOrAdmin: vi.fn(() => false),
}));

import { useLineupBanner } from '../../hooks/use-lineups';

const PILL = 'coop-pill';
const mockUseLineupBanner = vi.mocked(useLineupBanner);

function mockBanner(entries: ReturnType<typeof createMockBanner>['entries']) {
    mockUseLineupBanner.mockReturnValue({
        data: createMockBanner({ entries }),
        isLoading: false,
        isSuccess: true,
        isError: false,
        error: null,
        isFetching: false,
    } as ReturnType<typeof useLineupBanner>);
}

function entry(
    gameId: number,
    gameName: string,
    cooptimusOnlineMax: number | null,
) {
    return {
        gameId,
        gameName,
        gameCoverUrl: null,
        ownerCount: 6,
        voteCount: 3,
        cooptimusOnlineMax,
    };
}

describe('LineupBanner — co-op pill on nomination thumbnails', () => {
    it('renders the pill for an enriched entry, beside its "N own" caption', () => {
        mockBanner([entry(1, 'Valheim', 4)]);
        renderWithProviders(<LineupBanner />);
        expect(screen.getByTestId(PILL)).toHaveTextContent('👥 4 co-op');
        expect(screen.getByText('6 own')).toBeInTheDocument();
    });

    it('gates per entry — only the enriched thumbnail gets a pill', () => {
        mockBanner([
            entry(1, 'Valheim', 4),
            entry(2, 'Elden Ring', null),
            entry(3, 'Solo Game', 0),
        ]);
        renderWithProviders(<LineupBanner />);
        const pills = screen.getAllByTestId(PILL);
        expect(pills).toHaveLength(1);
        expect(pills[0]).toHaveTextContent('👥 4 co-op');
    });

    it('renders NO pill element when nothing in the banner is enriched', () => {
        // Positive control first so the negative cannot pass vacuously.
        mockBanner([entry(1, 'Valheim', 4)]);
        const control = renderWithProviders(<LineupBanner />);
        expect(screen.getByTestId(PILL)).toBeInTheDocument();
        control.unmount();

        mockBanner([entry(1, 'Valheim', null), entry(2, 'Elden Ring', 0)]);
        renderWithProviders(<LineupBanner />);
        expect(screen.queryByTestId(PILL)).toBeNull();
        // Thumbnails themselves are untouched.
        expect(screen.getAllByText('6 own')).toHaveLength(2);
    });
});
