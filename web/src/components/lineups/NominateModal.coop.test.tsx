/**
 * Tests for the NominateModal co-op badge + soft group-size warning
 * (ROK-1400). Written TDD-style BEFORE the feature exists — every test
 * here must FAIL on first run.
 *
 * Prescribed contract:
 *  - `NominateModal` gains `participantCount?: number`.
 *  - Each search-result row renders an element with
 *    `data-testid="coop-max-badge"` whose text contains the EFFECTIVE
 *    online-co-op max — Co-Optimus-verified ONLY (round 2, 2026-08-20):
 *      `cooptimusOnlineMax` present wins INCLUDING zero (rendered as
 *      "No online co-op") → absent means NO badge and NO warning. IGDB
 *      `playerCount` is never consulted; it is a lobby-size estimate.
 *  - When an effective max exists AND is < `participantCount`, the row
 *    also renders soft warning copy matching
 *    /may not fit your group of {participantCount}/i.
 *  - The warning is ADVISORY: the row stays clickable and nomination
 *    still submits (operator decision — soft filter only, no hard gate).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/render-helpers';
import { NominateModal } from './NominateModal';

vi.mock('../../hooks/use-game-search', () => ({
    useGameSearch: vi.fn(),
}));
vi.mock('../../hooks/use-lineups', () => ({
    useNominateGame: vi.fn(),
}));

import { useGameSearch } from '../../hooks/use-game-search';
import { useNominateGame } from '../../hooks/use-lineups';

const mockMutate = vi.fn();

/** Minimal search-result shape the modal consumes. */
interface ResultFixture {
    id: number;
    name: string;
    coverUrl?: string | null;
    cooptimusOnlineMax?: number | null;
    /** ROK-1401 round 3: the label helper also reads couch + combo. */
    cooptimusCouchMax?: number | null;
    cooptimusComboCoop?: boolean | null;
    playerCount?: { min: number; max: number } | null;
}

function mockResults(results: ResultFixture[]): void {
    vi.mocked(useGameSearch).mockReturnValue({
        data: { data: results, meta: { source: 'igdb' } },
        isLoading: false,
    } as unknown as ReturnType<typeof useGameSearch>);
}

beforeEach(() => {
    vi.clearAllMocks();
    mockResults([]);
    vi.mocked(useNominateGame).mockReturnValue({
        mutate: mockMutate,
        isPending: false,
        isError: false,
        error: null,
    } as unknown as ReturnType<typeof useNominateGame>);
});

