/**
 * Tests for MatchCard (ROK-1411).
 *
 * Covers the two ROK-1411 additions:
 *  - Sub-line: "X of Y players" (+ "Group is full" at/over cap) when the game
 *    exposes a `playerCap`; personal / raw-count fallback when it is null.
 *  - CTA: "View Event →" when the match is linked to an event (overriding the
 *    schedule-poll CTA and the ROK-1302 opt-out gate); "Pick a time →"
 *    otherwise.
 */
import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../../test/render-helpers';
import { MatchCard } from './MatchCard';
import type { MatchDetailResponseDto } from '@raid-ledger/contract';

function makeMember(
  overrides: Partial<MatchDetailResponseDto['members'][number]> = {},
): MatchDetailResponseDto['members'][number] {
  return {
    id: 1,
    matchId: 1,
    userId: 99,
    source: 'voted',
    createdAt: '2026-01-01T00:00:00Z',
    displayName: 'Member',
    avatar: null,
    discordId: null,
    customAvatarUrl: null,
    schedulingSubmittedAt: null,
    ...overrides,
  };
}

function makeMatch(
  overrides: Partial<MatchDetailResponseDto> = {},
): MatchDetailResponseDto {
  return {
    id: 7,
    lineupId: 11,
    gameId: 42,
    gameName: 'Valheim',
    gameCoverUrl: null,
    status: 'scheduling',
    thresholdMet: true,
    voteCount: 6,
    votePercentage: 60,
    fitType: 'normal',
    linkedEventId: null,
    playerCap: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    members: [makeMember()],
    ...overrides,
  };
}

function renderCard(
  match: MatchDetailResponseDto,
  opts: { isPersonal?: boolean; schedulingEnabled?: boolean } = {},
) {
  return renderWithProviders(
    <MatchCard
      match={match}
      lineupId={match.lineupId}
      isPersonal={opts.isPersonal ?? true}
      schedulingEnabled={opts.schedulingEnabled ?? true}
    />,
  );
}

// ---------------------------------------------------------------------------
// Sub-line: playerCap null fallback
// ---------------------------------------------------------------------------

describe('MatchCard sub-line — playerCap null fallback', () => {
  it('personal card reads "You + N others" (no denominator) when playerCap is null', () => {
    const match = makeMatch({
      playerCap: null,
      members: [
        makeMember({ id: 1, userId: 99 }),
        makeMember({ id: 2, userId: 200 }),
        makeMember({ id: 3, userId: 201 }),
      ],
    });
    renderCard(match, { isPersonal: true });

    expect(screen.getByText(/^You \+ 2 others$/i)).toBeInTheDocument();
    expect(screen.queryByText(/of \d+/i)).toBeNull();
    expect(screen.queryByText(/group is full/i)).toBeNull();
  });

  it('non-personal card reads "N players" when playerCap is null', () => {
    const match = makeMatch({
      playerCap: null,
      members: [
        makeMember({ id: 1, userId: 200 }),
        makeMember({ id: 2, userId: 201 }),
        makeMember({ id: 3, userId: 202 }),
      ],
    });
    renderCard(match, { isPersonal: false });

    expect(screen.getByText(/^3 players$/i)).toBeInTheDocument();
    expect(screen.queryByText(/of \d+/i)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Sub-line: playerCap non-null → "X of Y players"
// ---------------------------------------------------------------------------

describe('MatchCard sub-line — playerCap denominator', () => {
  it('renders "X of Y players" when the group is below cap', () => {
    const match = makeMatch({
      playerCap: 10,
      members: [
        makeMember({ id: 1, userId: 99 }),
        makeMember({ id: 2, userId: 200 }),
        makeMember({ id: 3, userId: 201 }),
        makeMember({ id: 4, userId: 202 }),
      ],
    });
    renderCard(match, { isPersonal: true });

    expect(screen.getByText(/^4 of 10 players$/i)).toBeInTheDocument();
    expect(screen.queryByText(/group is full/i)).toBeNull();
  });

  it('appends "Group is full" when the group is exactly at cap', () => {
    const match = makeMatch({
      playerCap: 3,
      members: [
        makeMember({ id: 1, userId: 99 }),
        makeMember({ id: 2, userId: 200 }),
        makeMember({ id: 3, userId: 201 }),
      ],
    });
    renderCard(match, { isPersonal: false });

    expect(screen.getByText(/3 of 3 players · Group is full/i)).toBeInTheDocument();
  });

  it('appends "Group is full" when the group is over cap', () => {
    const match = makeMatch({
      playerCap: 2,
      members: [
        makeMember({ id: 1, userId: 99 }),
        makeMember({ id: 2, userId: 200 }),
        makeMember({ id: 3, userId: 201 }),
      ],
    });
    renderCard(match, { isPersonal: false });

    expect(screen.getByText(/3 of 2 players · Group is full/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// CTA: View Event vs Pick a time
// ---------------------------------------------------------------------------

describe('MatchCard CTA — linked event vs schedule poll', () => {
  it('renders "View Event →" to /events/:id when linkedEventId is set (no schedule link)', () => {
    const match = makeMatch({ id: 7, linkedEventId: 55 });
    renderCard(match, { isPersonal: true, schedulingEnabled: true });

    const cta = screen.getByRole('link', { name: /view event/i });
    expect(cta).toHaveAttribute('href', '/events/55');
    expect(screen.queryByRole('link', { name: /pick a time/i })).toBeNull();
  });

  it('renders "View Event →" even when schedulingEnabled is false (ROK-1302 opt-out interplay)', () => {
    const match = makeMatch({ id: 7, linkedEventId: 88 });
    renderCard(match, { isPersonal: true, schedulingEnabled: false });

    const cta = screen.getByRole('link', { name: /view event/i });
    expect(cta).toHaveAttribute('href', '/events/88');
    expect(screen.queryByRole('link', { name: /pick a time/i })).toBeNull();
  });

  it('renders "Pick a time →" when linkedEventId is null (existing behavior)', () => {
    const match = makeMatch({ id: 7, lineupId: 11, linkedEventId: null });
    renderCard(match, { isPersonal: true, schedulingEnabled: true });

    const cta = screen.getByRole('link', { name: /pick a time/i });
    expect(cta).toHaveAttribute('href', '/community-lineup/11/schedule/7');
    expect(screen.queryByRole('link', { name: /view event/i })).toBeNull();
  });

  it('renders no CTA for non-personal cards', () => {
    const match = makeMatch({ id: 7, linkedEventId: null });
    renderCard(match, { isPersonal: false, schedulingEnabled: true });

    expect(screen.queryByRole('link', { name: /pick a time/i })).toBeNull();
    expect(screen.queryByRole('link', { name: /view event/i })).toBeNull();
  });
});
