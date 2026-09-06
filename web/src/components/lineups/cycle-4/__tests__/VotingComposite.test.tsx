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
import { screen, waitFor, within } from '@testing-library/react';
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
                starCount: null,
            },
        ],
        totalVoters: 1,
        totalMembers: 12,
        myVotes: [],
        myTopPickGameId: null,
        decisionReason: null,
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
        expect(screen.queryByText(/You're done here/i)).not.toBeInTheDocument();
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
            expect(screen.getByText(/You're done here/i)).toBeInTheDocument();
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
            const btn = screen.getByRole('button', {
                name: /Submit my votes/i,
            });
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

// ─────────────────────────────────────────────────────────────────────
// Operator review 2026-05-19: post-submit dirty-state must auto-unlock
// the SubmitBar AND clear the "You're done voting" hero copy.
// ─────────────────────────────────────────────────────────────────────

describe('VotingComposite — post-submit dirty state', () => {
    it('clicking "Change my votes" flips kind=post → kind=partial without hitting the server', async () => {
        const user = (
            await import('@testing-library/user-event')
        ).default.setup();
        const lineup = buildVotingLineup({
            votingEligibleCount: 12,
            myVotes: [42, 43],
            maxVotesPerPlayer: 3,
            viewerSubmissions: {
                nominationsSubmittedAt: null,
                votesSubmittedAt: '2026-05-17T10:00:00.000Z',
            },
        });
        renderWithProviders(
            <VotingComposite lineup={lineup} canParticipate={true} />,
        );

        // Initially in post state.
        const postBtn = await screen.findByRole('button', {
            name: /Change my votes/i,
        });
        expect(postBtn).toBeVisible();

        await user.click(postBtn);

        // After click: SubmitBar re-arms to partial (2/3 selected) and the
        // hero loses its "You're done voting" copy.
        await waitFor(() => {
            expect(
                screen.getByRole('button', { name: /Submit my votes/i }),
            ).toBeVisible();
        });
        expect(screen.queryByText(/done voting/i)).not.toBeInTheDocument();
    });
});

// ─────────────────────────────────────────────────────────────────────
// ROK-1374 — a tie hold closes the vote (operator test, 2026-09-05)
// ─────────────────────────────────────────────────────────────────────

describe('VotingComposite — a tie hold closes the vote (ROK-1374)', () => {
    const hold = {
        lineupId: 7,
        status: 'awaiting_pick',
        voteCount: 1,
        games: [],
        rosterSize: 2,
        expiresAt: null,
        pick: null,
        canPick: false,
        pickerName: 'Roknua',
        viewerSpeedMbps: null,
        viewerSpeedMeasuredAt: null,
    };

    /** The one leaderboard row (Valheim) — its vote button, not the cover. */
    function valheimVoteButton(): HTMLElement {
        const row = document.querySelector('[data-voted]');
        if (!(row instanceof HTMLElement))
            throw new Error('no leaderboard row');
        return within(row).getByRole('button', { name: /vote/i });
    }

    it('disables submit and the vote rows, and says who picks', async () => {
        server.use(
            http.get(`${API_BASE}/lineups/7/tie-readiness`, () =>
                HttpResponse.json(hold),
            ),
        );
        const lineup = buildVotingLineup({
            myVotes: [42],
            maxVotesPerPlayer: 3,
        });
        renderWithProviders(
            <VotingComposite lineup={lineup} canParticipate={true} />,
        );

        expect(
            await screen.findByTestId('voting-hold-notice'),
        ).toHaveTextContent(/Roknua picks/);
        expect(screen.getByText('Voting closed on a tie.')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /submit/i })).toBeDisabled();
        expect(valheimVoteButton()).toBeDisabled();
    });

    it('keeps the vote open when the lineup has no hold (404 → null)', async () => {
        const lineup = buildVotingLineup({
            myVotes: [42],
            maxVotesPerPlayer: 3,
        });
        renderWithProviders(
            <VotingComposite lineup={lineup} canParticipate={true} />,
        );

        await waitFor(() => {
            expect(
                screen.getByRole('button', { name: /submit/i }),
            ).toBeEnabled();
        });
        expect(screen.queryByTestId('voting-hold-notice')).toBeNull();
        expect(valheimVoteButton()).toBeEnabled();
    });
});

// ─────────────────────────────────────────────────────────────────────
// ROK-1474 — the starred ballot. The star lives inside the existing voting
// row; the composite owns the mutation (via use-star-vote) and nothing else.
// Operator ruling 2026-09-05: stars are PRIVATE until the outcome.
// ─────────────────────────────────────────────────────────────────────

describe('VotingComposite — the top-pick star (ROK-1474)', () => {
    /** Two-entry lineup so "the star moves" is observable. */
    function twoEntryLineup(
        overrides: VotingLineupOverrides = {},
    ): LineupDetailResponseDto {
        const base = buildVotingLineup({ votingEligibleCount: 12 });
        const [first] = base.entries;
        return buildVotingLineup({
            votingEligibleCount: 12,
            entries: [
                first,
                {
                    ...first,
                    id: 2,
                    gameId: 43,
                    gameName: 'Elden Ring',
                    voteCount: 1,
                },
            ],
            ...overrides,
        });
    }

    // The star's verb inverts on the viewer's own pick ("Mark" → "Clear"),
    // so the row anchor accepts either; the assertions still address one
    // named row.
    function starFor(gameName: string): HTMLElement {
        return screen.getByRole('button', {
            name: new RegExp(`(Mark|Clear) ${gameName} as your top pick`),
        });
    }

    it('posts the starred game to /lineups/:id/star exactly once', async () => {
        const user = (
            await import('@testing-library/user-event')
        ).default.setup();
        const bodies: unknown[] = [];
        const lineup = twoEntryLineup();
        server.use(
            http.post(`${API_BASE}/lineups/7/star`, async ({ request }) => {
                bodies.push(await request.json());
                return HttpResponse.json({ ...lineup, myTopPickGameId: 42 });
            }),
        );
        renderWithProviders(
            <VotingComposite lineup={lineup} canParticipate={true} />,
        );

        await user.click(starFor('Valheim'));

        await waitFor(() => expect(bodies).toEqual([{ gameId: 42 }]));
    });

    it('moves the star to the newly starred game in the rendered state', async () => {
        const user = (
            await import('@testing-library/user-event')
        ).default.setup();
        const lineup = twoEntryLineup({ myTopPickGameId: 42 });
        server.use(
            http.post(`${API_BASE}/lineups/7/star`, () =>
                HttpResponse.json({ ...lineup, myTopPickGameId: 43 }),
            ),
        );
        renderWithProviders(
            <VotingComposite lineup={lineup} canParticipate={true} />,
        );

        expect(starFor('Valheim')).toHaveAttribute('aria-pressed', 'true');
        await user.click(starFor('Elden Ring'));

        // One star per voter: the new pick is pressed and the old one is not.
        await waitFor(() =>
            expect(starFor('Elden Ring')).toHaveAttribute(
                'aria-pressed',
                'true',
            ),
        );
        expect(starFor('Valheim')).toHaveAttribute('aria-pressed', 'false');
    });

    it('clears the star by sending an explicit null when the pick is re-clicked', async () => {
        const user = (
            await import('@testing-library/user-event')
        ).default.setup();
        const bodies: unknown[] = [];
        const lineup = twoEntryLineup({ myTopPickGameId: 42 });
        server.use(
            http.post(`${API_BASE}/lineups/7/star`, async ({ request }) => {
                bodies.push(await request.json());
                return HttpResponse.json({
                    ...lineup,
                    myTopPickGameId: null,
                });
            }),
        );
        renderWithProviders(
            <VotingComposite lineup={lineup} canParticipate={true} />,
        );

        await user.click(starFor('Valheim'));

        await waitFor(() => expect(bodies).toEqual([{ gameId: null }]));
        expect(starFor('Valheim')).toHaveAttribute('aria-pressed', 'false');
    });

    it('discloses no star counts anywhere on an open ballot', async () => {
        const lineup = twoEntryLineup({ myTopPickGameId: 42 });
        const { container } = renderWithProviders(
            <VotingComposite lineup={lineup} canParticipate={true} />,
        );

        await screen.findByTestId('voting-leaderboard-v2');
        // Stars are private until the outcome: no tally element, and no digit
        // inside any star control. A count here would be a live-tally leak.
        expect(container.querySelector('[data-testid="star-count"]')).toBeNull();
        for (const star of screen.getAllByTestId('star-toggle')) {
            expect(star.textContent ?? '').not.toMatch(/\d/);
        }
    });

    it('disables every star control while a tie hold is open', async () => {
        server.use(
            http.get(`${API_BASE}/lineups/7/tie-readiness`, () =>
                HttpResponse.json({
                    lineupId: 7,
                    status: 'awaiting_pick',
                    voteCount: 1,
                    games: [],
                    rosterSize: 2,
                    expiresAt: null,
                    pick: null,
                    canPick: false,
                    starTied: false,
                    pickerName: 'Roknua',
                    viewerSpeedMbps: null,
                    viewerSpeedMeasuredAt: null,
                }),
            ),
        );
        const lineup = twoEntryLineup({ myVotes: [42] });
        renderWithProviders(
            <VotingComposite lineup={lineup} canParticipate={true} />,
        );

        await screen.findByTestId('voting-hold-notice');
        // A star landing during the hold would dissolve the tie underneath
        // the readiness card (D13) — the same rule as the vote button.
        for (const star of screen.getAllByTestId('star-toggle')) {
            expect(star).toBeDisabled();
        }
    });
});