describe('NominateModal — co-op badge precedence (ROK-1400)', () => {
    it('shows the positive cooptimusOnlineMax on the badge', () => {
        mockResults([
            { id: 42, name: 'Valheim', cooptimusOnlineMax: 10, playerCount: null },
        ]);
        renderWithProviders(
            <NominateModal isOpen onClose={vi.fn()} lineupId={1} participantCount={4} />,
        );
        expect(screen.getByTestId('coop-max-badge')).toHaveTextContent('10');
    });

    it('lets a positive cooptimusOnlineMax WIN over a larger playerCount.max', () => {
        mockResults([
            {
                id: 42,
                name: 'Valheim',
                cooptimusOnlineMax: 2,
                playerCount: { min: 1, max: 16 },
            },
        ]);
        renderWithProviders(
            <NominateModal isOpen onClose={vi.fn()} lineupId={1} participantCount={4} />,
        );
        const badge = screen.getByTestId('coop-max-badge');
        expect(badge).toHaveTextContent('2');
        expect(badge).not.toHaveTextContent('16');
    });

    // Round 2: unverified games get NO badge. The IGDB playerCount is a
    // lobby-size estimate, not a co-op capability, so surfacing it as a
    // co-op number would be a lie the picker's filter doesn't tell.
    it('renders NO badge when cooptimusOnlineMax is null, whatever playerCount says', () => {
        mockResults([
            {
                id: 42,
                name: 'Valheim',
                cooptimusOnlineMax: null,
                playerCount: { min: 1, max: 8 },
            },
        ]);
        renderWithProviders(
            <NominateModal isOpen onClose={vi.fn()} lineupId={1} participantCount={4} />,
        );
        expect(screen.queryByTestId('coop-max-badge')).not.toBeInTheDocument();
    });

    it('does NOT warn for an unverified game even when the group is large', () => {
        mockResults([
            {
                id: 42,
                name: 'Valheim',
                cooptimusOnlineMax: null,
                playerCount: { min: 1, max: 2 },
            },
        ]);
        renderWithProviders(
            <NominateModal isOpen onClose={vi.fn()} lineupId={1} participantCount={8} />,
        );
        expect(screen.queryByText(/may not fit your group/i)).not.toBeInTheDocument();
    });

    // Operator-ratified 2026-08-20: a synced zero means "no online co-op",
    // so it resolves to 0 rather than falling through to the IGDB number —
    // the modal must agree with the picker's filter.
    it('treats cooptimusOnlineMax = 0 as "no online co-op" (real data, not absent)', () => {
        mockResults([
            {
                id: 42,
                name: 'Valheim',
                cooptimusOnlineMax: 0,
                playerCount: { min: 1, max: 6 },
            },
        ]);
        renderWithProviders(
            <NominateModal isOpen onClose={vi.fn()} lineupId={1} participantCount={4} />,
        );
        const badge = screen.getByTestId('coop-max-badge');
        expect(badge).toHaveTextContent(/no online co-op/i);
        expect(badge).not.toHaveTextContent('6');
    });

    it('warns for a zero-co-op game because the effective max is 0', () => {
        mockResults([
            {
                id: 42,
                name: 'Valheim',
                cooptimusOnlineMax: 0,
                playerCount: { min: 1, max: 6 },
            },
        ]);
        renderWithProviders(
            <NominateModal isOpen onClose={vi.fn()} lineupId={1} participantCount={4} />,
        );
        expect(
            screen.getByText(/may not fit your group of 4/i),
        ).toBeInTheDocument();
    });

    it('renders no badge when there is no co-op data at all', () => {
        mockResults([
            { id: 42, name: 'Valheim', cooptimusOnlineMax: null, playerCount: null },
        ]);
        renderWithProviders(
            <NominateModal isOpen onClose={vi.fn()} lineupId={1} participantCount={4} />,
        );
        expect(screen.queryByTestId('coop-max-badge')).not.toBeInTheDocument();
    });
});

describe('NominateModal — soft group-size warning (ROK-1400)', () => {
    it('warns when the effective online max is below the group size', () => {
        mockResults([
            { id: 42, name: 'Valheim', cooptimusOnlineMax: 2, playerCount: null },
        ]);
        renderWithProviders(
            <NominateModal isOpen onClose={vi.fn()} lineupId={1} participantCount={5} />,
        );
        expect(
            screen.getByText(/may not fit your group of 5/i),
        ).toBeInTheDocument();
    });

    it('does NOT warn when the effective online max meets the group size', () => {
        mockResults([
            { id: 42, name: 'Valheim', cooptimusOnlineMax: 5, playerCount: null },
        ]);
        renderWithProviders(
            <NominateModal isOpen onClose={vi.fn()} lineupId={1} participantCount={5} />,
        );
        expect(screen.queryByText(/may not fit your group/i)).not.toBeInTheDocument();
    });

    it('does NOT warn when participantCount is unknown', () => {
        mockResults([
            { id: 42, name: 'Valheim', cooptimusOnlineMax: 2, playerCount: null },
        ]);
        renderWithProviders(
            <NominateModal isOpen onClose={vi.fn()} lineupId={1} />,
        );
        expect(screen.queryByText(/may not fit your group/i)).not.toBeInTheDocument();
    });

    it('does NOT warn when there is no co-op data to compare against', () => {
        mockResults([
            { id: 42, name: 'Valheim', cooptimusOnlineMax: null, playerCount: null },
        ]);
        renderWithProviders(
            <NominateModal isOpen onClose={vi.fn()} lineupId={1} participantCount={5} />,
        );
        expect(screen.queryByText(/may not fit your group/i)).not.toBeInTheDocument();
    });

    it('warns only on the rows that are actually too small', () => {
        mockResults([
            { id: 42, name: 'Tiny Coop', cooptimusOnlineMax: 2, playerCount: null },
            { id: 43, name: 'Big Coop', cooptimusOnlineMax: 8, playerCount: null },
        ]);
        renderWithProviders(
            <NominateModal isOpen onClose={vi.fn()} lineupId={1} participantCount={5} />,
        );
        expect(screen.getAllByText(/may not fit your group of 5/i)).toHaveLength(1);
    });
});

