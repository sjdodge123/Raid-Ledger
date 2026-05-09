/**
 * Tests for VotingLeaderboard component (ROK-936, ROK-1119).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { LineupEntryResponseDto } from '@raid-ledger/contract';

// Mock the hooks module
vi.mock('../../hooks/use-lineups', () => ({
  useToggleVote: vi.fn(),
}));

// Mock toast so we can spy on success/error calls (ROK-1119)
vi.mock('../../lib/toast', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

import { VotingLeaderboard } from './VotingLeaderboard';
import { useToggleVote } from '../../hooks/use-lineups';
import { toast } from '../../lib/toast';

const mockMutate = vi.fn();
const mockUseToggleVote = vi.mocked(useToggleVote);

function createEntry(overrides: Partial<LineupEntryResponseDto> = {}): LineupEntryResponseDto {
  return {
    id: 1,
    gameId: 42,
    gameName: 'Lethal Company',
    gameCoverUrl: null,
    nominatedBy: { id: 1, displayName: 'Admin' },
    note: null,
    carriedOver: false,
    voteCount: 5,
    createdAt: '2026-03-01T00:00:00Z',
    ownerCount: 11,
    totalMembers: 12,
    nonOwnerCount: 1,
    wishlistCount: 0,
    itadCurrentPrice: 9.99,
    itadCurrentCut: null,
    itadCurrentShop: null,
    itadCurrentUrl: null,
    ...overrides,
  };
}

function renderLeaderboard(props: Partial<Parameters<typeof VotingLeaderboard>[0]> = {}) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const defaults = {
    entries: [
      createEntry({ id: 1, gameId: 42, gameName: 'Lethal Company', voteCount: 5, ownerCount: 11 }),
      createEntry({ id: 2, gameId: 43, gameName: 'Deep Rock', voteCount: 4, ownerCount: 10 }),
      createEntry({ id: 3, gameId: 44, gameName: 'Phasmophobia', voteCount: 3, ownerCount: 9 }),
    ],
    lineupId: 1,
    myVotes: [42],
    totalVoters: 8,
    totalMembers: 12,
    ...props,
  };
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <VotingLeaderboard {...defaults} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('VotingLeaderboard — rendering', () => {
  beforeEach(() => {
    mockMutate.mockReset();
    mockUseToggleVote.mockReturnValue({ mutate: mockMutate, isPending: false } as never);
  });

  it('has data-testid="voting-leaderboard"', () => {
    renderLeaderboard();
    expect(screen.getByTestId('voting-leaderboard')).toBeInTheDocument();
  });

  it('renders all entries as leaderboard rows', () => {
    renderLeaderboard();
    expect(screen.getAllByTestId('leaderboard-row')).toHaveLength(3);
  });

  it('renders vote status bar', () => {
    renderLeaderboard({ myVotes: [42] });
    expect(screen.getByText(/1 of 3 votes/)).toBeInTheDocument();
  });

  it('sorts entries by voteCount descending', () => {
    const entries = [
      createEntry({ id: 1, gameId: 42, gameName: 'Low', voteCount: 1, ownerCount: 5 }),
      createEntry({ id: 2, gameId: 43, gameName: 'High', voteCount: 10, ownerCount: 5 }),
      createEntry({ id: 3, gameId: 44, gameName: 'Mid', voteCount: 5, ownerCount: 5 }),
    ];
    renderLeaderboard({ entries });
    const rows = screen.getAllByTestId('leaderboard-row');
    expect(rows[0]).toHaveTextContent('High');
    expect(rows[1]).toHaveTextContent('Mid');
    expect(rows[2]).toHaveTextContent('Low');
  });

  it('uses ownerCount as tiebreaker when votes are equal', () => {
    const entries = [
      createEntry({ id: 1, gameId: 42, gameName: 'Fewer Owners', voteCount: 5, ownerCount: 3 }),
      createEntry({ id: 2, gameId: 43, gameName: 'More Owners', voteCount: 5, ownerCount: 8 }),
    ];
    renderLeaderboard({ entries });
    const rows = screen.getAllByTestId('leaderboard-row');
    expect(rows[0]).toHaveTextContent('More Owners');
    expect(rows[1]).toHaveTextContent('Fewer Owners');
  });
});

describe('VotingLeaderboard — voting', () => {
  beforeEach(() => {
    mockMutate.mockReset();
    mockUseToggleVote.mockReturnValue({ mutate: mockMutate, isPending: false } as never);
  });

  it('marks voted entries with data-voted="true"', () => {
    renderLeaderboard({ myVotes: [42] });
    const rows = screen.getAllByTestId('leaderboard-row');
    // First entry (Lethal Company, gameId=42) should be voted
    expect(rows[0]).toHaveAttribute('data-voted', 'true');
    // Others should not
    expect(rows[1]).toHaveAttribute('data-voted', 'false');
  });

  it('calls mutate with lineupId and gameId on vote toggle', async () => {
    const user = userEvent.setup();
    renderLeaderboard({ myVotes: [] });
    const toggleButtons = screen.getAllByTestId('vote-toggle');
    await user.click(toggleButtons[0]);
    expect(mockMutate).toHaveBeenCalledWith(
      { lineupId: 1, gameId: 42 },
      expect.any(Object),
    );
  });

  it('disables vote toggle on unvoted games when 3 votes used', async () => {
    const user = userEvent.setup();
    renderLeaderboard({ myVotes: [42, 43, 44] });
    // All 3 are voted, so buttons should still be enabled (to unvote)
    // But there are no unvoted games. Let's add a 4th
    const entries = [
      createEntry({ id: 1, gameId: 42, gameName: 'A', voteCount: 5 }),
      createEntry({ id: 2, gameId: 43, gameName: 'B', voteCount: 4 }),
      createEntry({ id: 3, gameId: 44, gameName: 'C', voteCount: 3 }),
      createEntry({ id: 4, gameId: 45, gameName: 'D', voteCount: 2 }),
    ];
    const { unmount } = renderLeaderboard({ entries, myVotes: [42, 43, 44] });
    const toggleButtons = screen.getAllByTestId('vote-toggle');
    // The 4th (D, unvoted) should be disabled
    const dButton = toggleButtons[toggleButtons.length - 1];
    await user.click(dButton);
    expect(mockMutate).not.toHaveBeenCalled();
    unmount();
  });
});

/**
 * ROK-1119 — vote feedback toasts.
 *
 * After toggling a vote in the leaderboard, the user must get explicit
 * confirmation: a success toast on add ("Vote recorded"), a success toast
 * on remove ("Vote removed"), and the existing error toast must keep firing.
 *
 * The mutation's `mutate` is mocked, so we drive the result by invoking
 * the options callbacks (onSuccess / onError) passed to mutate directly.
 */
