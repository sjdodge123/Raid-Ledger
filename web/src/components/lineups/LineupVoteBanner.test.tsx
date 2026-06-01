/**
 * Tests for LineupVoteBanner — VotingBanner sub-component (ROK-1119).
 *
 * The VotingBanner is the in-page CTA that appears on a game's detail page
 * when the game is up for vote on the active community lineup. ROK-1119
 * requires explicit feedback (success / error toast) after the vote
 * mutation resolves, so users know their vote landed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/render-helpers';

// Hooks: mock so we control the data shapes the banner consumes.
vi.mock('../../hooks/use-lineups', () => ({
    useLineupBanner: vi.fn(),
    useLineupDetail: vi.fn(),
    useToggleVote: vi.fn(),
}));

vi.mock('../../hooks/use-tiebreaker', () => ({
    useTiebreakerDetail: vi.fn(),
}));

// Toast: mock to spy on success / error.
vi.mock('../../lib/toast', () => ({
    toast: {
        success: vi.fn(),
        error: vi.fn(),
    },
}));

import { LineupVoteBanner } from './LineupVoteBanner';
import {
    useLineupBanner,
    useLineupDetail,
    useToggleVote,
} from '../../hooks/use-lineups';
import { useTiebreakerDetail } from '../../hooks/use-tiebreaker';
import { toast } from '../../lib/toast';

const mockUseLineupBanner = vi.mocked(useLineupBanner);
const mockUseLineupDetail = vi.mocked(useLineupDetail);
const mockUseToggleVote = vi.mocked(useToggleVote);
const mockUseTiebreakerDetail = vi.mocked(useTiebreakerDetail);

const mockMutate = vi.fn();

const GAME_ID = 42;
const LINEUP_ID = 7;

function setupVotingBanner({ hasVoted = false }: { hasVoted?: boolean } = {}) {
    mockUseLineupBanner.mockReturnValue({
        data: {
            id: LINEUP_ID,
            status: 'voting',
            tiebreakerActive: false,
            entries: [
                { gameId: GAME_ID, gameName: 'Lethal Company' },
            ],
        },
    } as unknown as ReturnType<typeof useLineupBanner>);

    mockUseLineupDetail.mockReturnValue({
        data: {
            id: LINEUP_ID,
            myVotes: hasVoted ? [GAME_ID] : [],
        },
    } as unknown as ReturnType<typeof useLineupDetail>);

    mockUseTiebreakerDetail.mockReturnValue({
        data: null,
    } as unknown as ReturnType<typeof useTiebreakerDetail>);

    mockUseToggleVote.mockReturnValue({
        mutate: mockMutate,
        isPending: false,
    } as unknown as ReturnType<typeof useToggleVote>);
}

describe('LineupVoteBanner — VotingBanner vote feedback (ROK-1119)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockMutate.mockReset();
    });

    it('shows a success toast after a new vote is recorded', async () => {
        const user = userEvent.setup();
        setupVotingBanner({ hasVoted: false });

        renderWithProviders(<LineupVoteBanner gameId={GAME_ID} />);

        await user.click(screen.getByRole('button', { name: /vote/i }));

        expect(mockMutate).toHaveBeenCalledTimes(1);
        const [vars, opts] = mockMutate.mock.calls[0];
        expect(vars).toEqual({ lineupId: LINEUP_ID, gameId: GAME_ID });
        expect(opts).toBeDefined();
        expect(typeof opts.onSuccess).toBe('function');

        // Server returns the updated lineup with the vote now recorded
        opts.onSuccess?.({ myVotes: [GAME_ID] } as never, vars, undefined);

        expect(toast.success).toHaveBeenCalledTimes(1);
        expect(vi.mocked(toast.success).mock.calls[0][0]).toMatch(/vote recorded/i);
        expect(toast.error).not.toHaveBeenCalled();
    });

    it('shows a success toast after an existing vote is removed', async () => {
        const user = userEvent.setup();
        setupVotingBanner({ hasVoted: true });

        renderWithProviders(<LineupVoteBanner gameId={GAME_ID} />);

        // When hasVoted=true the button label is "✓ Voted" — click it to unvote
        await user.click(screen.getByRole('button', { name: /voted/i }));

        expect(mockMutate).toHaveBeenCalledTimes(1);
        const [vars, opts] = mockMutate.mock.calls[0];
        expect(vars).toEqual({ lineupId: LINEUP_ID, gameId: GAME_ID });
        expect(typeof opts.onSuccess).toBe('function');

        // Server returns the updated lineup with the vote no longer present
        opts.onSuccess?.({ myVotes: [] } as never, vars, undefined);

        expect(toast.success).toHaveBeenCalledTimes(1);
        expect(vi.mocked(toast.success).mock.calls[0][0]).toMatch(/vote removed/i);
        expect(toast.error).not.toHaveBeenCalled();
    });

    it('shows an error toast when the vote mutation fails', async () => {
        const user = userEvent.setup();
        setupVotingBanner({ hasVoted: false });

        renderWithProviders(<LineupVoteBanner gameId={GAME_ID} />);

        await user.click(screen.getByRole('button', { name: /vote/i }));

        expect(mockMutate).toHaveBeenCalledTimes(1);
        const [, opts] = mockMutate.mock.calls[0];
        expect(typeof opts.onError).toBe('function');

        opts.onError?.(new Error('Voting closed'), { lineupId: LINEUP_ID, gameId: GAME_ID } as never, undefined);

        expect(toast.error).toHaveBeenCalledTimes(1);
        expect(vi.mocked(toast.error).mock.calls[0][0]).toBe('Voting closed');
        expect(toast.success).not.toHaveBeenCalled();
    });
});

// ROK-1302: the game-detail decided banner drops scheduling copy when the
// lineup opted out of the scheduling phase.
describe('LineupVoteBanner — DecidedBanner scheduling opt-out (ROK-1302)', () => {
    beforeEach(() => vi.clearAllMocks());

    function setupDecidedBanner(includeSchedulingPhase: boolean) {
        mockUseLineupBanner.mockReturnValue({
            data: {
                id: LINEUP_ID,
                status: 'decided',
                tiebreakerActive: false,
                includeSchedulingPhase,
                entries: [{ gameId: GAME_ID, gameName: 'Lethal Company' }],
            },
        } as unknown as ReturnType<typeof useLineupBanner>);
        mockUseTiebreakerDetail.mockReturnValue({
            data: null,
        } as unknown as ReturnType<typeof useTiebreakerDetail>);
    }

    it('shows "schedule a time" copy when scheduling is enabled', () => {
        setupDecidedBanner(true);
        renderWithProviders(<LineupVoteBanner gameId={GAME_ID} />);
        expect(screen.getByText(/schedule a time to play/i)).toBeInTheDocument();
    });

    it('drops "schedule a time" copy when scheduling is disabled', () => {
        setupDecidedBanner(false);
        renderWithProviders(<LineupVoteBanner gameId={GAME_ID} />);
        expect(screen.queryByText(/schedule a time/i)).toBeNull();
        expect(screen.getByText(/won this lineup/i)).toBeInTheDocument();
    });
});
