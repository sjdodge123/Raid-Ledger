/**
 * ROK-1635 (§4.1, §4.5, §4.6) — the ACCESSIBILITY of a lead swap.
 *
 * AC1 moves the leading time out of the ladder and onto the card, so a swap
 * now UNMOUNTS the row a keyboard user may be standing on. Three facts this
 * file pins:
 *
 * §4.6 — focus follows the time. The row's control that had focus hands over
 *        to the equivalent control on the leader card (and back, when the
 *        card's time loses the lead) instead of falling to `<body>`.
 * §4.5 — the polite region announces a swap ONCE: not on first paint, and not
 *        again on a re-render that did not change the leader.
 * §4.1 — a row's ⋯ menu that is open when its row leaves the ladder goes with
 *        it: no orphaned popover, no sheet left on `document.body`.
 *
 * Split out of `SchedulingComposite.test.tsx` (at the 750-line test cap) and
 * of `SchedulingComposite.leaderonce.test.tsx`; same harness as both.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {
    GroupedMatchesResponseDto,
    SchedulePollPageResponseDto,
} from '@raid-ledger/contract';
import { renderWithProviders } from '../../../../test/render-helpers';

// ── Hook mocks ────────────────────────────────────────────────────────
vi.mock('../../../../hooks/use-scheduling', () => ({
    useToggleScheduleVote: () => ({
        mutateAsync: vi.fn(() => new Promise<never>(() => {})),
        isPending: false,
    }),
    useSuggestSlot: () => ({ mutate: vi.fn(), isPending: false }),
    useMatchAvailability: () => ({ data: undefined, isLoading: false }),
    useCancelSchedulePoll: () => ({ mutate: vi.fn(), isPending: false }),
    useCreateEventFromSlot: () => ({ mutate: vi.fn(), isPending: false }),
    useRemindVoters: () => ({
        mutate: vi.fn(),
        reset: vi.fn(),
        isPending: false,
        isSuccess: false,
    }),
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
vi.mock('../../../../hooks/use-auth', () => ({
    useAuth: () => ({ user: authUser(), isAuthenticated: true }),
    isOperatorOrAdmin: (u: { role?: string } | null) =>
        u?.role === 'operator' || u?.role === 'admin',
}));

import { SchedulingComposite } from '../SchedulingComposite';
import { buildPoll, ME } from './scheduling-poll-fixtures';

/** Force `useMediaQuery('(min-width: 1024px)')` to a known answer. */
function stubViewport(desktop: boolean): void {
    vi.stubGlobal('matchMedia', (query: string) => ({
        matches: desktop && query.includes('1024'),
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
    }));
}

/** The same poll with `slotId` carrying `count` yes votes. */
function withVotes(
    poll: SchedulePollPageResponseDto,
    slotId: number,
    count: number,
): SchedulePollPageResponseDto {
    return {
        ...poll,
        slots: poll.slots.map((slot) =>
            slot.id === slotId
                ? {
                      ...slot,
                      votes: Array.from({ length: count }, (_, i) => ({
                          userId: 200 + i,
                          displayName: `User ${200 + i}`,
                          avatar: null,
                          discordId: null,
                          customAvatarUrl: null,
                      })) as (typeof slot)['votes'],
                  }
                : slot,
        ),
    };
}

/** The ladder row for a slot id. */
function row(slotId: number): HTMLElement {
    const el = document
        .querySelector(`[data-testid="schedule-slot"][data-slot-id="${slotId}"]`);
    if (!el) throw new Error(`no ladder row for slot ${slotId}`);
    return el as HTMLElement;
}

/** The viewer is the lineup creator, so every time card carries a ⋯ menu. */
function organiserPoll(): SchedulePollPageResponseDto {
    return buildPoll({ lineupCreatedById: ME });
}

beforeEach(() => {
    vi.clearAllMocks();
    authUser.mockReturnValue({ id: ME });
    stubViewport(true);
});
afterEach(() => {
    vi.unstubAllGlobals();
    lineupMatchesData.mockReturnValue(undefined);
});

describe('SchedulingComposite — focus survives a lead swap (ROK-1635 §4.6)', () => {
    it('a focused row vote control hands over to the card’s vote control', async () => {
        const { rerender } = renderWithProviders(
            <SchedulingComposite poll={buildPoll()} lineupId={7} matchId={500} />,
        );
        await screen.findByTestId('scheduling-leader-card');
        // 1002 is the listed row (1001 leads); stand on its "+ Vote".
        within(row(1002)).getByTestId('slot-vote-toggle').focus();

        rerender(
            <SchedulingComposite
                poll={withVotes(buildPoll(), 1002, 2)}
                lineupId={7}
                matchId={500}
            />,
        );

        await waitFor(() => {
            expect(document.activeElement).toBe(
                screen.getByTestId('scheduling-leader-vote'),
            );
        });
    });

    it('a focused row ⋯ trigger hands over to the card’s ⋯ trigger', async () => {
        const { rerender } = renderWithProviders(
            <SchedulingComposite
                poll={organiserPoll()}
                lineupId={7}
                matchId={500}
            />,
        );
        await screen.findByTestId('scheduling-leader-card');
        within(row(1002)).getByTestId('scheduling-slot-menu').focus();

        rerender(
            <SchedulingComposite
                poll={withVotes(organiserPoll(), 1002, 2)}
                lineupId={7}
                matchId={500}
            />,
        );

        await waitFor(() => {
            expect(document.activeElement).toBe(
                screen.getByTestId('scheduling-leader-menu'),
            );
        });
    });

    it('a focused CARD control follows its time back down into the ladder', async () => {
        const { rerender } = renderWithProviders(
            <SchedulingComposite poll={buildPoll()} lineupId={7} matchId={500} />,
        );
        await screen.findByTestId('scheduling-leader-card');
        // The card names 1001; stand on its "+ Vote", then let 1002 overtake.
        screen.getByTestId('scheduling-leader-vote').focus();

        rerender(
            <SchedulingComposite
                poll={withVotes(buildPoll(), 1002, 2)}
                lineupId={7}
                matchId={500}
            />,
        );

        await waitFor(() => {
            expect(document.activeElement).toBe(
                within(row(1001)).getByTestId('slot-vote-toggle'),
            );
        });
    });

    it('steals nothing when focus was somewhere else entirely', async () => {
        const outside = document.createElement('button');
        document.body.appendChild(outside);
        const { rerender } = renderWithProviders(
            <SchedulingComposite poll={buildPoll()} lineupId={7} matchId={500} />,
        );
        await screen.findByTestId('scheduling-leader-card');
        outside.focus();

        rerender(
            <SchedulingComposite
                poll={withVotes(buildPoll(), 1002, 2)}
                lineupId={7}
                matchId={500}
            />,
        );

        await waitFor(() => expect(row(1001)).toBeInTheDocument());
        expect(document.activeElement).toBe(outside);
        outside.remove();
    });
});

