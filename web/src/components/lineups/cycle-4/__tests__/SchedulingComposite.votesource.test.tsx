/**
 * ROK-1550 review fix — "Find a better time" carries the visit's vote source.
 *
 * Suggesting a slot auto-votes for it server-side, so a suggestion posted
 * without a source records a REAL yes vote as `web` even when the visitor
 * arrived on the Discord card's `?src=discord` link — the exact undercount the
 * column exists to prevent.
 *
 * Own file (the sibling composite spec is at the 750-line test cap); same
 * harness, so both drive the component under identical conditions.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { GroupedMatchesResponseDto } from '@raid-ledger/contract';
import { renderWithProviders } from '../../../../test/render-helpers';

const toggleVoteMutate = vi.fn();
const suggestSlotMutate = vi.fn();

vi.mock('../../../../hooks/use-scheduling', () => ({
    useToggleScheduleVote: () => ({ mutate: toggleVoteMutate, isPending: false }),
    useSuggestSlot: () => ({ mutate: suggestSlotMutate, isPending: false }),
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

vi.mock('../../../../lib/api-client', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../../lib/api-client')>()),
    getSchedulePoll: vi.fn(),
}));

import { SchedulingComposite } from '../SchedulingComposite';
import { ME, buildPoll } from './scheduling-poll-fixtures';

beforeEach(() => {
    vi.clearAllMocks();
    lineupMatchesData.mockReturnValue(undefined);
    authUser.mockReturnValue({ id: ME });
});

afterEach(() => {
    vi.unstubAllGlobals();
});

/** Open the "Find a better time" sheet and submit a time from it. */
async function suggestATime(): Promise<void> {
    const user = userEvent.setup();
    await user.click(await screen.findByTestId('scheduling-find-better-time'));
    fireEvent.change(await screen.findByTestId('slot-datetime-picker'), {
        target: { value: '2099-09-20T12:00' },
    });
    await user.click(screen.getByRole('button', { name: /^Suggest/ }));
}

describe('SchedulingComposite — suggestion source (ROK-1550)', () => {
    it('attributes a suggestion made off the Discord card to discord', async () => {
        renderWithProviders(
            <SchedulingComposite
                poll={buildPoll()}
                lineupId={7}
                matchId={500}
            />,
            { initialEntries: ['/lineups/7/schedule/500?src=discord'] },
        );

        await suggestATime();

        expect(suggestSlotMutate).toHaveBeenCalledWith(
            expect.objectContaining({ source: 'discord' }),
            expect.anything(),
        );
    });

    it('attributes an ordinary visit to web', async () => {
        renderWithProviders(
            <SchedulingComposite
                poll={buildPoll()}
                lineupId={7}
                matchId={500}
            />,
            { initialEntries: ['/lineups/7/schedule/500'] },
        );

        await suggestATime();

        expect(suggestSlotMutate).toHaveBeenCalledWith(
            expect.objectContaining({
                lineupId: 7,
                matchId: 500,
                source: 'web',
            }),
            expect.anything(),
        );
    });
});
