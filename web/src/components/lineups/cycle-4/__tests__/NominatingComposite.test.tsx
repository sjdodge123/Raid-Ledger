/**
 * Failing-first tests for NominatingComposite (ROK-1297, S1 Cycle 4).
 *
 * MUST fail with module-not-found until the dev creates
 * `web/src/components/lineups/cycle-4/NominatingComposite.tsx`. Assertions
 * pin the spec's JourneyHero wiring scenarios:
 *   - JourneyHero gets active=0 + tone="action" when the viewer has
 *     not yet submitted nominations.
 *   - Tone shifts to "waiting" when `viewerSubmissions.nominationsSubmittedAt`
 *     is set on the lineup detail.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { renderWithProviders } from '../../../../test/render-helpers';
import { server } from '../../../../test/mocks/server';
import type { LineupDetailResponseDto } from '@raid-ledger/contract';
import { NominatingComposite } from '../NominatingComposite';

const API_BASE = 'http://localhost:3000';

function buildBuildingLineup(
    overrides: Partial<LineupDetailResponseDto> = {},
): LineupDetailResponseDto {
    return {
        id: 7,
        title: 'Test Lineup',
        description: null,
        status: 'building',
        targetDate: null,
        decidedGameId: null,
        decidedGameName: null,
        linkedEventId: null,
        createdBy: { id: 1, displayName: 'Admin' },
        votingDeadline: null,
        phaseDeadline: '2026-05-19T00:00:00.000Z',
        pendingAdvanceAt: null,
        autoAdvancePausedAt: null,
        matchThreshold: 35,
        maxVotesPerPlayer: 3,
        defaultTiebreakerMode: null,
        entries: [],
        totalVoters: 5,
        totalMembers: 5,
        votingEligibleCount: 5,
        myVotes: [],
        unlinkedSteamCount: 0,
        unlinkedSteamMembers: [],
        createdAt: '2026-05-15T00:00:00.000Z',
        updatedAt: '2026-05-15T00:00:00.000Z',
        tiebreaker: null,
        channelOverrideId: null,
        channelOverrideName: null,
        visibility: 'public',
        invitees: [],
        stillWaitingOnVoters: [],
        publicShareEnabled: true,
        publicSlug: 'test-lineup',
        viewerSubmissions: {
            nominationsSubmittedAt: null,
            votesSubmittedAt: null,
        },
        ...overrides,
    };
}

beforeEach(() => {
    // Common Ground returns empty so the hero placeholder shows but the
    // composite still mounts.
    server.use(
        http.get(`${API_BASE}/lineups/common-ground`, () =>
            HttpResponse.json({
                data: [],
                meta: {
                    total: 0,
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
            }),
        ),
        http.get(`${API_BASE}/lineups/active`, () =>
            HttpResponse.json([]),
        ),
    );
});

describe('NominatingComposite — JourneyHero wiring (ROK-1297)', () => {
    it('renders JourneyHero with active=0 + tone="action" when the viewer has not submitted', async () => {
        const lineup = buildBuildingLineup();

        renderWithProviders(
            <NominatingComposite lineup={lineup} canParticipate={true} />,
        );

        // The hero region's accessible name encodes the step. JourneyHero
        // for the Nominating phase always renders the "Step 1 of 4 …
        // Nominating" badge per ROK-1294. Use that to confirm hero is up.
        const hero = await screen.findByRole('region', {
            name: /step 1 of 4 · nominating/i,
        });
        expect(hero).toBeInTheDocument();

        // tone="action" surfaces no completion pill (per JourneyHero
        // contract — the "You're done here" / "You're set" pills only
        // render for waiting / set tones).
        expect(
            screen.queryByText(/You're done here/i),
        ).not.toBeInTheDocument();
        expect(screen.queryByText(/You're set/i)).not.toBeInTheDocument();
    });

    // ROK-1348: the people-denominator in the hero sub-copy uses
    // votingEligibleCount (private = creator + invitees), NOT the
    // community-wide totalMembers, and no longer pairs the entry count
    // with the voter count.
    it('renders the eligible voter count in the hero copy for a private lineup', async () => {
        const lineup = buildBuildingLineup({
            visibility: 'private',
            totalMembers: 13,
            totalVoters: 0,
            votingEligibleCount: 3,
            entries: [],
        });

        renderWithProviders(
            <NominatingComposite lineup={lineup} canParticipate={true} />,
        );

        await waitFor(() => {
            expect(
                screen.getByText(/0 nominated by 3 voters/i),
            ).toBeInTheDocument();
        });
        // The community-wide count must NOT leak into the copy.
        expect(screen.queryByText(/by 13 voters/i)).not.toBeInTheDocument();
    });

    it('uses the singular "voter" when only one is eligible', async () => {
        const lineup = buildBuildingLineup({
            visibility: 'private',
            votingEligibleCount: 1,
            entries: [],
        });

        renderWithProviders(
            <NominatingComposite lineup={lineup} canParticipate={true} />,
        );

        await waitFor(() => {
            expect(
                screen.getByText(/0 nominated by 1 voter\b/i),
            ).toBeInTheDocument();
        });
    });

    it('shifts JourneyHero tone to "waiting" when nominationsSubmittedAt is set', async () => {
        const lineup = buildBuildingLineup({
            viewerSubmissions: {
                nominationsSubmittedAt: '2026-05-17T10:00:00.000Z',
                votesSubmittedAt: null,
            },
        });

        renderWithProviders(
            <NominatingComposite lineup={lineup} canParticipate={true} />,
        );

        await waitFor(() => {
            // tone="waiting" → JourneyHero renders the "✓ You're done here"
            // completion pill (ROK-1294 contract).
            expect(screen.getByText(/You're done here/i)).toBeInTheDocument();
        });
    });
});
