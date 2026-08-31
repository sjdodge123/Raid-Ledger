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
import { createMockEntry } from '../../../../test/lineup-factories';

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
        // ROK-1444: early-advance target + its published denominator.
        nominationTargetPct: null,
        nominationCap: 20,
        nominationTargetDisarmedAt: null,
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
                screen.getByText(/0 \/ 20 nominated by 3 voters/i),
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
                screen.getByText(/0 \/ 20 nominated by 1 voter\b/i),
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

/**
 * ROK-1444 (Codex P2) — roster size for the co-op fit flags.
 *
 * Common Ground's `participantCount` only counts people who have already
 * nominated or voted, so a PUBLIC lineup seeded with explicit invitees
 * (ROK-1440) reported a group of 1 and stayed silent for a group of five.
 * The composite takes the larger of that count and `invitees + creator`.
 *
 * The MSW handler in `beforeEach` returns `participantCount: 5`; these cases
 * pin the invitee-driven path by asserting on the rendered flag.
 */
describe('NominatingComposite — roster-fit group size (ROK-1444)', () => {
    it('flags a nomination the invited roster has outgrown, before anyone nominates', async () => {
        const lineup = buildBuildingLineup({
            // Creator + 5 invitees = 6, larger than the game's 4-player co-op.
            invitees: [2, 3, 4, 5, 6].map((id) => ({
                id,
                displayName: `Invitee ${id}`,
                avatarUrl: null,
            })),
            entries: [createMockEntry({ cooptimusOnlineMax: 4 })],
        });

        renderWithProviders(
            <NominatingComposite lineup={lineup} canParticipate={true} />,
        );

        expect(
            await screen.findByTestId('nomination-fit-warning'),
        ).toHaveTextContent(/Fits 4 online · group is 6/);
    });

    it('leaves a game that still fits the invited roster unflagged', async () => {
        const lineup = buildBuildingLineup({
            invitees: [2, 3].map((id) => ({
                id,
                displayName: `Invitee ${id}`,
                avatarUrl: null,
            })),
            entries: [createMockEntry({ cooptimusOnlineMax: 8 })],
        });

        renderWithProviders(
            <NominatingComposite lineup={lineup} canParticipate={true} />,
        );

        await screen.findByRole('region', { name: /step 1 of 4 · nominating/i });
        expect(
            screen.queryByTestId('nomination-fit-warning'),
        ).not.toBeInTheDocument();
    });
});
