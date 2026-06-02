/**
 * Failing-first tests for SchedulingComposite (ROK-1300, Ss + Sx).
 *
 * Source file does NOT yet exist — these MUST fail with module-not-found
 * until the dev creates
 * `web/src/components/lineups/cycle-4/SchedulingComposite.tsx`.
 *
 * The composite is the top-level component for the scheduling phase of a
 * lineup poll. It renders in two modes, driven by `poll.isStandalone`:
 *   - From-match (Ss, `isStandalone === false`) — full 4-phase ribbon
 *     JourneyHero (phase scheduling / active 3) + cross-match refs.
 *   - Standalone (Sx, `isStandalone === true`) — `noRibbon` hero, no
 *     cross-match refs.
 *
 * Operator decisions (dev-brief-ROK-1300.md):
 *   AC1 — From-match: 4-phase ribbon hero w/ "Scheduling" badge + "Match N
 *         of M" cross-ref when useLineupMatches returns >1 match.
 *   AC2 — Standalone: noRibbon hero, "🗓 Scheduling Poll · started by you"
 *         badge, NO "Match N of M".
 *   AC3 — Per-row `+ Vote` toggle with an accessible name; click calls the
 *         toggle-vote path.
 *   AC4 — Operator/creator viewer sees a per-row `Lock this time →`
 *         affordance; a plain member does NOT.
 *   AC5 — Submit lives in the sticky toolbar (NOT a bottom SubmitBar);
 *         label switches on the viewer's match-member schedulingSubmittedAt.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {
    SchedulePollPageResponseDto,
    MatchDetailResponseDto,
    GroupedMatchesResponseDto,
} from '@raid-ledger/contract';
import { renderWithProviders } from '../../../../test/render-helpers';

// ── Hook mocks ────────────────────────────────────────────────────────
// The composite consumes these hooks directly; mock them so the test
// drives behavior without a live API. Mirrors how the sibling Cycle-4
// composites isolate their server state.
const toggleVoteMutate = vi.fn();
const suggestSlotMutate = vi.fn();
const submitSchedulingMutate = vi.fn();

vi.mock('../../../../hooks/use-scheduling', () => ({
    useToggleScheduleVote: () => ({ mutate: toggleVoteMutate, isPending: false }),
    useSuggestSlot: () => ({ mutate: suggestSlotMutate, isPending: false }),
    useMatchAvailability: () => ({ data: undefined, isLoading: false }),
}));

vi.mock('../../../../hooks/use-lineup-submit', () => ({
    useSubmitScheduling: () => ({ mutate: submitSchedulingMutate, isPending: false }),
}));

const lineupMatchesData = vi.fn<[], GroupedMatchesResponseDto | undefined>(
    () => undefined,
);
vi.mock('../../../../hooks/use-lineup-matches', () => ({
    useLineupMatches: () => ({ data: lineupMatchesData(), isLoading: false }),
}));

const authUser = vi.fn<[], { id: number; role?: string } | null>(() => ({
    id: 99,
}));
vi.mock('../../../../hooks/use-auth', () => ({
    useAuth: () => ({ user: authUser(), isAuthenticated: true }),
}));

// Import AFTER vi.mock so the mocks are in place. The module does not yet
// exist — this import is the primary failure trigger.
import { SchedulingComposite } from '../SchedulingComposite';

const ME = 99;

/** Build a single match-member row. */
function buildMember(
    userId: number,
    schedulingSubmittedAt: string | null,
    displayName = `User ${userId}`,
): MatchDetailResponseDto['members'][number] {
    return {
        id: userId * 10,
        matchId: 500,
        userId,
        source: 'voted',
        createdAt: '2026-05-15T00:00:00.000Z',
        displayName,
        avatar: null,
        discordId: null,
        customAvatarUrl: null,
        schedulingSubmittedAt,
    };
}

interface PollOverrides {
    isStandalone?: boolean;
    /** lineup creator user id — drives operator/creator gating. */
    lineupCreatedById?: number;
    /** current viewer's schedulingSubmittedAt. */
    mySubmittedAt?: string | null;
    myVotedSlotIds?: number[];
}

