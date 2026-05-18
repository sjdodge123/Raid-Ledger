/**
 * Failing-first tests for CommonGroundHero (ROK-1297, S1 Cycle 4).
 *
 * MUST fail with module-not-found until the dev creates
 * `web/src/components/lineups/cycle-4/CommonGroundHero.tsx`. Once the
 * component exists, these assertions pin the spec's behaviour scenarios:
 *   - 3 themed rows × 4 tiles given a themed Common Ground response.
 *   - Single un-themed row fallback when `theme` is absent on all tiles.
 *   - Per-tile `+ Nominate` button fires the nominate handler.
 *   - Tile body click (anywhere except the button) opens the drawer.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { renderWithProviders } from '../../../../test/render-helpers';
import { server } from '../../../../test/mocks/server';
import type { CommonGroundGameDto } from '@raid-ledger/contract';
import { CommonGroundHero } from '../CommonGroundHero';

const API_BASE = 'http://localhost:3000';

function buildTile(
    overrides: Partial<CommonGroundGameDto> = {},
): CommonGroundGameDto {
    return {
        gameId: 1,
        gameName: 'Valheim',
        slug: 'valheim',
        coverUrl: null,
        ownerCount: 3,
        wishlistCount: 0,
        nonOwnerPrice: null,
        itadCurrentCut: null,
        itadCurrentShop: null,
        itadCurrentUrl: null,
        earlyAccess: false,
        itadTags: [],
        playerCount: null,
        score: 30,
        ...overrides,
    };
}

function buildThemedTiles(): CommonGroundGameDto[] {
    const themes: Array<{ theme: 'owned' | 'taste' | 'trending'; why: string }> =
        [
            { theme: 'owned', why: 'owned-why' },
            { theme: 'taste', why: 'taste-why' },
            { theme: 'trending', why: 'trending-why' },
        ];
    const tiles: CommonGroundGameDto[] = [];
    let gid = 1;
    for (const t of themes) {
        for (let i = 0; i < 4; i++) {
            tiles.push(
                buildTile({
                    gameId: gid,
                    gameName: `${t.theme}-game-${i}`,
                    slug: `${t.theme}-${i}`,
                    theme: t.theme,
                    whyReason: `${t.why}-${i}`,
                }),
            );
            gid++;
        }
    }
    return tiles;
}

function commonGroundResponse(tiles: CommonGroundGameDto[]) {
    return {
        data: tiles,
        meta: {
            total: tiles.length,
            appliedWeights: {
                ownerWeight: 10,
                saleBonus: 5,
                fullPricePenalty: -2,
                tasteWeight: 8,
                socialWeight: 8,
                intensityWeight: 4,
            },
            activeLineupId: 7,
            nominatedCount: 0,
            maxNominations: 20,
            participantCount: 5,
        },
    };
}

beforeEach(() => {
    // Default: provide the active building lineup so the inner hooks
    // resolve. Individual tests override `/lineups/common-ground` as
    // needed.
    server.use(
        http.get(`${API_BASE}/lineups/active`, () =>
            HttpResponse.json([
                {
                    id: 7,
                    title: 'Test Lineup',
                    status: 'building',
                    targetDate: null,
                    entryCount: 0,
                    totalVoters: 0,
                    createdAt: '2026-05-17T00:00:00.000Z',
                    visibility: 'public',
                    publicShareEnabled: true,
                    publicSlug: 'test-lineup',
                },
            ]),
        ),
    );
});

describe('CommonGroundHero — themed layout (ROK-1297)', () => {
    it('renders 3 themed rows × 4 tiles (12 total) given a themed response', async () => {
        server.use(
            http.get(`${API_BASE}/lineups/common-ground`, () =>
                HttpResponse.json(commonGroundResponse(buildThemedTiles())),
            ),
        );

        renderWithProviders(
            <CommonGroundHero
                lineupId={7}
                canParticipate={true}
                onTileNominate={vi.fn()}
                onTileOpenDrawer={vi.fn()}
            />,
        );

        // 3 themed-row regions, each with role=region + aria-label
        // matching the theme name.
        await waitFor(() => {
            expect(
                screen.getByRole('region', { name: /owned/i }),
            ).toBeInTheDocument();
        });
        expect(screen.getByRole('region', { name: /taste/i })).toBeInTheDocument();
        expect(
            screen.getByRole('region', { name: /trending/i }),
        ).toBeInTheDocument();

        // 4 tiles per row × 3 rows = 12 nominate buttons.
        const nominateBtns = screen.getAllByRole('button', {
            name: /nominate /i,
        });
        expect(nominateBtns).toHaveLength(12);
    });

    it('renders the per-tile ★ whyReason annotation for each themed tile', async () => {
        server.use(
            http.get(`${API_BASE}/lineups/common-ground`, () =>
                HttpResponse.json(commonGroundResponse(buildThemedTiles())),
            ),
        );

        renderWithProviders(
            <CommonGroundHero
                lineupId={7}
                canParticipate={true}
                onTileNominate={vi.fn()}
                onTileOpenDrawer={vi.fn()}
            />,
        );

        await waitFor(() => {
            expect(screen.getByText(/owned-why-0/)).toBeInTheDocument();
        });
        expect(screen.getByText(/taste-why-2/)).toBeInTheDocument();
        expect(screen.getByText(/trending-why-3/)).toBeInTheDocument();
    });
});

describe('CommonGroundHero — legacy fallback (ROK-1297)', () => {
    it('falls back to a single un-themed row when all tiles have theme=undefined', async () => {
        const tiles = Array.from({ length: 12 }, (_, i) =>
            buildTile({ gameId: i + 1, gameName: `game-${i}`, slug: `g-${i}` }),
        );
        server.use(
            http.get(`${API_BASE}/lineups/common-ground`, () =>
                HttpResponse.json(commonGroundResponse(tiles)),
            ),
        );

        renderWithProviders(
            <CommonGroundHero
                lineupId={7}
                canParticipate={true}
                onTileNominate={vi.fn()}
                onTileOpenDrawer={vi.fn()}
            />,
        );

        await waitFor(() => {
            expect(screen.getAllByRole('button', { name: /nominate /i })).toHaveLength(12);
        });
        // No themed-row aria-labels.
        expect(screen.queryByRole('region', { name: /owned/i })).not.toBeInTheDocument();
        expect(screen.queryByRole('region', { name: /taste/i })).not.toBeInTheDocument();
        expect(screen.queryByRole('region', { name: /trending/i })).not.toBeInTheDocument();
    });
});

describe('CommonGroundHero — interactions (ROK-1297)', () => {
    it('per-tile + Nominate button fires onTileNominate with gameId', async () => {
        server.use(
            http.get(`${API_BASE}/lineups/common-ground`, () =>
                HttpResponse.json(
                    commonGroundResponse([
                        buildTile({
                            gameId: 42,
                            gameName: 'Subnautica',
                            slug: 'subnautica',
                            theme: 'taste',
                            whyReason: 'Matches your sci-fi cluster',
                        }),
                    ]),
                ),
            ),
        );

        const onTileNominate = vi.fn();
        const onTileOpenDrawer = vi.fn();

        renderWithProviders(
            <CommonGroundHero
                lineupId={7}
                canParticipate={true}
                onTileNominate={onTileNominate}
                onTileOpenDrawer={onTileOpenDrawer}
            />,
        );

        const btn = await screen.findByRole('button', {
            name: /nominate subnautica/i,
        });
        await userEvent.click(btn);

        expect(onTileNominate).toHaveBeenCalledWith(42);
        expect(onTileOpenDrawer).not.toHaveBeenCalled();
    });

    it('tile body click opens the drawer (not nominate)', async () => {
        server.use(
            http.get(`${API_BASE}/lineups/common-ground`, () =>
                HttpResponse.json(
                    commonGroundResponse([
                        buildTile({
                            gameId: 99,
                            gameName: 'Hades',
                            slug: 'hades',
                            theme: 'owned',
                            whyReason: '5 of you own this',
                        }),
                    ]),
                ),
            ),
        );

        const onTileNominate = vi.fn();
        const onTileOpenDrawer = vi.fn();

        renderWithProviders(
            <CommonGroundHero
                lineupId={7}
                canParticipate={true}
                onTileNominate={onTileNominate}
                onTileOpenDrawer={onTileOpenDrawer}
            />,
        );

        // The tile body acts as a button via role="button" + aria-label.
        const tileBody = await screen.findByRole('button', {
            name: /open details for hades/i,
        });
        await userEvent.click(tileBody);

        expect(onTileOpenDrawer).toHaveBeenCalledWith(99);
        expect(onTileNominate).not.toHaveBeenCalled();
    });
});
