/**
 * ROK-1314 — the two game-card surfaces must not read as different components.
 *
 * Operator, 2026-09-01: *"The whole point of this story is to unify the
 * systems. I dont want the surfaces looking distinct."*
 *
 * The `/games` card (`UnifiedGameCard`) and the Common Ground tile
 * (`CommonGroundGameCard`) take DIFFERENT DTOs and live in different folders,
 * which is exactly how they drifted apart in the first place: one rendered a
 * genre pill, a cover rating badge and a rating/mode info bar while the other
 * rendered none of them, and one used a local `CoopBadge` while the other used
 * the shared `CoopPill`.
 *
 * This pins the OUTCOME rather than the implementation: fed equivalent data,
 * both cards must surface the same badge vocabulary. It is deliberately about
 * presence of the shared chrome, not pixel layout — the two cards legitimately
 * differ in size, border and the nominate overlay.
 */
import { describe, it, expect, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import type { CommonGroundGameDto } from '@raid-ledger/contract';
import { renderWithProviders } from '../../test/render-helpers';
import { UnifiedGameCard } from './unified-game-card';
import { CommonGroundGameCard } from '../lineups/CommonGroundGameCard';

/** One game, expressed in each surface's own DTO. */
const SHARED_CHROME = {
    genres: [12],
    gameModes: [1],
    rating: 70,
    aggregatedRating: 93,
    playerCount: { min: 1, max: 40 },
    cooptimusOnlineMax: 4,
    cooptimusCouchMax: null,
    cooptimusComboCoop: null,
    currentUserOwns: true,
    currentUserWishlisted: true,
    earlyAccess: true,
    ownerCount: 70,
    wishlistCount: 3,
};

function renderGamesCard() {
    return renderWithProviders(
        <UnifiedGameCard
            variant="link"
            showRating
            game={{
                id: 1,
                name: 'Valheim',
                slug: 'valheim',
                coverUrl: null,
                ...SHARED_CHROME,
            }}
        />,
    );
}

function renderCommonGroundTile() {
    const game = {
        gameId: 1,
        gameName: 'Valheim',
        slug: 'valheim',
        coverUrl: null,
        nonOwnerPrice: null,
        itadCurrentCut: null,
        itadCurrentShop: null,
        itadCurrentUrl: null,
        itadTags: [],
        score: 0,
        ...SHARED_CHROME,
    } as unknown as CommonGroundGameDto;
    return renderWithProviders(
        <CommonGroundGameCard
            game={game}
            onNominate={vi.fn()}
            isNominating={false}
            atCap={false}
        />,
    );
}

/** Chrome both surfaces must show for the same game. */
const SHARED_SIGNALS: Array<[string, RegExp]> = [
    ['genre pill', /^RPG$/],
    ['owner aggregate', /^70 own$/],
    ['viewer owns pill', /^You own$/],
    ['viewer wishlisted pill', /^You wishlisted$/],
    ['player count', /^1-40 players$/],
    ['early access', /^Early Access$/],
];

describe('ROK-1314 — /games card and Common Ground tile render one system', () => {
    it.each(SHARED_SIGNALS)(
        'the /games card shows the %s',
        (_label, pattern) => {
            renderGamesCard();
            expect(screen.getByText(pattern)).toBeInTheDocument();
        },
    );

    it.each(SHARED_SIGNALS)(
        'the Common Ground tile shows the %s',
        (_label, pattern) => {
            renderCommonGroundTile();
            expect(screen.getByText(pattern)).toBeInTheDocument();
        },
    );

    it('both render the cover rating badge, preferring aggregatedRating', () => {
        const games = renderGamesCard();
        expect(
            within(games.container).getByLabelText('Rating 93'),
        ).toBeInTheDocument();
        games.unmount();

        const cg = renderCommonGroundTile();
        expect(
            within(cg.container).getByLabelText('Rating 93'),
        ).toBeInTheDocument();
    });

    it('both render exactly ONE co-op element, and it is the shared pill', () => {
        // The old local CoopBadge (data-testid="card-coop-badge") is gone; if it
        // ever comes back alongside the pill, a card shows co-op twice.
        const games = renderGamesCard();
        expect(
            games.container.querySelectorAll('[data-testid="coop-pill"]'),
        ).toHaveLength(1);
        expect(
            games.container.querySelectorAll('[data-testid="card-coop-badge"]'),
        ).toHaveLength(0);
        games.unmount();

        const cg = renderCommonGroundTile();
        expect(
            cg.container.querySelectorAll('[data-testid="coop-pill"]'),
        ).toHaveLength(1);
        expect(
            cg.container.querySelectorAll('[data-testid="card-coop-badge"]'),
        ).toHaveLength(0);
    });
});
