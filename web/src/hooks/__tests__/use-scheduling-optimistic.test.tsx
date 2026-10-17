/**
 * ROK-1543 P2-2 — the one-tap vote must move the promoted leader card
 * BEFORE the server answers.
 *
 * Layout B lifts "which time is leading" and "N of M members picked this
 * time" above the fold; both read `slots[].votes`, not `myVotedSlotIds`. An
 * optimistic patch that rewrites only the latter leaves the card pointing at
 * the old winner until the `onSettled` refetch — the exact numbers the story
 * promoted. This test holds the mutation open and asserts the card has
 * already moved.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { JSX } from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SchedulePollPageResponseDto } from '@raid-ledger/contract';
import {
    renderWithProviders,
    createTestQueryClient,
} from '../../test/render-helpers';
import { useSchedulePoll, useToggleScheduleVote } from '../use-scheduling';
import { SchedulingLeaderCard } from '../../components/lineups/cycle-4/SchedulingLeaderCard';

const toggleScheduleVoteMock = vi.fn();
const getSchedulePollMock = vi.fn();

vi.mock('../../lib/api-client', () => ({
    getSchedulePoll: (...args: unknown[]) => getSchedulePollMock(...args),
    toggleScheduleVote: (...args: unknown[]) => toggleScheduleVoteMock(...args),
    suggestSlot: vi.fn(),
    createEventFromSlot: vi.fn(),
    retractAllVotes: vi.fn(),
    getMatchAvailability: vi.fn(),
    getSchedulingBanner: vi.fn(),
    getOtherPolls: vi.fn(),
    cancelSchedulePoll: vi.fn(),
    remindVoters: vi.fn(),
    addPollMembers: vi.fn(),
}));

const VIEWER = {
    userId: 7,
    displayName: 'Viewer',
    avatar: null,
    discordId: null,
    customAvatarUrl: null,
};

/** Two slots: #1 leads 2-1 until the viewer taps #2 and levels it at 2-2. */
function buildPoll(): SchedulePollPageResponseDto {
    const others = [
        { userId: 1, displayName: 'A', avatar: null, discordId: null, customAvatarUrl: null },
        { userId: 2, displayName: 'B', avatar: null, discordId: null, customAvatarUrl: null },
    ];
    return {
        match: { members: [] },
        slots: [
            {
                id: 1,
                matchId: 10,
                proposedTime: '2099-01-01T20:00:00.000Z',
                votes: others,
            },
            {
                id: 2,
                matchId: 10,
                proposedTime: '2099-01-02T20:00:00.000Z',
                votes: [others[0], others[1], VIEWER],
            },
        ],
        myVotedSlotIds: [2],
        lineupStatus: 'active',
        isStandalone: true,
    } as unknown as SchedulePollPageResponseDto;
}

/** Leader card fed by the live query cache + the one-tap toggle. */
function Harness(): JSX.Element {
    const { data } = useSchedulePoll(1, 10);
    const toggle = useToggleScheduleVote();
    if (!data) return <div>loading</div>;
    return (
        <div>
            <SchedulingLeaderCard
                slots={data.slots}
                memberCount={3}
                phaseDeadline={null}
                readOnly={false}
            />
            <button
                onClick={() =>
                    toggle.mutate({
                        lineupId: 1,
                        matchId: 10,
                        slotId: 2,
                        viewer: VIEWER,
                    })
                }
            >
                withdraw
            </button>
        </div>
    );
}

describe('useToggleScheduleVote — optimistic leader movement (ROK-1543)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        getSchedulePollMock.mockResolvedValue(buildPoll());
    });
    afterEach(() => vi.restoreAllMocks());

    it('moves the leader card on the tap, before the mutation resolves', async () => {
        // Hold the server answer open for the whole assertion.
        let release: (v: { voted: boolean }) => void = () => {};
        toggleScheduleVoteMock.mockReturnValue(
            new Promise<{ voted: boolean }>((res) => {
                release = res;
            }),
        );
        const user = userEvent.setup();
        renderWithProviders(<Harness />, {
            queryClient: createTestQueryClient(),
        });

        // Slot #2 leads 3-2 while the viewer's vote is on it.
        await waitFor(() =>
            expect(screen.getByTestId('scheduling-leader-votes')).toHaveTextContent(
                '3 of 3',
            ),
        );

        await user.click(screen.getByRole('button', { name: 'withdraw' }));

        // Withdrawing drops slot #2 to 2 and hands the lead to slot #1 — with
        // the request still in flight.
        await waitFor(() =>
            expect(screen.getByTestId('scheduling-leader-votes')).toHaveTextContent(
                '2 of 3',
            ),
        );
        expect(screen.getByTestId('scheduling-leader-tie')).toBeInTheDocument();
        expect(toggleScheduleVoteMock).toHaveBeenCalledTimes(1);

        release({ voted: false });
    });
});
