/**
 * ROK-1543 (P1-1) — the Layout-B leader card.
 *
 * AC1: the leading time, its vote count, the member count and the deadline
 * are all in ONE card that sits directly below the kept poll header, above
 * the slot list — so a late joiner gets "when are we playing?" in one glance
 * on a 375px viewport without scrolling.
 * AC2: when the top two slots are level the card says so AND names the rule
 * (earliest time wins).
 */
import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import type { ScheduleSlotWithVotesDto } from '@raid-ledger/contract';
import { renderWithProviders } from '../../../../test/render-helpers';
import { SchedulingLeaderCard } from '../SchedulingLeaderCard';

/** Build a slot with `voteCount` synthetic voters. */
function makeVoters(count: number, offset = 0) {
  return Array.from({ length: count }, (_, i) => ({
    userId: offset + i + 1,
    displayName: `User ${offset + i + 1}`,
    avatar: null,
    discordId: null,
    customAvatarUrl: null,
  }));
}

function makeSlot(
  id: number,
  proposedTime: string,
  voteCount: number,
  noCount = 0,
): ScheduleSlotWithVotesDto {
  return {
    id,
    matchId: 500,
    proposedTime,
    overlapScore: 0,
    suggestedBy: 'user',
    createdAt: '2026-06-01T00:00:00.000Z',
    votes: makeVoters(voteCount),
    noVotes: makeVoters(noCount, 100),
  } as unknown as ScheduleSlotWithVotesDto;
}

const EARLY = '2026-07-01T18:00:00.000Z';
const LATE = '2026-07-02T18:00:00.000Z';
const DEADLINE = '2030-07-01T12:00:00.000Z';

function renderCard(
  slots: ScheduleSlotWithVotesDto[],
  overrides: { memberCount?: number; readOnly?: boolean } = {},
) {
  return renderWithProviders(
    <SchedulingLeaderCard
      slots={slots}
      memberCount={overrides.memberCount ?? 5}
      phaseDeadline={DEADLINE}
      readOnly={overrides.readOnly ?? false}
    />,
  );
}

describe('SchedulingLeaderCard (ROK-1543 AC1)', () => {
  it('shows the leading time, its votes, the member count and the deadline', () => {
    renderCard([makeSlot(1, EARLY, 3), makeSlot(2, LATE, 1)]);

    const card = screen.getByTestId('scheduling-leader-card');
    expect(card).toBeInTheDocument();
    // Leading slot is the 3-vote one, not the later 1-vote one.
    expect(screen.getByTestId('scheduling-leader-time').textContent).toBe(
      new Date(EARLY).toLocaleString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      }),
    );
    // Vote count AND member count, in one line.
    expect(screen.getByTestId('scheduling-leader-votes').textContent).toContain(
      '3 of 5',
    );
    // The deadline lives inside the card — one banner, not two.
    expect(card).toContainElement(screen.getByTestId('poll-deadline-banner'));
  });

  // ROK-1617 AC6: "3 of 4 members picked this time" on a 3-yes/1-no poll
  // implies the fourth member has not answered. The anti-vote tally has to
  // be on the card, worded exactly as the slot rows word it.
  it('names the members who said the leading time does not work', () => {
    renderCard([makeSlot(1, EARLY, 3, 1)], { memberCount: 4 });

    expect(screen.getByTestId('scheduling-leader-votes').textContent).toContain(
      '3 of 4',
    );
    expect(
      screen.getByTestId('scheduling-leader-no-count').textContent,
    ).toContain('1 can’t');
  });

  it('shows no anti-vote clause when nobody said the leading time is bad', () => {
    renderCard([makeSlot(1, EARLY, 3, 0)], { memberCount: 4 });

    expect(
      screen.queryByTestId('scheduling-leader-no-count'),
    ).not.toBeInTheDocument();
  });

  it('says "Leading" while the poll is open', () => {
    renderCard([makeSlot(1, EARLY, 2)]);
    expect(screen.getByTestId('scheduling-leader-status').textContent).toContain(
      'Leading',
    );
  });

  it('says nobody has voted yet when the leader has zero votes', () => {
    renderCard([makeSlot(1, EARLY, 0)]);
    expect(screen.getByTestId('scheduling-leader-status').textContent).toMatch(
      /no votes yet/i,
    );
  });

  // ROK-1617 item D (operator: "No time worked"): every proposed time is
  // net-negative, so the card must NOT crown one of them.
  it('says no time works yet when every proposed time is rejected', () => {
    renderCard([makeSlot(1, EARLY, 1, 3), makeSlot(2, LATE, 0, 2)]);
    expect(screen.getByTestId('scheduling-leader-card').textContent).toMatch(
      /no time works for the group yet/i,
    );
    expect(screen.queryByTestId('scheduling-leader-time')).toBeNull();
    // Not the "nothing proposed" state — times exist, they just lost.
    expect(screen.getByTestId('scheduling-leader-card').textContent).not.toMatch(
      /no times proposed yet/i,
    );
  });

  it('renders an empty state when no times have been proposed', () => {
    renderCard([]);
    expect(screen.getByTestId('scheduling-leader-card').textContent).toMatch(
      /no times proposed yet/i,
    );
    expect(screen.queryByTestId('scheduling-leader-time')).toBeNull();
  });
});

describe('SchedulingLeaderCard tie disclosure (ROK-1543 AC2)', () => {
  it('names the tiebreak rule when the top two slots are level', () => {
    renderCard([makeSlot(1, LATE, 2), makeSlot(2, EARLY, 2)]);

    const tie = screen.getByTestId('scheduling-leader-tie');
    expect(tie.textContent).toMatch(/tied/i);
    expect(tie.textContent).toMatch(/earliest time wins/i);
    // The tiebreak resolved to the EARLIER slot.
    expect(screen.getByTestId('scheduling-leader-time').textContent).toBe(
      new Date(EARLY).toLocaleString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      }),
    );
  });

  // ROK-1543 P2-3: an all-past open poll used to render "Leading — <a time
  // in the past>" with no marker, while the ladder row flagged the same slot.
  it('flags a leading slot whose time has already passed', () => {
    const past = new Date(Date.now() - 3_600_000).toISOString();
    renderCard([makeSlot(1, past, 3)]);
    expect(screen.getByTestId('scheduling-leader-past')).toHaveTextContent(
      'already passed',
    );
  });

  it('does not flag a leading slot that is still ahead', () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    renderCard([makeSlot(1, future, 3)]);
    expect(screen.queryByTestId('scheduling-leader-past')).toBeNull();
  });

  it('says nothing about ties when there is a clear leader', () => {
    renderCard([makeSlot(1, EARLY, 3), makeSlot(2, LATE, 1)]);
    expect(screen.queryByTestId('scheduling-leader-tie')).toBeNull();
  });
});
