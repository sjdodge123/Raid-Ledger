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
 *   AC5 — RETIRED by ROK-1544: there is no member Submit on this surface.
 *         Tapping a slot casts/withdraws the vote and is the complete
 *         action; the server stamps schedulingSubmittedAt from the vote.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLocation } from 'react-router-dom';
import type { JSX } from 'react';
import type {
    MatchDetailResponseDto,
    GroupedMatchesResponseDto,
} from '@raid-ledger/contract';
import { renderWithProviders } from '../../../../test/render-helpers';

/** Renders the current MemoryRouter path so nav targets can be asserted. */
function LocationProbe(): JSX.Element {
    const { pathname } = useLocation();
    return <div data-testid="location-probe">{pathname}</div>;
}

// ── Hook mocks ────────────────────────────────────────────────────────
// The composite consumes these hooks directly; mock them so the test
// drives behavior without a live API. Mirrors how the sibling Cycle-4
// composites isolate their server state.
// ROK-1617 follow-up: the ladder presses through `mutateAsync`, so the mock
// hands back a promise. The default NEVER settles — the in-flight-guard cases
// below depend on the guard still being held after the press.
const toggleVoteMutate = vi.fn(() => new Promise<never>(() => {}));
const suggestSlotMutate = vi.fn();
const cancelPollMutate = vi.fn();