describe('VotingLeaderboard — vote feedback (ROK-1119)', () => {
  beforeEach(() => {
    mockMutate.mockReset();
    vi.mocked(toast.success).mockReset();
    vi.mocked(toast.error).mockReset();
    mockUseToggleVote.mockReturnValue({ mutate: mockMutate, isPending: false } as never);
  });

  it('shows a success toast when a new vote is recorded', async () => {
    const user = userEvent.setup();
    renderLeaderboard({ myVotes: [] });

    const toggleButtons = screen.getAllByTestId('vote-toggle');
    await user.click(toggleButtons[0]);

    // Component should have called mutate with onSuccess option
    expect(mockMutate).toHaveBeenCalledTimes(1);
    const [, opts] = mockMutate.mock.calls[0];
    expect(opts).toBeDefined();
    expect(typeof opts.onSuccess).toBe('function');

    // Simulate the server returning success — the component should toast.success
    // After add: server's myVotes now includes gameId 42
    opts.onSuccess?.({ myVotes: [42] } as never, { lineupId: 1, gameId: 42 } as never, undefined);

    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(vi.mocked(toast.success).mock.calls[0][0]).toMatch(/vote recorded/i);
  });

  it('shows a success toast when an existing vote is removed', async () => {
    const user = userEvent.setup();
    // gameId=42 is already in myVotes, so clicking it removes the vote
    renderLeaderboard({ myVotes: [42] });

    const toggleButtons = screen.getAllByTestId('vote-toggle');
    // First row (Lethal Company, gameId=42) is the voted one
    await user.click(toggleButtons[0]);

    expect(mockMutate).toHaveBeenCalledTimes(1);
    const [vars, opts] = mockMutate.mock.calls[0];
    expect(vars).toEqual({ lineupId: 1, gameId: 42 });
    expect(typeof opts.onSuccess).toBe('function');

    // Simulate the toggle-off success — server's myVotes no longer includes gameId 42
    opts.onSuccess?.({ myVotes: [] } as never, vars, undefined);

    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(vi.mocked(toast.success).mock.calls[0][0]).toMatch(/vote removed/i);
  });

  it('still fires the existing error toast when the mutation fails (regression)', async () => {
    const user = userEvent.setup();
    renderLeaderboard({ myVotes: [] });

    const toggleButtons = screen.getAllByTestId('vote-toggle');
    await user.click(toggleButtons[0]);

    const [, opts] = mockMutate.mock.calls[0];
    expect(typeof opts.onError).toBe('function');

    opts.onError?.(new Error('Voting closed'), { lineupId: 1, gameId: 42 } as never, undefined);

    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(vi.mocked(toast.error).mock.calls[0][0]).toBe('Voting closed');
    // Should NOT also fire success on error
    expect(toast.success).not.toHaveBeenCalled();
  });
});
