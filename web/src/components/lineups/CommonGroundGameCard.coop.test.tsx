/**
 * Co-op pill on the Common Ground nominate tiles (ROK-1401).
 *
 * The pill joins the existing "N own · N-M players" badge row. It is
 * Co-Optimus-verified only: a positive `cooptimusOnlineMax` renders it, `0`
 * and `null` render no element at all — and critically, an IGDB
 * `playerCount` of 100 must NOT manufacture one (a lobby size is not a co-op
 * capability).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { CommonGroundGameDto } from '@raid-ledger/contract';
import { CommonGroundGameCard } from './CommonGroundGameCard';

const PILL = 'coop-pill';

function buildGame(
    overrides: Partial<CommonGroundGameDto> = {},
): CommonGroundGameDto {
    return {
        gameId: 42,
        gameName: 'Valheim',
        slug: 'valheim',
        coverUrl: null,
        ownerCount: 5,
        wishlistCount: 0,
        nonOwnerPrice: null,
        itadCurrentCut: null,
        itadCurrentShop: null,
        itadCurrentUrl: null,
        earlyAccess: false,
        itadTags: [],
        playerCount: { min: 1, max: 10 },
        cooptimusOnlineMax: null,
        cooptimusCouchMax: null,
        cooptimusComboCoop: null,
        score: 85,
        ...overrides,
    };
}

function renderCard(game: CommonGroundGameDto) {
    return render(
        <CommonGroundGameCard
            game={game}
            onNominate={vi.fn()}
            isNominating={false}
            atCap={false}
        />,
    );
}

describe('CommonGroundGameCard — co-op pill present when enriched', () => {
    it('renders the pill alongside the owner and player badges', () => {
        renderCard(buildGame({ cooptimusOnlineMax: 4 }));
        expect(screen.getByTestId(PILL)).toHaveTextContent('👥 4 online co-op');
        // The pill augments the existing row; it never replaces it.
        expect(screen.getByText('5 own')).toBeInTheDocument();
        expect(screen.getByText(/1-10 players/)).toBeInTheDocument();
    });

    it('uses the raw co-op cap, not the IGDB player max', () => {
        renderCard(
            buildGame({
                cooptimusOnlineMax: 4,
                playerCount: { min: 1, max: 100 },
            }),
        );
        expect(screen.getByTestId(PILL)).toHaveTextContent('👥 4 online co-op');
    });

    it('threads the couch count and combo flag from the row DTO', () => {
        // ROK-1401 round 3: both ride the Common Ground row additively.
        renderCard(
            buildGame({
                cooptimusOnlineMax: 4,
                cooptimusCouchMax: 2,
                cooptimusComboCoop: true,
            }),
        );
        expect(screen.getByTestId(PILL)).toHaveTextContent('👥 4 combo co-op');
    });

    it('renders a local pill for a couch-only row', () => {
        renderCard(
            buildGame({ cooptimusOnlineMax: 0, cooptimusCouchMax: 4 }),
        );
        expect(screen.getByTestId(PILL)).toHaveTextContent('👥 4 local co-op');
    });
});

describe('CommonGroundGameCard — co-op pill absent, no layout hole', () => {
    function expectPillDisappears(game: CommonGroundGameDto) {
        const { rerender } = renderCard(buildGame({ cooptimusOnlineMax: 4 }));
        expect(screen.getByTestId(PILL)).toBeInTheDocument();
        rerender(
            <CommonGroundGameCard
                game={game}
                onNominate={vi.fn()}
                isNominating={false}
                atCap={false}
            />,
        );
        expect(screen.queryByTestId(PILL)).toBeNull();
    }

    it('renders no pill when cooptimusOnlineMax is null', () => {
        expectPillDisappears(buildGame({ cooptimusOnlineMax: null }));
    });

    it('renders no pill when cooptimusOnlineMax is 0', () => {
        expectPillDisappears(buildGame({ cooptimusOnlineMax: 0 }));
    });

    it('never falls back to a 100-player IGDB lobby', () => {
        expectPillDisappears(
            buildGame({
                cooptimusOnlineMax: null,
                playerCount: { min: 1, max: 100 },
            }),
        );
        expect(screen.queryByText(/co-op/i)).toBeNull();
        // The rest of the badge row is untouched.
        expect(screen.getByText('5 own')).toBeInTheDocument();
        expect(screen.getByText(/1-100 players/)).toBeInTheDocument();
    });
});