// ROK-1300 rework round 1: the composite now owns the heatmap
// (useMatchAvailability), the operator Cancel (useCancelSchedulePoll), and the
// game-ref drawer. Mock the full hook set it consumes.
vi.mock('../../../../hooks/use-scheduling', () => ({
    useToggleScheduleVote: () => ({ mutateAsync: toggleVoteMutate, isPending: false }),
    useSuggestSlot: () => ({ mutate: suggestSlotMutate, isPending: false }),
    // One availability cell so AvailabilityHeatmapSection renders (it returns
    // null on empty data) → the in-composite heatmap test can assert it.
    useMatchAvailability: () => ({
        data: {
            eventId: 0,
            totalUsers: 2,
            cells: [
                { dayOfWeek: 1, hour: 19, availableCount: 2, totalCount: 2 },
            ],
        },
        isLoading: false,
    }),
    useCancelSchedulePoll: () => ({ mutate: cancelPollMutate, isPending: false }),
    // ROK-1610: the post-expiry lock-in's write, called unconditionally by
    // `useExpiredLockIn` (hook rules) even on an open poll.
    useCreateEventFromSlot: () => ({ mutate: vi.fn(), isPending: false }),
    // ROK-1395: SchedulingRemindAction calls this unconditionally (hook rules)
    // even when the visibility gate later renders null.
    useRemindVoters: () => ({
        mutate: vi.fn(),
        reset: vi.fn(),
        isPending: false,
        isSuccess: false,
    }),
    // ROK-1618: SchedulingRallyAction (the leader menu's second row) calls
    // this unconditionally, same hook-rules reason as Remind above.
    useRallyNonVoters: () => ({
        mutate: vi.fn(),
        reset: vi.fn(),
        isPending: false,
        data: undefined,
    }),
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
// Preserve isOperatorOrAdmin (SchedulingCancelAction gates on it) while
// stubbing the user; mirror the real predicate.
vi.mock('../../../../hooks/use-auth', () => ({
    useAuth: () => ({ user: authUser(), isAuthenticated: true }),
    isOperatorOrAdmin: (u: { role?: string } | null) =>
        u?.role === 'operator' || u?.role === 'admin',
}));

// ROK-1551 (AC4): lock-in refetches the poll before deciding confirm-vs-commit.
vi.mock('../../../../lib/api-client', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../../lib/api-client')>()),
    getSchedulePoll: vi.fn(),
}));

// Import AFTER vi.mock so the mocks are in place. The module does not yet
// exist — this import is the primary failure trigger.
import { SchedulingComposite } from '../SchedulingComposite';
import { ME, addSlot, buildMember, buildPoll } from './scheduling-poll-fixtures';
import { getSchedulePoll } from '../../../../lib/api-client';

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

// ROK-1580: several cases below pin the viewport with `setViewport`; the stub
// must not leak into the next file-level test, which relies on the default.
afterEach(() => {
    vi.unstubAllGlobals();
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
        // ROK-1496: "you" is only correct when the viewer IS the creator.
        const poll = buildPoll({ isStandalone: true, lineupCreatedById: ME });
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
        const poll = buildPoll({ isStandalone: true, lineupCreatedById: ME });
        renderWithProviders(
            <SchedulingComposite poll={poll} lineupId={7} matchId={500} />,
        );

        await screen.findByRole('region', {
            name: /scheduling poll · started by you/i,
        });
        expect(screen.queryByText(/match \d+ of \d+/i)).not.toBeInTheDocument();
    });

    it('names the actual creator when the viewer did not start the poll (ROK-1496)', async () => {
        // Fixture: viewer ME=99, creator = member 2 ("User 2").
        const poll = buildPoll({ isStandalone: true, lineupCreatedById: 2 });
        renderWithProviders(
            <SchedulingComposite poll={poll} lineupId={7} matchId={500} />,
        );

        const hero = await screen.findByRole('region', {
            name: /scheduling poll · started by user 2/i,
        });
        expect(hero).toBeInTheDocument();
        expect(screen.queryByText(/started by you/i)).not.toBeInTheDocument();
    });

    it('omits attribution when the creator is not a resolvable member (ROK-1496)', async () => {
        // lineupCreatedById 1 is not in members → no name to show.
        const poll = buildPoll({ isStandalone: true, lineupCreatedById: 1 });
        renderWithProviders(
            <SchedulingComposite poll={poll} lineupId={7} matchId={500} />,
        );

        const hero = await screen.findByRole('region', {
            name: /scheduling poll/i,
        });
        expect(hero).toHaveAccessibleName('🗓 Scheduling Poll');
        expect(screen.queryByText(/started by/i)).not.toBeInTheDocument();
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

    /**
     * ROK-1546 AC2 — the vote is written optimistically with no page
     * transition, so a screen-reader user got no feedback at all. The polite
     * region names the slot the vote landed on, and only once the write
     * SUCCEEDED (a rolled-back vote must not be announced as saved).
     */
    it('AC2 — a successful vote is announced in the polite live region', async () => {
        const user = userEvent.setup();
        // Only this test drives the success path; `mockImplementationOnce`
        // keeps the "never settles" default the in-flight-guard tests rely on.
        toggleVoteMutate.mockImplementationOnce(
            // ROK-1617: the server returns the landed STANCE alongside
            // `voted`, and the live region reads the stance.
            () =>
                Promise.resolve({ voted: true, stance: 'yes' }) as unknown as Promise<never>,
        );
        const poll = buildPoll({ myVotedSlotIds: [] });
        renderWithProviders(
            <SchedulingComposite poll={poll} lineupId={7} matchId={500} />,
        );
        await screen.findByTestId('scheduling-leader-card');

        const rows = screen.getAllByTestId('schedule-slot');
        const label = within(rows[0]).getByRole('button', {
            name: /^vote for/i,
        });
        await user.click(label);

        await waitFor(() => {
            expect(screen.getByTestId('scheduling-announcer')).toHaveTextContent(
                /^Your vote for .+ is in\.$/,
            );
        });
    });
});

// ─────────────────────────────────────────────────────────────────────
// AC4 — Operator/creator-gated "Lock this time →" per row
// ─────────────────────────────────────────────────────────────────────

describe('SchedulingComposite — operator-gated lock (AC4)', () => {
    // ROK-1635 AC3 reverses ROK-1618 AC6: the inline cyan `Lock this time →`
    // is gone and every time card carries the SAME ⋯ menu. The intent below is
    // unchanged — an organiser can end the poll on ANY listed row — but the
    // route is the menu, so the old `button` query cannot pass (`MenuRow`
    // renders `role="menuitem"`, and the popover is `hidden` until opened).
    it('operator viewer can lock every listed row from its ⋯ menu', async () => {
        const user = userEvent.setup();
        setViewport(true); // the popover renders inside the row it belongs to
        authUser.mockReturnValue({ id: ME, role: 'operator' });
        const poll = buildPoll({ isStandalone: false });
        addSlot(poll); // two rows survive the leader's exclusion

        renderWithProviders(
            <SchedulingComposite poll={poll} lineupId={7} matchId={500} />,
        );

        const rows = await screen.findAllByTestId('schedule-slot');
        expect(rows).toHaveLength(2);
        for (const row of rows) {
            await user.click(within(row).getByTestId('scheduling-slot-menu'));
            expect(
                within(row).getByRole('menuitem', {
                    name: /^Lock this time — /,
                }),
            ).toBeVisible();
        }
    });

    it('lineup-creator viewer (non-operator) can lock a row from its ⋯ menu', async () => {
        const user = userEvent.setup();
        setViewport(true);
        authUser.mockReturnValue({ id: 1 }); // id matches lineupCreatedById
        const poll = buildPoll({ isStandalone: false, lineupCreatedById: 1 });
        renderWithProviders(
            <SchedulingComposite poll={poll} lineupId={7} matchId={500} />,
        );

        const rows = await screen.findAllByTestId('schedule-slot');
        expect(rows.length).toBeGreaterThanOrEqual(1);
        await user.click(within(rows[0]).getByTestId('scheduling-slot-menu'));
        expect(
            within(rows[0]).getByRole('menuitem', { name: /^Lock this time — / }),
        ).toBeVisible();
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
        // ROK-1635 OQ-2: and no ⋯ at all — not an empty menu, on any card.
        expect(screen.queryAllByTestId('scheduling-slot-menu')).toEqual([]);
        expect(screen.queryByTestId('scheduling-leader-menu')).toBeNull();
    });
});

// ─────────────────────────────────────────────────────────────────────
// ROK-1544 — one-tap voting: the tap IS the whole action. No member Submit
// survives on this surface in either mode; "Lock this time →" is the
// operator/creator's end-the-poll action only.
// ─────────────────────────────────────────────────────────────────────

describe('SchedulingComposite — one-tap voting, no member Submit (ROK-1544)', () => {
    it.each([
        ['from-match', false],
        ['standalone', true],
    ] as const)(
        '%s: renders no member submit affordance at all',
        async (_label, isStandalone) => {
            const poll = buildPoll({
                isStandalone,
                mySubmittedAt: null,
                myVotedSlotIds: [1001],
            });
            renderWithProviders(
                <SchedulingComposite poll={poll} lineupId={7} matchId={500} />,
            );
            await screen.findByTestId('scheduling-leader-card');

            expect(
                screen.queryByTestId('sticky-hero-schedule-submit'),
            ).not.toBeInTheDocument();
            expect(screen.queryByTestId('submit-bar')).not.toBeInTheDocument();
            expect(
                screen.queryByRole('button', { name: /submit my times/i }),
            ).not.toBeInTheDocument();
            expect(
                screen.queryByRole('button', { name: /change my times/i }),
            ).not.toBeInTheDocument();
            // ...and no "pick a time first to submit" nudge.
            expect(
                screen.queryByText(/to submit/i),
            ).not.toBeInTheDocument();
        },
    );

    it('a plain member never sees "Lock this time →" — not per-row, not in the leader menu', async () => {
        const poll = buildPoll({ lineupCreatedById: 1 }); // viewer is 99
        renderWithProviders(
            <SchedulingComposite poll={poll} lineupId={7} matchId={500} />,
        );
        await screen.findByTestId('scheduling-leader-card');
        expect(
            screen.queryByRole('button', { name: /lock this time/i }),
        ).not.toBeInTheDocument();
        // ROK-1618: the toolbar's floating lock became a "Poll actions ⋯"
        // menu on the leader card. A plain member gets no ⋯ at all.
        expect(
            screen.queryByTestId('scheduling-leader-menu'),
        ).not.toBeInTheDocument();
    });

    // ROK-1618 (AC5): the creator's end-the-poll affordance moved from the
    // toolbar's floating cyan bar into the leader card's ⋯ menu. The assertion
    // — locking from it ends the poll on the LEADING slot — is unchanged; only
    // the path to the button is.
    it('the creator gets a leader-menu "Lock this time" that ends the poll on the leading slot', async () => {
        const user = userEvent.setup();
        const poll = buildPoll({ lineupCreatedById: ME });
        // The leading slot must be in the future — locking a past time is
        // refused by the same guard the per-row lock uses.
        poll.slots[0].proposedTime = new Date(
            Date.now() + 24 * 60 * 60 * 1000,
        ).toISOString();
        vi.mocked(getSchedulePoll).mockResolvedValue(poll);
        renderWithProviders(
            <>
                <SchedulingComposite poll={poll} lineupId={7} matchId={500} />
                <LocationProbe />
            </>,
        );
        // AC5: the floating toolbar button is gone at every width.
        await screen.findByTestId('scheduling-leader-card');
        expect(
            screen.queryByTestId('sticky-hero-lock-poll'),
        ).not.toBeInTheDocument();

        await user.click(await screen.findByTestId('scheduling-leader-menu'));
        // The leading slot is 1001 (1 vote vs 0) and it is below the voter
        // threshold, so the SAME early-lock guard the per-row lock uses fires.
        await user.click(await screen.findByTestId('scheduling-leader-lock'));
        await user.click(
            await screen.findByRole('button', { name: /create anyway/i }),
        );

        // ...and the lock ends the poll on THAT slot's time.
        await waitFor(() => {
            expect(screen.getByTestId('location-probe')).toHaveTextContent(
                '/events/new',
            );
        });
    });

    // ROK-1543 P3: two overlapping toggles on the same slot snapshot each
    // other's optimistic state, so a failure of the first rolls back past the
    // second. The second tap is dropped until the first settles.
    it('ignores a second tap on the same slot while its toggle is in flight', async () => {
        const user = userEvent.setup();
        const poll = buildPoll({ myVotedSlotIds: [] });
        // ROK-1635: 1001 leads and is rendered on the card only, so a second
        // LISTED slot is needed for the "different slot" half of the guard.
        addSlot(poll);
        renderWithProviders(
            <SchedulingComposite poll={poll} lineupId={7} matchId={500} />,
        );
        await screen.findByTestId('scheduling-leader-card');
        const first = within(rowFor(1002)).getByRole('button', {
            name: /^vote for/i,
        });

        await user.click(first);
        await user.click(first);

        // The mocked mutate never settles, so the guard is still held.
        expect(toggleVoteMutate).toHaveBeenCalledTimes(1);

        // A different slot is unaffected — the guard is per-slot, not global.
        await user.click(
            within(rowFor(1003)).getByRole('button', { name: /^vote for/i }),
        );
        expect(toggleVoteMutate).toHaveBeenCalledTimes(2);
    });

    it('changing a vote after having voted costs ONE interaction (AC2)', async () => {
        const user = userEvent.setup();
        const poll = buildPoll({
            mySubmittedAt: '2026-05-20T10:00:00.000Z',
            myVotedSlotIds: [1001],
        });
        renderWithProviders(
            <SchedulingComposite poll={poll} lineupId={7} matchId={500} />,
        );
        await screen.findByTestId('scheduling-leader-card');

        // The viewer has already voted for slot 1001 and now wants 1002.
        // Old flow: tap 1002 → tap "Change my times" → tap "Submit my times".
        // Selected by slot id, not row index: 1001 leads, so ROK-1635 renders
        // it on the card and the ladder's first row IS 1002.
        const target = within(rowFor(1002)).getByRole('button', {
            name: /^vote for/i,
        });

        let interactions = 0;
        await user.click(target);
        interactions += 1;

        expect(interactions).toBe(1);
        expect(toggleVoteMutate).toHaveBeenCalledTimes(1);
        expect(toggleVoteMutate).toHaveBeenCalledWith(
            {
                lineupId: 7,
                matchId: 500,
                slotId: 1002,
                // ROK-1617: the tap names WHICH answer it is. The `+ Vote`
                // affordance is the yes side; the anti-vote sends `'no'`.
                stance: 'yes',
                // ROK-1543: the viewer's voter identity rides along so the
                // optimistic patch can move the leader card on the tap.
                viewer: expect.objectContaining({ userId: 99 }),
                // ROK-1550: where the visit came from. No `?src` on this
                // render, so the vote is an ordinary web one.
                source: 'web',
            },
            // ROK-1617 follow-up: the press carries ONLY its variables now.
            // The per-slot in-flight guard releases on the mutation's own
            // promise (it used to ride a mutate-level `onSettled` that a press
            // on another slot orphaned) — pinned by
            // `__tests__/use-scheduling-ladder-inflight.test.ts` T2b/T2c.
        );
        // Nothing else was needed to commit it.
        expect(
            screen.queryByRole('button', { name: /submit|change my times/i }),
        ).not.toBeInTheDocument();
    });

    it('a viewer with a server stamp still gets the waiting hero tone (AC3 read path)', async () => {
        const poll = buildPoll({
            mySubmittedAt: '2026-05-20T10:00:00.000Z',
            myVotedSlotIds: [1001],
        });
        renderWithProviders(
            <SchedulingComposite poll={poll} lineupId={7} matchId={500} />,
        );
        // tone="waiting" → JourneyHero renders the "You're done here" pill.
        expect(await screen.findByText(/you're done here/i)).toBeInTheDocument();
    });
});

// ─────────────────────────────────────────────────────────────────────
// AC6 (rework round 1+2) — composite OWNS the page body: single hero at top,
// game-ref merged INTO the sticky toolbar on the submit row, clickable →
// /games/:id; heatmap, deadline, operator Cancel; NO wizard stepper, NO
// separate "Scheduling Poll" h1.
// ─────────────────────────────────────────────────────────────────────

describe('SchedulingComposite — owns the page body (AC6 rework)', () => {
    it('game-ref lives in the toolbar on the submit row and navigates to /games/:id when clicked', async () => {
        const user = userEvent.setup();
        const poll = buildPoll({ isStandalone: false });
        renderWithProviders(
            <>
                <SchedulingComposite poll={poll} lineupId={7} matchId={500} />
                <LocationProbe />
            </>,
        );

        // The clickable game-ref carries an accessible name + game name + ⓘ.
        const gameRef = await screen.findByRole('button', {
            name: /view valheim details/i,
        });
        expect(gameRef).toHaveTextContent(/valheim/i);
        expect(
            screen.getByTestId('scheduling-game-research'),
        ).toBeInTheDocument();
        // It sits on the game-ref row of the toolbar; ROK-1544 removed the
        // member submit that used to share that row.
        expect(
            screen.queryByTestId('sticky-hero-schedule-submit'),
        ).not.toBeInTheDocument();

        await user.click(gameRef);
        await waitFor(() => {
            expect(screen.getByTestId('location-probe')).toHaveTextContent(
                '/games/42',
            );
        });
    });

    it('owns the group week view, now behind the "Find a better time" affordance (ROK-1543 AC3)', async () => {
        const user = userEvent.setup();
        const poll = buildPoll({ isStandalone: false });
        renderWithProviders(
            <SchedulingComposite poll={poll} lineupId={7} matchId={500} />,
        );
        // ROK-1543: the heatmap is no longer the primary body — it is one tap
        // away, so the poll answers "when are we playing" first.
        await screen.findByTestId('scheduling-leader-card');
        expect(screen.queryByTestId('group-week-view')).not.toBeInTheDocument();

        // ROK-1580: the seven-column grid is the DESKTOP body of that sheet;
        // below 1024px it is the one-day group module (asserted just below).
        setViewport(true);
        await user.click(
            screen.getByRole('button', { name: /find a better time/i }),
        );
        // ROK-1588: the painted heatmap is retired; the desktop body is the
        // shared seven-column week view.
        expect(await screen.findByTestId('group-week-view')).toBeInTheDocument();
        expect(screen.queryByTestId('heatmap-grid')).not.toBeInTheDocument();
    });

    it('opens the phone group module in that same sheet below 1024px (ROK-1580)', async () => {
        const user = userEvent.setup();
        setViewport(false);
        const poll = buildPoll({ isStandalone: false });
        renderWithProviders(
            <SchedulingComposite poll={poll} lineupId={7} matchId={500} />,
        );
        await screen.findByTestId('scheduling-leader-card');

        await user.click(
            screen.getByRole('button', { name: /find a better time/i }),
        );

        expect(await screen.findByTestId('phone-week-editor')).toBeInTheDocument();
        expect(screen.queryByTestId('group-week-view')).not.toBeInTheDocument();
    });

    it('does NOT render the SchedulingWizard stepper or a separate "Scheduling Poll" h1', async () => {
        const poll = buildPoll({ isStandalone: false });
        renderWithProviders(
            <SchedulingComposite poll={poll} lineupId={7} matchId={500} />,
        );
        await screen.findByRole('region', { name: /scheduling/i });
        // The legacy wizard stepper + duplicated page h1 are gone.
        expect(
            screen.queryByTestId('scheduling-wizard-step-1'),
        ).not.toBeInTheDocument();
        expect(
            screen.queryByRole('heading', { level: 1, name: /^scheduling poll$/i }),
        ).not.toBeInTheDocument();
    });

    it('operator sees an in-composite "Cancel Poll" affordance; a plain member does not', async () => {
        // ROK-1585: on a DESKTOP the affordance lives in the "Manage poll ⋯"
        // dropdown (closed by default); the phone case below uses the sheet.
        setViewport(true);
        authUser.mockReturnValue({ id: ME, role: 'operator' });
        const poll = buildPoll({ isStandalone: true });
        const { unmount } = renderWithProviders(
            <SchedulingComposite poll={poll} lineupId={7} matchId={500} />,
        );
        fireEvent.click(await screen.findByTestId('scheduling-manage'));
        await waitFor(() => {
            expect(
                screen.getByRole('menuitem', { name: /cancel poll/i }),
            ).toBeInTheDocument();
        });
        unmount();

        authUser.mockReturnValue({ id: ME }); // plain member
        renderWithProviders(
            <SchedulingComposite poll={buildPoll({ isStandalone: true })} lineupId={7} matchId={500} />,
        );
        await screen.findByTestId('scheduling-game-ref');
        expect(screen.queryByTestId('scheduling-manage')).not.toBeInTheDocument();
        expect(
            screen.queryByRole('menuitem', { name: /cancel poll/i }),
        ).not.toBeInTheDocument();
    });

    it('reaches the operator "Cancel Poll" through the phone Manage sheet (ROK-1584)', async () => {
        setViewport(false);
        authUser.mockReturnValue({ id: ME, role: 'operator' });
        renderWithProviders(
            <SchedulingComposite
                poll={buildPoll({ isStandalone: true })}
                lineupId={7}
                matchId={500}
            />,
        );
        // No inline action row on a phone — one "Manage poll ⋯" row instead.
        await screen.findByTestId('scheduling-manage');
        expect(
            screen.queryByRole('button', { name: /cancel poll/i }),
        ).not.toBeInTheDocument();

        fireEvent.click(screen.getByTestId('scheduling-manage'));
        expect(
            screen.getByRole('button', { name: /cancel poll/i }),
        ).toBeInTheDocument();
    });

    it('renders the compact vote-progress bar when minVoteThreshold is set', async () => {
        // Fixture default: minVoteThreshold=2, uniqueVoterCount=2 → "2/2 voted".
        const poll = buildPoll({ isStandalone: false });
        renderWithProviders(
            <SchedulingComposite poll={poll} lineupId={7} matchId={500} />,
        );
        expect(
            await screen.findByTestId('vote-progress-bar'),
        ).toBeInTheDocument();
        expect(screen.getByTestId('vote-progress-text')).toHaveTextContent(
            /\d+\/\d+ voted/i,
        );
    });

    it('does NOT render the vote-progress bar when minVoteThreshold is null', async () => {
        const poll = buildPoll({ isStandalone: false });
        // Standalone polls created without a threshold (AC5 null-threshold case).
        poll.match.minVoteThreshold = null;
        renderWithProviders(
            <SchedulingComposite poll={poll} lineupId={7} matchId={500} />,
        );
        await screen.findByTestId('scheduling-game-ref');
        expect(
            screen.queryByTestId('vote-progress-bar'),
        ).not.toBeInTheDocument();
    });
});

// ─────────────────────────────────────────────────────────────────────
// ROK-1543 (P1-1) — Layout B: leader card first, heatmap behind ONE
// affordance (BottomSheet < 1024px, Modal above), suggest form moved into
// that sheet. The kept header (hero/toolbar/game-ref) is untouched.
// ─────────────────────────────────────────────────────────────────────

/**
 * The ladder row for a slot id. ROK-1635 hides the leading slot's row, so a
 * row index no longer maps to a slot — every case names the slot it means.
 */
function rowFor(slotId: number): HTMLElement {
    const row = screen
        .getAllByTestId('schedule-slot')
        .find((r) => r.getAttribute('data-slot-id') === String(slotId));
    if (!row) throw new Error(`no ladder row for slot ${slotId}`);
    return row;
}

/** Force `useMediaQuery('(min-width: 1024px)')` to a known answer. */
function setViewport(isDesktop: boolean): void {
    vi.stubGlobal('matchMedia', (query: string) => ({
        matches: query.includes('min-width: 1024px') ? isDesktop : false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
    }));
}

describe('SchedulingComposite — Layout B leader card (ROK-1543 AC1)', () => {
    it('renders the leader card above the slot list', async () => {
        const poll = buildPoll({ isStandalone: false });
        renderWithProviders(
            <SchedulingComposite poll={poll} lineupId={7} matchId={500} />,
        );

        const card = await screen.findByTestId('scheduling-leader-card');
        const firstSlot = screen.getAllByTestId('schedule-slot')[0];
        // DOCUMENT_POSITION_FOLLOWING (4) → the slot list comes AFTER the card.
        expect(
            card.compareDocumentPosition(firstSlot) &
                Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
        // The leading slot (1001, one vote) is the one promoted.
        expect(screen.getByTestId('scheduling-leader-votes')).toHaveTextContent(
            '1 of 2',
        );
    });

    it('keeps the shipped header above the leader card (AC0)', async () => {
        const poll = buildPoll({ isStandalone: true, lineupCreatedById: ME });
        renderWithProviders(
            <SchedulingComposite poll={poll} lineupId={7} matchId={500} />,
        );
        const hero = await screen.findByRole('region', {
            name: /scheduling poll · started by you/i,
        });
        const card = screen.getByTestId('scheduling-leader-card');
        expect(
            hero.compareDocumentPosition(card) &
                Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
        expect(screen.getByTestId('scheduling-game-ref')).toBeInTheDocument();
    });
});

describe('SchedulingComposite — "Find a better time" sheet (ROK-1543 AC3)', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('opens the heatmap in a BottomSheet below 1024px', async () => {
        setViewport(false);
        const user = userEvent.setup();
        renderWithProviders(
            <SchedulingComposite
                poll={buildPoll({ isStandalone: false })}
                lineupId={7}
                matchId={500}
            />,
        );
        await user.click(
            await screen.findByRole('button', { name: /find a better time/i }),
        );
        expect(
            await screen.findByTestId('scheduling-better-time-body'),
        ).toHaveAttribute('data-surface', 'sheet');
    });

    it('opens the heatmap in a Modal at 1024px and above', async () => {
        setViewport(true);
        const user = userEvent.setup();
        renderWithProviders(
            <SchedulingComposite
                poll={buildPoll({ isStandalone: false })}
                lineupId={7}
                matchId={500}
            />,
        );
        await user.click(
            await screen.findByRole('button', { name: /find a better time/i }),
        );
        expect(
            await screen.findByTestId('scheduling-better-time-body'),
        ).toHaveAttribute('data-surface', 'modal');
    });

    it('moves the suggest form into the sheet — it is not in the primary body', async () => {
        const user = userEvent.setup();
        renderWithProviders(
            <SchedulingComposite
                poll={buildPoll({ isStandalone: false })}
                lineupId={7}
                matchId={500}
            />,
        );
        await screen.findByTestId('scheduling-leader-card');
        expect(screen.queryByTestId('slot-datetime-picker')).not.toBeInTheDocument();

        await user.click(
            screen.getByRole('button', { name: /find a better time/i }),
        );
        expect(
            await screen.findByTestId('slot-datetime-picker'),
        ).toBeInTheDocument();
    });

    it('hides the affordance while the poll is read-only', async () => {
        // ROK-1545: read-only is the server-derived `pollStatus`, not a
        // match-status guess. An EXPIRED poll is the canonical read-only one
        // the composite actually receives — a `scheduled` match never reaches
        // it (the page renders CompletedPollState instead), so asserting
        // `locked_in` here would test an impossible payload.
        const poll = buildPoll({
            isStandalone: false,
            pollStatus: 'closed',
        });
        poll.match.status = 'scheduling';
        renderWithProviders(
            <SchedulingComposite poll={poll} lineupId={7} matchId={500} />,
        );
        await screen.findByTestId('read-only-banner');
        expect(
            screen.queryByRole('button', { name: /find a better time/i }),
        ).not.toBeInTheDocument();
    });
});

// ─────────────────────────────────────────────────────────────────────
// ROK-1545 — terminal states say what happened; the vote affordance only
// exists where a vote would be accepted.
// ─────────────────────────────────────────────────────────────────────

describe('SchedulingComposite — terminal states (ROK-1545)', () => {
    // AC1 (the locked-in ending) is asserted where it actually renders:
    // `web/src/pages/__tests__/scheduling-poll-page-terminal.test.tsx`. The
    // page short-circuits a `scheduled` match to CompletedPollState, so the
    // composite can never be handed `pollStatus: 'locked_in'` in production.

    it('AC2 — a cancelled poll renders the operator reason', async () => {
        const poll = buildPoll({
            pollStatus: 'cancelled',
            cancelReason: 'Half the roster is out.',
        });
        poll.match.status = 'cancelled';
        renderWithProviders(
            <SchedulingComposite poll={poll} lineupId={7} matchId={500} />,
        );
        const banner = await screen.findByTestId('read-only-banner');
        expect(banner).toHaveAttribute('data-poll-status', 'cancelled');
        expect(banner).toHaveTextContent('Half the roster is out.');
    });

    it('AC3 — an expired poll says the deadline passed without a lock-in', async () => {
        const poll = buildPoll({ pollStatus: 'closed' });
        renderWithProviders(
            <SchedulingComposite poll={poll} lineupId={7} matchId={500} />,
        );
        const banner = await screen.findByTestId('read-only-banner');
        expect(banner).toHaveAttribute('data-poll-status', 'closed');
        expect(banner).toHaveTextContent(
            /the deadline passed without a lock-in/i,
        );
        expect(
            screen.queryByRole('button', { name: /^vote for/i }),
        ).not.toBeInTheDocument();
    });

    it('AC4 — a non-member of a PRIVATE lineup gets no vote affordance', async () => {
        authUser.mockReturnValue({ id: 4242 });
        const poll = buildPoll({ canVote: false });
        renderWithProviders(
            <SchedulingComposite poll={poll} lineupId={7} matchId={500} />,
        );
        await screen.findByTestId('scheduling-leader-card');
        expect(screen.queryAllByRole('button', { name: /vote for/i })).toHaveLength(
            0,
        );
    });

    it('F7 — suggesting is gated by canVote too (it auto-votes server-side)', async () => {
        authUser.mockReturnValue({ id: 4242 });
        const poll = buildPoll({ canVote: false });
        renderWithProviders(
            <SchedulingComposite poll={poll} lineupId={7} matchId={500} />,
        );
        await screen.findByTestId('scheduling-leader-card');
        // The poll is OPEN, so `readOnly` is false — only `canVote` can hide it.
        expect(
            screen.queryByRole('button', { name: /find a better time/i }),
        ).not.toBeInTheDocument();
    });

    it('AC4 — a non-member of a PUBLIC lineup is told voting adds them to the poll', async () => {
        authUser.mockReturnValue({ id: 4242 });
        const poll = buildPoll({ canVote: true });
        renderWithProviders(
            <SchedulingComposite poll={poll} lineupId={7} matchId={500} />,
        );
        const buttons = await screen.findAllByRole('button', {
            name: /this adds you to the poll/i,
        });
        expect(buttons.length).toBeGreaterThanOrEqual(1);
        expect(buttons[0]).toHaveTextContent(/join/i);
    });

    it('AC5 — a member who joined after voting started gets the catch-up line', async () => {
        const poll = buildPoll({
            members: [
                buildMember(2, '2026-05-16T00:00:00.000Z', 'User 2'),
                buildMember(ME, null, 'Me', '2026-05-20T00:00:00.000Z'),
            ],
        });
        renderWithProviders(
            <SchedulingComposite poll={poll} lineupId={7} matchId={500} />,
        );
        const line = await screen.findByTestId('scheduling-catch-up');
        expect(line).toHaveTextContent(/you joined late/i);
        expect(line).toHaveTextContent('1 of 2');
        expect(screen.getByTestId('scheduling-pending-voters')).toHaveTextContent(
            /still to vote/i,
        );
    });
});
