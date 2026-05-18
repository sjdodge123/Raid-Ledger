/**
 * Failing-first tests for VotingComposite (ROK-1298, Sv).
 *
 * Source file does not yet exist — these MUST fail with module-not-found
 * until the dev creates
 * `web/src/components/lineups/cycle-4/VotingComposite.tsx`.
 *
 * Covered ACs (from docs/specs/rok-1298-sv-voting-composite.md):
 *
 *  AC1 — JourneyHero rendered with active=1 + tone='action'
 *        (no submit yet) — and shifts to tone='waiting' once
 *        viewerSubmissions.votesSubmittedAt is set.
 *  AC5 — "X of N votes used" pill above the leaderboard.
 *  AC6 — SubmitBar at the bottom with the 4 kinds (empty / partial /
 *        pre / post) driven by deriveSubmitKind.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { LineupDetailResponseDto } from '@raid-ledger/contract';
import { renderWithProviders } from '../../../../test/render-helpers';
import { server } from '../../../../test/mocks/server';
import { VotingComposite } from '../VotingComposite';

const API_BASE = 'http://localhost:3000';

interface VotingLineupOverrides extends Partial<LineupDetailResponseDto> {
    votingEligibleCount?: number;
}

function buildVotingLineup(
    overrides: VotingLineupOverrides = {},
): LineupDetailResponseDto {
    const base: LineupDetailResponseDto = {
        id: 7,
        title: 'Sv Voting Lineup',
        description: null,
        status: 'voting',
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
        entries: [
            {
                id: 1,
                gameId: 42,
                gameName: 'Valheim',
                gameCoverUrl: null,
                nominatedBy: { id: 1, displayName: 'Admin' },
                note: null,
                carriedOver: false,
                voteCount: 1,
                createdAt: '2026-05-15T00:00:00.000Z',
                ownerCount: 8,
                totalMembers: 12,
                nonOwnerCount: 4,
                wishlistCount: 0,
                itadCurrentPrice: null,
                itadCurrentCut: null,
                itadCurrentShop: null,
                itadCurrentUrl: null,
                playerCount: null,
            },
        ],
        totalVoters: 1,
        totalMembers: 12,
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
        publicSlug: 'sv-voting-lineup',
        viewerSubmissions: {
            nominationsSubmittedAt: null,
            votesSubmittedAt: null,
        },
    };
    // Inject the new ROK-1298 field; not yet in the DTO type but is on the
    // runtime response shape.
    return { ...base, ...overrides } as LineupDetailResponseDto & {
        votingEligibleCount: number;
    };
}

beforeEach(() => {
    server.use(
        http.get(`${API_BASE}/lineups/active`, () => HttpResponse.json([])),
    );
});

// ─────────────────────────────────────────────────────────────────────
// AC1 — JourneyHero wiring (active=1, tone shifts on submit)
// ─────────────────────────────────────────────────────────────────────

describe('VotingComposite — JourneyHero wiring (AC1)', () => {
    it('renders the JourneyHero region for the Voting step (active=1)', async () => {
        const lineup = buildVotingLineup({ votingEligibleCount: 12 });
        renderWithProviders(
            <VotingComposite lineup={lineup} canParticipate={true} />,
        );

        // JourneyHero exposes role="region" with aria-labelledby pointing
        // to the badge text. For Sv the badge must encode "Step 2 of 4 ·
        // Voting" (active=1 of the 4-phase ribbon).
        const hero = await screen.findByRole('region', {
            name: /step 2 of 4 · voting/i,
        });
        expect(hero).toBeInTheDocument();
    });

    it('tone="action" before submit — no "you\'re done here" completion pill', async () => {
        const lineup = buildVotingLineup({
            votingEligibleCount: 12,
            viewerSubmissions: {
                nominationsSubmittedAt: null,
                votesSubmittedAt: null,
            },
        });
        renderWithProviders(
            <VotingComposite lineup={lineup} canParticipate={true} />,
        );

        await screen.findByRole('region', { name: /step 2 of 4 · voting/i });
        // tone="action" → JourneyHero does NOT render the "You're done
        // here" pill (which is the tone="waiting" signal per JourneyHero).
        expect(
            screen.queryByText(/You're done here/i),
        ).not.toBeInTheDocument();
    });

    it('tone shifts to "waiting" once votesSubmittedAt is set', async () => {
        const lineup = buildVotingLineup({
            votingEligibleCount: 12,
            viewerSubmissions: {
                nominationsSubmittedAt: null,
                votesSubmittedAt: '2026-05-17T10:00:00.000Z',
            },
        });
        renderWithProviders(
            <VotingComposite lineup={lineup} canParticipate={true} />,
        );

        await waitFor(() => {
            expect(
                screen.getByText(/You're done here/i),
            ).toBeInTheDocument();
        });
    });
});

// ─────────────────────────────────────────────────────────────────────
// AC5 — "X of N votes used" pill
// ─────────────────────────────────────────────────────────────────────

describe('VotingComposite — votes-used pill (AC5)', () => {
    it('renders an "X of N votes used" status pill above the leaderboard', async () => {
        const lineup = buildVotingLineup({
            votingEligibleCount: 12,
            myVotes: [42],
            maxVotesPerPlayer: 3,
        });
        renderWithProviders(
            <VotingComposite lineup={lineup} canParticipate={true} />,
        );

        // Per spec §Accessibility: pill is `role="status"` +
        // `aria-live="polite"`. Copy is "X of N votes used".
        await waitFor(() => {
            const pill = screen.getByText(/1 of 3 votes used/i);
            expect(pill).toBeInTheDocument();
        });
    });

    it('zero-state — "0 of 3 votes used"', async () => {
        const lineup = buildVotingLineup({
            votingEligibleCount: 12,
            myVotes: [],
            maxVotesPerPlayer: 3,
        });
        renderWithProviders(
            <VotingComposite lineup={lineup} canParticipate={true} />,
        );

        await waitFor(() => {
            expect(screen.getByText(/0 of 3 votes used/i)).toBeInTheDocument();
        });
    });
});

// ─────────────────────────────────────────────────────────────────────
// AC6 — SubmitBar 4 kinds via deriveSubmitKind
// ─────────────────────────────────────────────────────────────────────

describe('VotingComposite — SubmitBar 4 kinds (AC6)', () => {
    it('kind=empty when no votes cast (button is disabled)', async () => {
        const lineup = buildVotingLineup({
            votingEligibleCount: 12,
            myVotes: [],
            maxVotesPerPlayer: 3,
        });
        renderWithProviders(
            <VotingComposite lineup={lineup} canParticipate={true} />,
        );

        await waitFor(() => {
            const btn = screen.getByRole('button', { name: /submit/i });
            expect(btn).toBeDisabled();
        });
    });

    it('kind=partial when some votes cast but not all', async () => {
        const lineup = buildVotingLineup({
            votingEligibleCount: 12,
            myVotes: [42],
            maxVotesPerPlayer: 3,
        });
        renderWithProviders(
            <VotingComposite lineup={lineup} canParticipate={true} />,
        );

        await waitFor(() => {
            const btn = screen.getByRole('button', { name: /submit/i });
            expect(btn).not.toBeDisabled();
        });
    });

    it('kind=pre when all 3 votes used (full allotment, not yet submitted)', async () => {
        const lineup = buildVotingLineup({
            votingEligibleCount: 12,
            myVotes: [42, 43, 44],
            maxVotesPerPlayer: 3,
        });
        renderWithProviders(
            <VotingComposite lineup={lineup} canParticipate={true} />,
        );

        // kind=pre primary CTA. Copy includes "Submit my votes" per spec.
        await waitFor(() => {
            const btn = screen.getByRole('button', { name: /Submit my votes/i });
            expect(btn).not.toBeDisabled();
        });
    });

    it('kind=post when votesSubmittedAt is set — ghost "Change my votes" CTA', async () => {
        const lineup = buildVotingLineup({
            votingEligibleCount: 12,
            myVotes: [42, 43, 44],
            maxVotesPerPlayer: 3,
            viewerSubmissions: {
                nominationsSubmittedAt: null,
                votesSubmittedAt: '2026-05-17T10:00:00.000Z',
            },
        });
        renderWithProviders(
            <VotingComposite lineup={lineup} canParticipate={true} />,
        );

        await waitFor(() => {
            // kind=post — ghost CTA reading "Change my votes" per spec.
            const btn = screen.getByRole('button', {
                name: /Change my votes/i,
            });
            expect(btn).not.toBeDisabled();
        });
    });
});
