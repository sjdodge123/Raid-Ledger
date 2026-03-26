/**
 * Tests for LeaderboardRow component (ROK-936).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router-dom';
import type { LineupEntryResponseDto } from '@raid-ledger/contract';
import { LeaderboardRow } from './LeaderboardRow';

function createEntry(overrides: Partial<LineupEntryResponseDto> = {}): LineupEntryResponseDto {
  return {
    id: 1,
    gameId: 42,
    gameName: 'Lethal Company',
    gameCoverUrl: 'https://example.com/cover.jpg',
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

function renderRow(props: Partial<Parameters<typeof LeaderboardRow>[0]> = {}) {
  const defaults = {
    entry: createEntry(),
    rank: 1,
    totalVoters: 8,
    isVoted: false,
    onToggleVote: vi.fn(),
    disabled: false,
    ...props,
  };
  return render(
    <BrowserRouter><LeaderboardRow {...defaults} /></BrowserRouter>,
  );
}

describe('LeaderboardRow — rendering', () => {
  it('renders the game name', () => {
    renderRow();
    expect(screen.getByText('Lethal Company')).toBeInTheDocument();
  });

  it('renders the rank number', () => {
    renderRow({ rank: 3 });
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('renders vote count text', () => {
    renderRow({ entry: createEntry({ voteCount: 5 }) });
    expect(screen.getByText(/5 votes/)).toBeInTheDocument();
  });

  it('shows singular "vote" for count of 1', () => {
    renderRow({ entry: createEntry({ voteCount: 1 }) });
    expect(screen.getByText(/1 vote$/)).toBeInTheDocument();
  });

  it('renders ownership count', () => {
    renderRow({ entry: createEntry({ ownerCount: 11 }) });
    expect(screen.getByText(/11 own/)).toBeInTheDocument();
  });

  it('has data-testid="leaderboard-row"', () => {
    renderRow();
    expect(screen.getByTestId('leaderboard-row')).toBeInTheDocument();
  });
});

describe('LeaderboardRow — voted state', () => {
  it('sets data-voted="true" when voted', () => {
    renderRow({ isVoted: true });
    expect(screen.getByTestId('leaderboard-row')).toHaveAttribute('data-voted', 'true');
  });

  it('sets data-voted="false" when not voted', () => {
    renderRow({ isVoted: false });
    expect(screen.getByTestId('leaderboard-row')).toHaveAttribute('data-voted', 'false');
  });

  it('shows vote-checkmark when voted', () => {
    renderRow({ isVoted: true });
    expect(screen.getByTestId('vote-checkmark')).toBeInTheDocument();
  });
});

describe('LeaderboardRow — interaction', () => {
  it('calls onToggleVote on click', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    renderRow({ onToggleVote: onToggle });
    await user.click(screen.getByTestId('vote-toggle'));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('does not call onToggleVote when disabled', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    renderRow({ onToggleVote: onToggle, disabled: true });
    await user.click(screen.getByTestId('vote-toggle'));
    expect(onToggle).not.toHaveBeenCalled();
  });
});