describe('SchedulingComposite — the swap is announced once (ROK-1635 §4.5)', () => {
    it('is silent on first paint and on a re-render that keeps the leader', async () => {
        const { rerender } = renderWithProviders(
            <SchedulingComposite poll={buildPoll()} lineupId={7} matchId={500} />,
        );
        await screen.findByTestId('scheduling-leader-card');
        expect(screen.getByTestId('scheduling-announcer')).toHaveTextContent('');

        rerender(
            <SchedulingComposite poll={buildPoll()} lineupId={7} matchId={500} />,
        );
        await waitFor(() => expect(row(1002)).toBeInTheDocument());
        expect(screen.getByTestId('scheduling-announcer')).toHaveTextContent('');
    });

    it('announces the new leading time exactly once per swap', async () => {
        const { rerender } = renderWithProviders(
            <SchedulingComposite poll={buildPoll()} lineupId={7} matchId={500} />,
        );
        await screen.findByTestId('scheduling-leader-card');

        rerender(
            <SchedulingComposite
                poll={withVotes(buildPoll(), 1002, 2)}
                lineupId={7}
                matchId={500}
            />,
        );
        await waitFor(() => {
            expect(screen.getByTestId('scheduling-announcer')).toHaveTextContent(
                /is now leading with 2 votes\./,
            );
        });
        const announced = screen.getByTestId('scheduling-announcer').textContent;
        // One sentence, not two: a re-announcement would concatenate.
        expect(announced?.match(/is now leading/g)).toHaveLength(1);
    });
});

describe('SchedulingComposite — an open row menu closes on the swap (§4.1)', () => {
    it('leaves no popover behind when its row becomes the leader', async () => {
        const user = userEvent.setup();
        const { rerender } = renderWithProviders(
            <SchedulingComposite
                poll={organiserPoll()}
                lineupId={7}
                matchId={500}
            />,
        );
        await screen.findByTestId('scheduling-leader-card');
        await user.click(within(row(1002)).getByTestId('scheduling-slot-menu'));
        expect(
            within(row(1002)).getByTestId('scheduling-slot-menu-popover'),
        ).toBeVisible();

        rerender(
            <SchedulingComposite
                poll={withVotes(organiserPoll(), 1002, 2)}
                lineupId={7}
                matchId={500}
            />,
        );

        await waitFor(() => expect(row(1001)).toBeInTheDocument());
        // The promoted time's menu is the CARD's now, and it is closed — the
        // row's popover (and any sheet it portalled) left with the row.
        expect(
            screen.queryAllByTestId('scheduling-slot-menu-popover').filter(
                (el) => !el.hasAttribute('hidden'),
            ),
        ).toHaveLength(0);
        expect(screen.getByTestId('scheduling-leader-menu')).toHaveAttribute(
            'aria-expanded',
            'false',
        );
    });
});

describe('SchedulingComposite — the CARD’s open menu closes on the swap (§4.1)', () => {
    it('never retargets an open leader menu at the new leading time', async () => {
        const user = userEvent.setup();
        const { rerender } = renderWithProviders(
            <SchedulingComposite
                poll={organiserPoll()}
                lineupId={7}
                matchId={500}
            />,
        );
        await screen.findByTestId('scheduling-leader-card');
        // The card names 1001, so its Lock item targets 1001.
        await user.click(screen.getByTestId('scheduling-leader-menu'));
        expect(screen.getByTestId('scheduling-leader-lock')).toBeVisible();

        rerender(
            <SchedulingComposite
                poll={withVotes(organiserPoll(), 1002, 2)}
                lineupId={7}
                matchId={500}
            />,
        );

        // 1002 leads now, so the card's menu is a menu on a DIFFERENT time. It
        // must have unmounted with the time it was opened on — left open, the
        // organiser's next click ends the poll on a time they never opened.
        await waitFor(() => expect(row(1001)).toBeInTheDocument());
        expect(screen.getByTestId('scheduling-leader-menu')).toHaveAttribute(
            'aria-expanded',
            'false',
        );
        expect(
            screen.getByTestId('scheduling-leader-menu-popover'),
        ).not.toBeVisible();
    });
});
