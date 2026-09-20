/**
 * ROK-1548 (P2-1) — the web poll page renders the SHARED slot order.
 *
 * The fixture and `EXPECTED_ORDER` mirror
 * `api/src/discord-bot/services/discord-embed-scheduling.slot-order.spec.ts`
 * exactly: a three-way tie on votes so votes desc → `proposedTime` asc →
 * `id` asc are all exercised, handed to the list in "DB order" so a stable
 * sort with a missing key cannot pass (audit F-03).
 */
import { render, screen } from '@testing-library/react';
import type { ScheduleSlotWithVotesDto } from '@raid-ledger/contract';
import { SchedulingSlotList } from '../SchedulingSlotList';

const EARLY = '2026-04-10T19:00:00.000Z';
const LATE = '2026-04-11T20:00:00.000Z';
const TOP = '2026-04-12T18:00:00.000Z';

/** Same shape the API returns; only the ordering keys matter here. */
function slot(
  id: number,
  proposedTime: string,
  voteCount: number,
): ScheduleSlotWithVotesDto {
  return {
    id,
    matchId: 10,
    proposedTime,
    overlapScore: null,
    suggestedBy: { userId: 1, displayName: 'Ana', avatar: null, discordId: null, customAvatarUrl: null },
    createdAt: '2026-04-01T00:00:00.000Z',
    votes: Array.from({ length: voteCount }, (_, i) => ({
      userId: 100 + i,
      displayName: `Voter ${i}`,
      avatar: null,
      discordId: null,
      customAvatarUrl: null,
    })),
  } as ScheduleSlotWithVotesDto;
}

const TIE_SLOTS = [slot(9, LATE, 3), slot(4, EARLY, 3), slot(1, LATE, 3), slot(8, TOP, 5)];

/** The ONE order every surface must render. */
const EXPECTED_ORDER = ['8', '4', '1', '9'];

function renderList(
  slots: ScheduleSlotWithVotesDto[],
  excludeSlotId: number | null = null,
): void {
  render(
    <SchedulingSlotList
      slots={slots}
      myVotedSlotIds={[]}
      myNoSlotIds={[]}
      slotConflicts={[]}
      readOnly
      canVote={false}
      signedIn={false}
      enrolByVoting={false}
      excludeSlotId={excludeSlotId}
      onToggleVote={() => {}}
      onToggleNo={() => {}}
    />,
  );
}

/** The slot ids the ladder actually rendered, in render order. */
function renderedIds(): (string | null)[] {
  return screen
    .getAllByTestId('schedule-slot')
    .map((el) => el.getAttribute('data-slot-id'));
}

describe('SchedulingSlotList slot order (ROK-1548)', () => {
  it('renders votes desc, then earliest time, then lowest id', () => {
    renderList(TIE_SLOTS);
    const rendered = screen
      .getAllByTestId('schedule-slot')
      .map((el) => el.getAttribute('data-slot-id'));
    expect(rendered).toEqual(EXPECTED_ORDER);
  });

  it('does not mutate the slots array it was given', () => {
    const input = [...TIE_SLOTS];
    renderList(input);
    expect(input.map((s) => s.id)).toEqual([9, 4, 1, 8]);
  });
});

describe('SchedulingSlotList — the leader is listed once (ROK-1635 AC1)', () => {
  it('drops the excluded row and keeps the remaining order untouched', () => {
    renderList(TIE_SLOTS, 8);
    expect(renderedIds()).toEqual(['4', '1', '9']);
  });

  it('AC3 §4.3 — a tie hides exactly one row; the runner-up stays listed', () => {
    renderList(TIE_SLOTS, 4);
    expect(renderedIds()).toEqual(['8', '1', '9']);
  });

  it('AC2 — nothing leads (null), so every time is listed', () => {
    renderList(TIE_SLOTS, null);
    expect(renderedIds()).toEqual(EXPECTED_ORDER);
  });

  it('§4.2 — the leader is the only proposed time: the region says so', () => {
    renderList([slot(8, TOP, 5)], 8);
    expect(screen.queryAllByTestId('schedule-slot')).toHaveLength(0);
    expect(screen.getByText('Suggested Times')).toBeInTheDocument();
    expect(screen.getByTestId('scheduling-slots-only-leader')).toHaveTextContent(
      'That’s the only time proposed so far. Use “Find a better time” to add another.',
    );
    expect(
      screen.queryByText(/No times suggested yet/i),
    ).not.toBeInTheDocument();
  });

  it('keeps the "nothing proposed" copy when there are no slots at all', () => {
    renderList([], null);
    expect(screen.getByText(/No times suggested yet/i)).toBeInTheDocument();
    expect(
      screen.queryByTestId('scheduling-slots-only-leader'),
    ).not.toBeInTheDocument();
  });
});
