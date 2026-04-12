/**
 * Tests for SuggestedTimes component and VoteStep in SchedulingWizard (ROK-1017).
 *
 * AC2: Vote buttons must be disabled while a mutation is in-flight.
 * VoteStep wires toggle.isPending to disable buttons during flight.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse, delay } from 'msw';
import type { SchedulePollPageResponseDto } from '@raid-ledger/contract';
import { server } from '../../test/mocks/server';
import { renderWithProviders } from '../../test/render-helpers';
import { SuggestedTimes } from './SuggestedTimes';
import { SchedulingWizard } from './SchedulingWizard';

const API_BASE = 'http://localhost:3000';

/** Build a minimal SchedulePollPageResponseDto for tests. */
function buildPollData(
  overrides: Partial<SchedulePollPageResponseDto> = {},
): SchedulePollPageResponseDto {
  return {
    match: {
      id: 10,
      lineupId: 1,
      gameId: 5,
      status: 'scheduling',
      thresholdMet: true,
      voteCount: 3,
      votePercentage: 75,
      fitType: 'normal',
      linkedEventId: null,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      gameName: 'Test Game',
      gameCoverUrl: null,
      members: [
        {
          id: 1,
          matchId: 10,
          userId: 1,
          source: 'voted',
          createdAt: '2026-01-01T00:00:00Z',
          displayName: 'Alice',
          avatar: null,
          discordId: null,
          customAvatarUrl: null,
        },
      ],
    },
    slots: [
      {
        id: 100,
        matchId: 10,
        proposedTime: '2099-04-10T19:00:00.000Z',
        overlapScore: null,
        suggestedBy: 'system',
        createdAt: '2026-01-01T00:00:00Z',
        votes: [{ userId: 2, displayName: 'Bob' }],
      },
      {
        id: 101,
        matchId: 10,
        proposedTime: '2099-04-11T20:00:00.000Z',
        overlapScore: null,
        suggestedBy: 'user',
        createdAt: '2026-01-01T00:00:00Z',
        votes: [],
      },
    ],
    myVotedSlotIds: [],
    lineupStatus: 'decided',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// SuggestedTimes — readOnly prop (baseline behavior)
// ---------------------------------------------------------------------------

describe('SuggestedTimes — readOnly disables buttons', () => {
  it('buttons are disabled when readOnly is true', () => {
    const poll = buildPollData();
    render(
      <SuggestedTimes
        slots={poll.slots}
        myVotedSlotIds={[]}
        readOnly={true}
        onToggleVote={vi.fn()}
        onSuggestSlot={vi.fn()}
        isSuggesting={false}
      />,
    );
    const buttons = screen.getAllByTestId('schedule-slot');
    buttons.forEach((btn) => {
      expect(btn).toBeDisabled();
    });
  });

  it('buttons are enabled when readOnly is false', () => {
    const poll = buildPollData();
    render(
      <SuggestedTimes
        slots={poll.slots}
        myVotedSlotIds={[]}
        readOnly={false}
        onToggleVote={vi.fn()}
        onSuggestSlot={vi.fn()}
        isSuggesting={false}
      />,
    );
    const buttons = screen.getAllByTestId('schedule-slot');
    buttons.forEach((btn) => {
      expect(btn).toBeEnabled();
    });
  });
});

// ---------------------------------------------------------------------------
// SuggestedTimes — conflict warning display (ROK-1031)
// ---------------------------------------------------------------------------

describe('SuggestedTimes — conflict warning display', () => {
  it('shows conflict warning text for slots in conflictingSlotIds', () => {
    const poll = buildPollData();
    render(
      <SuggestedTimes
        slots={poll.slots}
        myVotedSlotIds={[]}
        readOnly={false}
        onToggleVote={vi.fn()}
        onSuggestSlot={vi.fn()}
        isSuggesting={false}
        conflictingSlotIds={[100]}
      />,
    );
    expect(screen.getByText(/conflicting event/i)).toBeInTheDocument();
  });

  it('does not show conflict warning for non-conflicting slots', () => {
    const poll = buildPollData();
    render(
      <SuggestedTimes
        slots={poll.slots}
        myVotedSlotIds={[]}
        readOnly={false}
        onToggleVote={vi.fn()}
        onSuggestSlot={vi.fn()}
        isSuggesting={false}
        conflictingSlotIds={[999]}
      />,
    );
    expect(screen.queryByText(/conflicting event/i)).not.toBeInTheDocument();
  });

  it('does not show conflict warning when conflictingSlotIds is undefined', () => {
    const poll = buildPollData();
    render(
      <SuggestedTimes
        slots={poll.slots}
        myVotedSlotIds={[]}
        readOnly={false}
        onToggleVote={vi.fn()}
        onSuggestSlot={vi.fn()}
        isSuggesting={false}
      />,
    );
    expect(screen.queryByText(/conflicting event/i)).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// VoteStep (in SchedulingWizard) — AC2: buttons disabled during mutation
// ---------------------------------------------------------------------------

describe('VoteStep — AC2: buttons disabled while vote is in-flight', () => {
  it('vote buttons become disabled while mutation is pending', async () => {
    const user = userEvent.setup();
    const poll = buildPollData();

    // MSW handler that never resolves — simulates in-flight request
    server.use(
      http.post(
        `${API_BASE}/lineups/:lineupId/schedule/:matchId/vote`,
        async () => {
          await delay('infinite');
          return HttpResponse.json({ voted: true });
        },
      ),
      // Poll data fetch for query invalidation
      http.get(
        `${API_BASE}/lineups/:lineupId/schedule/:matchId`,
        () => HttpResponse.json(poll),
      ),
    );

    renderWithProviders(
      <SchedulingWizard
        poll={poll}
        lineupId={1}
        matchId={10}
        gameTimeStale={false}
      >
        <div>Step 3 content</div>
      </SchedulingWizard>,
    );

    // Wizard should start on step 1 (VoteStep) since gameTimeStale=false and slots exist
    const step2 = screen.getByTestId('scheduling-wizard-step-2');
    expect(step2).toBeInTheDocument();

    // Find the first vote button
    const voteButtons = step2.querySelectorAll('button[type="button"]');
    // Filter to only the slot vote buttons (not the "Continue" nav button)
    const slotButtons = Array.from(voteButtons).filter(
      (btn) => !btn.textContent?.includes('Continue'),
    );
    expect(slotButtons.length).toBeGreaterThan(0);
    const firstSlotBtn = slotButtons[0] as HTMLButtonElement;

    // Click to trigger the vote mutation
    await user.click(firstSlotBtn);

    // AC2: While the mutation is in-flight, buttons should be disabled.
    // CURRENTLY FAILS: VoteStep does not wire toggle.isPending to disable.
    expect(firstSlotBtn).toBeDisabled();
  });
});
