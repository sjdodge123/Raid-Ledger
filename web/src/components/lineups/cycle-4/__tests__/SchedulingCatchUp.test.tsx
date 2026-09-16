/**
 * ROK-1545 (P1-3) AC5 — a member who joined after voting started gets a
 * catch-up line (leader, votes so far, time remaining), and the poll says who
 * is still outstanding (audit F-05 / P-6, Layout C's catch-up + "who hasn't
 * voted" folded into Layout B).
 */
import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import type { MatchDetailResponseDto } from '@raid-ledger/contract';
import { renderWithProviders } from '../../../../test/render-helpers';
import { SchedulingCatchUpLine } from '../SchedulingCatchUpLine';
import { SchedulingPendingVoters } from '../SchedulingPendingVoters';
import { deriveCatchUp } from '../scheduling-catch-up';

/** One enrolled poll member, as the poll page response carries it. */
type PollMember = MatchDetailResponseDto['members'][number];

const ME = 99;

/** Build a poll member row. */
function member(
  userId: number,
  joinedAt: string,
  submittedAt: string | null,
): PollMember {
  return {
    id: userId,
    matchId: 500,
    userId,
    source: 'voted',
    createdAt: joinedAt,
    joinedAt,
    displayName: `User ${userId}`,
    avatar: null,
    discordId: null,
    customAvatarUrl: null,
    schedulingSubmittedAt: submittedAt,
  };
}

const EARLY = '2026-06-01T10:00:00.000Z';
const LATE = '2026-06-02T10:00:00.000Z';

describe('deriveCatchUp (ROK-1545 AC5)', () => {
  it('flags a member who joined after the first vote was cast', () => {
    const result = deriveCatchUp(
      [member(1, EARLY, EARLY), member(ME, LATE, null)],
      ME,
    );
    expect(result).toEqual({ votersSoFar: 1, memberCount: 2 });
  });

  it('does not flag a founding member who was there before any vote', () => {
    expect(
      deriveCatchUp([member(ME, EARLY, null), member(1, LATE, LATE)], ME),
    ).toBeNull();
  });

  it('does not flag a late joiner who has already voted', () => {
    expect(
      deriveCatchUp([member(1, EARLY, EARLY), member(ME, LATE, LATE)], ME),
    ).toBeNull();
  });

  it('is null for a viewer who is not a member', () => {
    expect(deriveCatchUp([member(1, EARLY, EARLY)], ME)).toBeNull();
    expect(deriveCatchUp([member(1, EARLY, EARLY)], null)).toBeNull();
  });
});

describe('SchedulingCatchUpLine (ROK-1545 AC5)', () => {
  it('names the leader, the votes so far and the time remaining', () => {
    renderWithProviders(
      <SchedulingCatchUpLine
        catchUp={{ votersSoFar: 6, memberCount: 9 }}
        leaderLabel="Thu, Jun 10 at 8:00 PM"
        deadlineLabel="closes in 2 days"
      />,
    );
    const line = screen.getByTestId('scheduling-catch-up');
    expect(line).toHaveTextContent(/you joined late/i);
    expect(line).toHaveTextContent('6 of 9');
    expect(line).toHaveTextContent('Thu, Jun 10 at 8:00 PM');
    expect(line).toHaveTextContent('closes in 2 days');
  });

  it('still orients a late joiner when nothing is leading yet', () => {
    renderWithProviders(
      <SchedulingCatchUpLine
        catchUp={{ votersSoFar: 2, memberCount: 5 }}
        leaderLabel={null}
        deadlineLabel={null}
      />,
    );
    expect(screen.getByTestId('scheduling-catch-up')).toHaveTextContent(
      /no time is ahead yet/i,
    );
  });
});

describe('SchedulingPendingVoters (ROK-1545 AC5)', () => {
  it('lists the members who have not voted yet', () => {
    renderWithProviders(
      <SchedulingPendingVoters
        members={[
          member(1, EARLY, EARLY),
          member(2, EARLY, null),
          member(3, EARLY, null),
        ]}
      />,
    );
    const panel = screen.getByTestId('scheduling-pending-voters');
    expect(panel).toHaveTextContent(/still to vote/i);
    expect(panel).toHaveTextContent('2');
  });

  it('renders nothing once everyone has voted', () => {
    renderWithProviders(
      <SchedulingPendingVoters members={[member(1, EARLY, EARLY)]} />,
    );
    expect(screen.queryByTestId('scheduling-pending-voters')).toBeNull();
  });
});