function buildPoll(overrides: PollOverrides = {}): SchedulePollPageResponseDto {
    const {
        isStandalone = false,
        lineupCreatedById = 1,
        mySubmittedAt = null,
        myVotedSlotIds = [],
    } = overrides;

    const match: MatchDetailResponseDto = {
        id: 500,
        lineupId: 7,
        gameId: 42,
        status: 'scheduling',
        thresholdMet: true,
        voteCount: 3,
        votePercentage: 60,
        fitType: 'normal',
        linkedEventId: null,
        minVoteThreshold: 2,
        thresholdNotifiedAt: null,
        createdAt: '2026-05-15T00:00:00.000Z',
        updatedAt: '2026-05-15T00:00:00.000Z',
        gameName: 'Valheim',
        gameCoverUrl: null,
        lineupCreatedById,
        members: [buildMember(ME, mySubmittedAt), buildMember(2, null)],
    };

    const poll = {
        match,
        slots: [
            {
                id: 1001,
                matchId: 500,
                proposedTime: '2026-06-10T20:00:00.000Z',
                overlapScore: 0.8,
                suggestedBy: 'system',
                createdAt: '2026-05-16T00:00:00.000Z',
                votes: [
                    {
                        userId: ME,
                        displayName: 'Me',
                        avatar: null,
                        discordId: null,
                        customAvatarUrl: null,
                    },
                ],
            },
            {
                id: 1002,
                matchId: 500,
                proposedTime: '2026-06-11T20:00:00.000Z',
                overlapScore: 0.5,
                suggestedBy: 'user',
                createdAt: '2026-05-16T00:00:00.000Z',
                votes: [],
            },
        ],
        myVotedSlotIds,
        lineupStatus: 'scheduling',
        uniqueVoterCount: 2,
        conflictingSlotIds: [],
        phaseDeadline: null,
        // ROK-1300 NEW field — cast in case the contract type hasn't been
        // rebuilt with `isStandalone` yet. The test must fail because the
        // COMPONENT is missing, not because the type is.
        isStandalone,
    } as SchedulePollPageResponseDto;

    return poll;
}

/** Two-match grouped response so "Match N of M" can resolve M>1. */
function buildMultiMatchGroups(): GroupedMatchesResponseDto {
    const stub = (id: number, name: string): MatchDetailResponseDto => ({
        ...buildPoll().match,
        id,
        gameName: name,
    });
    return {
        scheduling: [stub(500, 'Valheim'), stub(501, 'Deep Rock')],
        almostThere: [],
        rallyYourCrew: [],
        carriedForward: [],
        matchThreshold: 35,
        totalVoters: 5,
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    lineupMatchesData.mockReturnValue(undefined);
    authUser.mockReturnValue({ id: ME });
});

// ─────────────────────────────────────────────────────────────────────
// AC1 — From-match mode: 4-phase ribbon hero + Match N of M cross-ref
// ─────────────────────────────────────────────────────────────────────

describe('SchedulingComposite — from-match mode (AC1)', () => {
    it('renders the 4-phase ribbon JourneyHero (scheduling / active 3) with a "Scheduling" badge', async () => {
        const poll = buildPoll({ isStandalone: false });
        renderWithProviders(
            <SchedulingComposite poll={poll} lineupId={7} matchId={500} />,
        );

        // JourneyHero exposes role="region" labelled by its badge text. For
        // Ss the badge must read "Scheduling" and the 4-phase ribbon
        // (aria-label="Lineup progress") is present with Schedule current.
        const hero = await screen.findByRole('region', {
            name: /scheduling/i,
        });
        expect(hero).toBeInTheDocument();
        expect(
            screen.getByRole('list', { name: /lineup progress/i }),
        ).toBeInTheDocument();
    });

    it('shows a "Match N of M" cross-ref when the lineup has >1 match', async () => {
        lineupMatchesData.mockReturnValue(buildMultiMatchGroups());
        const poll = buildPoll({ isStandalone: false });
        renderWithProviders(
            <SchedulingComposite poll={poll} lineupId={7} matchId={500} />,
        );

        await waitFor(() => {
            expect(screen.getByText(/match 1 of 2/i)).toBeInTheDocument();
        });
    });
});

// ─────────────────────────────────────────────────────────────────────
// AC2 — Standalone mode: noRibbon hero + "started by you" badge, no x-ref
// ─────────────────────────────────────────────────────────────────────

describe('SchedulingComposite — standalone mode (AC2)', () => {
    it('renders a noRibbon hero with the "Scheduling Poll · started by you" badge', async () => {
        const poll = buildPoll({ isStandalone: true });
        renderWithProviders(
            <SchedulingComposite poll={poll} lineupId={7} matchId={500} />,
        );

        const hero = await screen.findByRole('region', {
            name: /scheduling poll · started by you/i,
        });
        expect(hero).toBeInTheDocument();
        // noRibbon → the 4-phase progress ribbon must NOT render.
        expect(
            screen.queryByRole('list', { name: /lineup progress/i }),
        ).not.toBeInTheDocument();
    });

    it('does NOT show a "Match N of M" cross-ref even when multiple matches exist', async () => {
        lineupMatchesData.mockReturnValue(buildMultiMatchGroups());
        const poll = buildPoll({ isStandalone: true });
        renderWithProviders(
            <SchedulingComposite poll={poll} lineupId={7} matchId={500} />,
        );

        await screen.findByRole('region', {
            name: /scheduling poll · started by you/i,
        });
        expect(screen.queryByText(/match \d+ of \d+/i)).not.toBeInTheDocument();
    });
});

// ─────────────────────────────────────────────────────────────────────
// AC3 — Per-row "+ Vote" toggle with accessible name; click toggles vote
// ─────────────────────────────────────────────────────────────────────

