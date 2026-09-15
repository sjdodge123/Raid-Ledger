/**
 * Tests for GameTimeCheckSheet (ROK-1574) — the PHONE game-time check.
 *
 * Wireframe B (`dev/scheduling-wireframes/SheetStepOne.tsx`): a full-height
 * bottom sheet whose header is a two-segment stepper — "1 Game time" and
 * "2 Vote" — with the check on step 1 and the REAL vote ladder on step 2.
 * The sheet lives inside `SchedulingComposite` precisely so step 2 can be the
 * same ballot the page renders, bound by the same `useSchedulingLadder`.
 *
 * Advancing is DERIVED from the gate clearing: "Looks right", a saved absence
 * and Skip all end the check server-side (or session-side), which flips
 * `isOpen` false — and a check that ends on step 1 advances to step 2 rather
 * than vanishing. Only an explicit close (backdrop/Escape) dismisses it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { JSX } from 'react';
import { renderWithProviders } from '../../test/render-helpers';
import { buildPoll } from '../../components/lineups/cycle-4/__tests__/scheduling-poll-fixtures';
import type { SchedulingSlotListProps } from '../../components/lineups/cycle-4/SchedulingSlotList';
import { GameTimeCheckSheet } from './GameTimeCheckSheet';
import { GameTimeCheckBody } from './GameTimeCheckBody';

const mockConfirmMutate = vi.fn();
vi.mock('../../hooks/use-game-time', () => ({
  GAME_TIME_QUERY_KEY: ['me', 'game-time'],
  GAME_TIME_ABSENCES_KEY: ['me', 'game-time', 'absences-all'],
  useGameTime: vi.fn(() => ({ data: undefined, isLoading: false })),
  useConfirmGameTime: () => ({ mutate: mockConfirmMutate, isPending: false }),
  useCreateAbsence: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useDeleteAbsence: vi.fn(() => ({ mutateAsync: vi.fn(), mutate: vi.fn(), isPending: false })),
  useGameTimeAbsences: vi.fn(() => ({ data: [] })),
}));

vi.mock('../../components/features/game-time/game-time-absence', () => ({
  AbsenceSection: () => <div data-testid="absence-section">AbsenceSection</div>,
}));

const onToggleVote = vi.fn();
const onLock = vi.fn();
const onClose = vi.fn();
const onSkip = vi.fn();

/** The ladder props the composite hands the sheet, off the shared fixture. */
function buildLadder(): SchedulingSlotListProps {
  const poll = buildPoll();
  return {
    slots: poll.slots,
    myVotedSlotIds: [],
    slotConflicts: [],
    readOnly: false,
    canVote: true,
    signedIn: true,
    enrolByVoting: false,
    canLock: false,
    onToggleVote,
    onLock,
  };
}

/** Render the sheet open on step 1 for the stale viewer. */
function renderSheet(isOpen = true): ReturnType<typeof renderWithProviders> {
  return renderWithProviders(
    <GameTimeCheckSheet
      isOpen={isOpen}
      onClose={onClose}
      ladder={buildLadder()}
      stepOne={<GameTimeCheckBody ageDays={9} hasSlots surface="sheet" onSkip={onSkip} />}
    />,
  );
}

/** Re-render with the gate cleared (the answer landed server-side). */
function gateCleared(rerender: (ui: JSX.Element) => void): void {
  rerender(
    <GameTimeCheckSheet
      isOpen={false}
      onClose={onClose}
      ladder={buildLadder()}
      stepOne={<GameTimeCheckBody ageDays={9} hasSlots surface="sheet" onSkip={onSkip} />}
    />,
  );
}

describe('GameTimeCheckSheet — the stepper', () => {
  beforeEach(() => vi.clearAllMocks());

  it('opens on step 1 with both segments tappable and step 1 current', () => {
    renderSheet();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByTestId('game-time-check-stepper')).toBeInTheDocument();
    const one = screen.getByTestId('game-time-check-step-1');
    const two = screen.getByTestId('game-time-check-step-2');
    expect(one).toHaveAttribute('aria-current', 'step');
    expect(two).not.toHaveAttribute('aria-current');
    expect(one).toHaveTextContent('Game time');
    expect(screen.getByTestId('game-time-check-stepline')).toHaveTextContent(
      'Step 1 of 2 · game time · then vote',
    );
    expect(two).toHaveTextContent('Vote');
    expect(screen.getByTestId('game-time-check-body')).toBeInTheDocument();
  });

  it('does NOT render a duplicate "Anything changed?" sheet title', () => {
    renderSheet();
    expect(screen.getAllByText(/Anything changed\?/)).toHaveLength(1);
  });

  it('renders nothing at all when the gate is closed (AC6: a fresh viewer)', () => {
    renderSheet(false);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByTestId('game-time-check-stepper')).not.toBeInTheDocument();
  });

  it('jumps to step 2 when the second segment is tapped, and back to step 1', async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.click(screen.getByTestId('game-time-check-step-2'));
    expect(screen.getByTestId('game-time-check-step-2')).toHaveAttribute('aria-current', 'step');
    expect(screen.getByTestId('game-time-check-step2')).toBeInTheDocument();
    expect(screen.getByTestId('game-time-check-stepline')).toHaveTextContent('Step 2 of 2 · vote');

    await user.click(screen.getByTestId('game-time-check-step-1'));
    expect(screen.getByTestId('game-time-check-step-1')).toHaveAttribute('aria-current', 'step');
    expect(screen.getByTestId('game-time-check-body')).toBeInTheDocument();
  });
});

describe('GameTimeCheckSheet — every step-1 answer advances to step 2', () => {
  beforeEach(() => vi.clearAllMocks());

  it('advances when "Looks right" clears the gate instead of closing the sheet', async () => {
    const user = userEvent.setup();
    const { rerender } = renderSheet();
    await user.click(screen.getByTestId('game-time-check-confirm'));
    expect(mockConfirmMutate).toHaveBeenCalledTimes(1);

    gateCleared(rerender);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByTestId('game-time-check-step-2')).toHaveAttribute('aria-current', 'step');
    expect(screen.getByTestId('game-time-check-step2')).toBeInTheDocument();
  });

  it('advances on Skip — the viewer still gets the ballot', async () => {
    const user = userEvent.setup();
    const { rerender } = renderSheet();
    await user.click(screen.getByTestId('game-time-check-skip'));
    expect(onSkip).toHaveBeenCalledTimes(1);

    gateCleared(rerender);
    expect(screen.getByTestId('game-time-check-step-2')).toHaveAttribute('aria-current', 'step');
  });

  it('stays closed when the sheet was explicitly dismissed', async () => {
    const user = userEvent.setup();
    const { rerender } = renderSheet();
    await user.click(screen.getByLabelText('Close sheet'));
    expect(onClose).toHaveBeenCalledTimes(1);
    gateCleared(rerender);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('GameTimeCheckSheet — step 2 is the REAL ladder', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the suggested-time rows and votes through the composite handler', async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.click(screen.getByTestId('game-time-check-step-2'));

    const rows = screen.getAllByTestId('schedule-slot');
    expect(rows.length).toBe(2);
    await user.click(screen.getAllByRole('button', { name: /^Vote for /i })[0]);
    expect(onToggleVote).toHaveBeenCalledTimes(1);
    expect(onToggleVote).toHaveBeenCalledWith(expect.any(Number));
  });

  it('never renders the week painter inside the sheet', () => {
    renderSheet();
    expect(screen.queryByTestId('game-time-grid')).not.toBeInTheDocument();
  });
});