describe('NominateModal — warning never blocks nomination (ROK-1400)', () => {
    it('keeps a warned game selectable and submittable', async () => {
        const user = userEvent.setup();
        mockResults([
            { id: 42, name: 'Tiny Coop', cooptimusOnlineMax: 2, playerCount: null },
        ]);
        renderWithProviders(
            <NominateModal isOpen onClose={vi.fn()} lineupId={7} participantCount={5} />,
        );

        // The warning is present but the row is still an enabled control.
        expect(screen.getByText(/may not fit your group of 5/i)).toBeInTheDocument();
        await user.click(screen.getByText('Tiny Coop'));

        const submit = screen.getByRole('button', { name: /submit nomination/i });
        expect(submit).toBeEnabled();
        await user.click(submit);

        expect(mockMutate).toHaveBeenCalledWith(
            expect.objectContaining({ lineupId: 7, body: { gameId: 42 } }),
            expect.any(Object),
        );
    });
});

/**
 * ROK-1401 round 3 regression guard.
 *
 * Round 3 rewrote the badge copy to come from the shared `coopLabel` helper,
 * whose `count` leads with the ONLINE max but falls back to the COUCH max.
 * The warning must NOT follow that fallback: "may not fit your group" is a
 * question about whether a distributed group can play together, and that is
 * answered by the online max alone. Keying it off the label's count silently
 * dropped ROK-1400's warning for local-only games with a big couch number.
 */
describe('NominateModal — the warning keys off ONLINE, not the label count (ROK-1401)', () => {
    it('still warns for a local-only game with a couch count above the group size', () => {
        mockResults([
            {
                id: 42,
                name: 'Couch Brawler',
                cooptimusOnlineMax: 0,
                cooptimusCouchMax: 8,
                cooptimusComboCoop: false,
                playerCount: null,
            },
        ]);
        renderWithProviders(
            <NominateModal isOpen onClose={vi.fn()} lineupId={1} participantCount={6} />,
        );
        // The badge tells the truth about the game (8 local seats)...
        expect(screen.getByTestId('coop-max-badge')).toHaveTextContent(
            /8 local co-op/i,
        );
        // ...and the warning still fires, because a remote group of 6 cannot
        // play a game with zero online co-op together.
        expect(
            screen.getByText(/may not fit your group of 6/i),
        ).toBeInTheDocument();
    });

    it('does NOT warn off a couch count when the game has no online data at all', () => {
        mockResults([
            {
                id: 43,
                name: 'Unsynced Couch Game',
                cooptimusOnlineMax: null,
                cooptimusCouchMax: 3,
                cooptimusComboCoop: false,
                playerCount: null,
            },
        ]);
        renderWithProviders(
            <NominateModal isOpen onClose={vi.fn()} lineupId={1} participantCount={5} />,
        );
        expect(screen.getByTestId('coop-max-badge')).toHaveTextContent(
            /3 local co-op/i,
        );
        // No online number means nothing to compare — ROK-1400's rule that an
        // absent max warns about nothing survives the label rework.
        expect(screen.queryByText(/may not fit your group/i)).not.toBeInTheDocument();
    });

    it('warns on the online max for a combo game whose couch count is larger', () => {
        mockResults([
            {
                id: 44,
                name: 'Combo Game',
                cooptimusOnlineMax: 2,
                cooptimusCouchMax: 8,
                cooptimusComboCoop: true,
                playerCount: null,
            },
        ]);
        renderWithProviders(
            <NominateModal isOpen onClose={vi.fn()} lineupId={1} participantCount={5} />,
        );
        expect(screen.getByTestId('coop-max-badge')).toHaveTextContent(
            /2 combo co-op/i,
        );
        expect(
            screen.getByText(/may not fit your group of 5/i),
        ).toBeInTheDocument();
    });

    it('shows a countless combo badge without inventing a warning', () => {
        mockResults([
            {
                id: 45,
                name: 'Countless Combo',
                cooptimusOnlineMax: null,
                cooptimusCouchMax: null,
                cooptimusComboCoop: true,
                playerCount: null,
            },
        ]);
        renderWithProviders(
            <NominateModal isOpen onClose={vi.fn()} lineupId={1} participantCount={5} />,
        );
        expect(screen.getByTestId('coop-max-badge')).toHaveTextContent(
            /combo co-op/i,
        );
        expect(screen.queryByText(/may not fit your group/i)).not.toBeInTheDocument();
    });
});