describe('SchedulingComposite — per-row vote toggle (AC3)', () => {
    it('renders a vote toggle with an accessible name on each suggested-time row', async () => {
        const poll = buildPoll({ isStandalone: false });
        renderWithProviders(
            <SchedulingComposite poll={poll} lineupId={7} matchId={500} />,
        );

        await waitFor(() => {
            const voteButtons = screen.getAllByRole('button', {
                name: /vote/i,
            });
            // One per slot (2 slots in the fixture).
            expect(voteButtons.length).toBeGreaterThanOrEqual(2);
        });
    });

    it('clicking a row vote toggle calls the toggle-vote mutation for that slot', async () => {
        const user = userEvent.setup();
        const poll = buildPoll({ isStandalone: false });
        renderWithProviders(
            <SchedulingComposite poll={poll} lineupId={7} matchId={500} />,
        );

        const voteButtons = await screen.findAllByRole('button', {
            name: /vote/i,
        });
        await user.click(voteButtons[0]);

        await waitFor(() => {
            expect(toggleVoteMutate).toHaveBeenCalledTimes(1);
        });
        // Payload carries lineupId + matchId + a slotId from the fixture.
        const arg = toggleVoteMutate.mock.calls[0][0];
        expect(arg).toMatchObject({ lineupId: 7, matchId: 500 });
        expect([1001, 1002]).toContain(arg.slotId);
    });
});

// ─────────────────────────────────────────────────────────────────────
// AC4 — Operator/creator-gated "Lock this time →" per row
// ─────────────────────────────────────────────────────────────────────

describe('SchedulingComposite — operator-gated lock (AC4)', () => {
    it('operator viewer sees a "Lock this time →" affordance per row', async () => {
        authUser.mockReturnValue({ id: ME, role: 'operator' });
        const poll = buildPoll({ isStandalone: false });
        renderWithProviders(
            <SchedulingComposite poll={poll} lineupId={7} matchId={500} />,
        );

        await waitFor(() => {
            const lockButtons = screen.getAllByRole('button', {
                name: /lock this time/i,
            });
            expect(lockButtons.length).toBeGreaterThanOrEqual(2);
        });
    });

    it('lineup-creator viewer (non-operator) sees the lock affordance', async () => {
        authUser.mockReturnValue({ id: 1 }); // id matches lineupCreatedById
        const poll = buildPoll({ isStandalone: false, lineupCreatedById: 1 });
        renderWithProviders(
            <SchedulingComposite poll={poll} lineupId={7} matchId={500} />,
        );

        await waitFor(() => {
            expect(
                screen.getAllByRole('button', { name: /lock this time/i })
                    .length,
            ).toBeGreaterThanOrEqual(1);
        });
    });

    it('plain member viewer does NOT see the lock affordance (only + Vote)', async () => {
        authUser.mockReturnValue({ id: ME }); // not operator, not creator
        const poll = buildPoll({ isStandalone: false, lineupCreatedById: 1 });
        renderWithProviders(
            <SchedulingComposite poll={poll} lineupId={7} matchId={500} />,
        );

        // Vote affordance present...
        await screen.findAllByRole('button', { name: /vote/i });
        // ...but no lock affordance for a plain member.
        expect(
            screen.queryByRole('button', { name: /lock this time/i }),
        ).not.toBeInTheDocument();
    });
});

// ─────────────────────────────────────────────────────────────────────
// AC5 — Sticky-toolbar submit (no bottom SubmitBar); label tracks state
// ─────────────────────────────────────────────────────────────────────

describe('SchedulingComposite — sticky-toolbar submit (AC5)', () => {
    it('from-match, not yet submitted → toolbar submit reads "Submit my times →"', async () => {
        const poll = buildPoll({
            isStandalone: false,
            mySubmittedAt: null,
            myVotedSlotIds: [1001],
        });
        renderWithProviders(
            <SchedulingComposite poll={poll} lineupId={7} matchId={500} />,
        );

        await waitFor(() => {
            expect(
                screen.getByRole('button', { name: /submit my times/i }),
            ).toBeInTheDocument();
        });
    });

    it('standalone, not yet submitted → toolbar submit reads "Lock this time →"', async () => {
        const poll = buildPoll({
            isStandalone: true,
            mySubmittedAt: null,
            myVotedSlotIds: [1001],
        });
        renderWithProviders(
            <SchedulingComposite poll={poll} lineupId={7} matchId={500} />,
        );

        await waitFor(() => {
            // The sticky toolbar submit affordance (distinct from the bottom
            // SubmitBar, which must NOT be rendered).
            expect(
                screen.getByTestId('sticky-hero-schedule-submit'),
            ).toBeInTheDocument();
        });
        expect(screen.queryByTestId('submit-bar')).not.toBeInTheDocument();
    });

    it('once the viewer has submitted → hero is in waiting tone with a "Change my times" affordance', async () => {
        const poll = buildPoll({
            isStandalone: false,
            mySubmittedAt: '2026-05-20T10:00:00.000Z',
            myVotedSlotIds: [1001],
        });
        renderWithProviders(
            <SchedulingComposite poll={poll} lineupId={7} matchId={500} />,
        );

        await waitFor(() => {
            // tone="waiting" → JourneyHero renders the "You're done here" pill.
            expect(screen.getByText(/you're done here/i)).toBeInTheDocument();
        });
        expect(
            screen.getByRole('button', { name: /change my times/i }),
        ).toBeInTheDocument();
    });
});
