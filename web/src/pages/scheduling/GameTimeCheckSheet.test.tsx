/**
 * Tests for GameTimeCheckSheet (ROK-1574 → ROK-1579) — the PHONE game-time check.
 *
 * ROK-1579 (operator ruling 2026-09-16: "I don't like the tabbed view for game
 * time and vote inside the drawer. Just remove that tabbed view; when I click
 * Save or Skip, collapse the drawer.") makes the sheet ONE view: a title row,
 * the week editor, and nothing else. There is no stepper, no second step and no
 * ballot inside the sheet — the page's own ladder IS the ballot, and the sheet
 * collapses onto it the moment the check is answered.
 *
 * Collapsing stays DERIVED: "Same as last week", a saved week, a saved absence
 * and Skip all end the check (server-side stamp or session skip), which flips
 * `isOpen` false — and the sheet then goes away instead of advancing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { JSX } from 'react';
import { renderWithProviders } from '../../test/render-helpers';
import { GameTimeCheckSheet } from './GameTimeCheckSheet';
import { useStepOneDone } from './game-time-check-step';
import { useSheetHeader } from './sheet-header-context';
import { PhoneWeekCheckStep } from '../../components/features/game-time/phone/PhoneWeekCheckStep';

const mockConfirmMutate = vi.fn();
vi.mock('../../hooks/use-game-time', () => ({
  GAME_TIME_QUERY_KEY: ['me', 'game-time'],
  GAME_TIME_ABSENCES_KEY: ['me', 'game-time', 'absences-all'],
  useGameTime: vi.fn(() => ({ data: undefined, isLoading: false })),
  useConfirmGameTime: () => ({ mutate: mockConfirmMutate, isPending: false }),
  useSaveGameTime: () => ({ mutate: vi.fn(), isPending: false }),
  useCreateAbsence: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useDeleteAbsence: vi.fn(() => ({ mutateAsync: vi.fn(), mutate: vi.fn(), isPending: false })),
  useGameTimeAbsences: vi.fn(() => ({ data: [] })),
}));

const onClose = vi.fn();
const onSkip = vi.fn();

/** Render the sheet open for the stale viewer. */
function renderSheet(isOpen = true): ReturnType<typeof renderWithProviders> {
  return renderWithProviders(
    <GameTimeCheckSheet
      isOpen={isOpen}
      onClose={onClose}
      body={<PhoneWeekCheckStep ageDays={9} hasSlots onSkip={onSkip} />}
    />,
  );
}

/** Re-render with the gate cleared (the answer landed server-side). */
function gateCleared(rerender: (ui: JSX.Element) => void): void {
  rerender(
    <GameTimeCheckSheet
      isOpen={false}
      onClose={onClose}
      body={<PhoneWeekCheckStep ageDays={9} hasSlots onSkip={onSkip} />}
    />,
  );
}

describe('GameTimeCheckSheet — ONE view (ROK-1579)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the week editor under a plain title, with no stepper and no "Step N of 2"', () => {
    renderSheet();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByTestId('game-time-check-sheet')).toBeInTheDocument();
    expect(screen.getByTestId('phone-week-check')).toBeInTheDocument();

    expect(screen.queryByTestId('game-time-check-stepper')).not.toBeInTheDocument();
    expect(screen.queryByTestId('game-time-check-stepline')).not.toBeInTheDocument();
    expect(screen.queryByTestId('game-time-check-step-1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('game-time-check-step-2')).not.toBeInTheDocument();
    expect(screen.queryByTestId('game-time-check-step2')).not.toBeInTheDocument();
    expect(screen.queryByText(/Step \d of 2/)).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: /steps/i })).not.toBeInTheDocument();
  });

  it('gives the body a DEFINITE height so the week editor fills it instead of scrolling', () => {
    renderSheet();
    const box = screen.getByTestId('game-time-check-content');
    expect(box.className).toMatch(/h-\[calc\(var\(--sheet-vh,1dvh\)_\*_95_-_\d+px\)\]/);
    expect(box.className).toContain('min-h-0');
    expect(box).toContainElement(screen.getByTestId('phone-week-check'));
  });

  it('does NOT render a duplicate "Anything changed?" sheet title', () => {
    renderSheet();
    expect(screen.getAllByText(/Anything changed\?/)).toHaveLength(1);
  });

  it('renders nothing at all when the gate is closed (AC6: a fresh viewer)', () => {
    renderSheet(false);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByTestId('game-time-check-sheet')).not.toBeInTheDocument();
  });

  it('carries no ballot — the page ladder is the vote, not a second step', () => {
    renderSheet();
    expect(screen.queryAllByTestId('schedule-slot')).toHaveLength(0);
    expect(screen.queryAllByRole('button', { name: /^Vote for /i })).toHaveLength(0);
  });

  it('never renders the week painter inside the sheet', () => {
    renderSheet();
    expect(screen.queryByTestId('game-time-grid')).not.toBeInTheDocument();
  });
});

describe('GameTimeCheckSheet — every answer collapses the drawer (ROK-1579)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('collapses when "Same as last week" clears the gate, instead of advancing to a vote step', async () => {
    const user = userEvent.setup();
    const { rerender } = renderSheet();
    await user.click(screen.getByTestId('phone-week-same'));
    expect(mockConfirmMutate).toHaveBeenCalledTimes(1);

    gateCleared(rerender);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByTestId('game-time-check-sheet')).not.toBeInTheDocument();
  });

  it('collapses on Skip — the session skip is unchanged and the sheet goes away', async () => {
    const user = userEvent.setup();
    const { rerender } = renderSheet();
    await user.click(screen.getByTestId('phone-week-skip'));
    expect(onSkip).toHaveBeenCalledTimes(1);

    gateCleared(rerender);
    expect(screen.queryByTestId('game-time-check-sheet')).not.toBeInTheDocument();
  });

  it('collapses on the close button, which is still the session skip', async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.click(screen.getByLabelText('Close sheet'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('game-time-check-sheet')).not.toBeInTheDocument();
  });

  it('collapses when the body reports done — the same path as the close button', async () => {
    const user = userEvent.setup();
    const Done = (): JSX.Element => {
      const done = useStepOneDone();
      return <button type="button" onClick={done}>Saved</button>;
    };
    renderWithProviders(
      <GameTimeCheckSheet isOpen onClose={onClose} body={<Done />} />,
    );
    await user.click(screen.getByRole('button', { name: 'Saved' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('game-time-check-sheet')).not.toBeInTheDocument();
  });

  it('routes an ANSWER through onDone, not onClose — a save is not a session skip (review MINOR 4)', async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    const Done = (): JSX.Element => {
      const done = useStepOneDone();
      return <button type="button" onClick={done}>Saved</button>;
    };
    renderWithProviders(
      <GameTimeCheckSheet isOpen onClose={onClose} onDone={onDone} body={<Done />} />,
    );
    await user.click(screen.getByRole('button', { name: 'Saved' }));
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByTestId('game-time-check-sheet')).not.toBeInTheDocument();
  });

  it('tells the composite when it leaves the screen', async () => {
    const user = userEvent.setup();
    const onVisibleChange = vi.fn();
    renderWithProviders(
      <GameTimeCheckSheet
        isOpen
        onClose={onClose}
        onVisibleChange={onVisibleChange}
        body={<PhoneWeekCheckStep ageDays={9} hasSlots onSkip={onSkip} />}
      />,
    );
    expect(onVisibleChange).toHaveBeenLastCalledWith(true);
    await user.click(screen.getByLabelText('Close sheet'));
    expect(onVisibleChange).toHaveBeenLastCalledWith(false);
  });
});

describe('GameTimeCheckSheet — a body can swap the header (ROK-1585 drawer A)', () => {
  beforeEach(() => vi.clearAllMocks());

  const onBack = vi.fn();
  /** A body that takes over the title row, then gives it back. */
  const Swapper = (): JSX.Element => {
    const setHeader = useSheetHeader();
    return (
      <>
        <button type="button" onClick={() => setHeader({ title: "I'm away", onBack, backLabel: 'Back to my week', backTestId: 'away-back' })}>Swap</button>
        <button type="button" onClick={() => setHeader(null)}>Restore</button>
      </>
    );
  };

  it('shows the override title with a 44px back button, and restores the default on null', async () => {
    const user = userEvent.setup();
    renderWithProviders(<GameTimeCheckSheet isOpen onClose={onClose} body={<Swapper />} />);
    const header = screen.getByTestId('game-time-check-header');
    expect(header).toHaveTextContent('Your game time');
    expect(screen.queryByTestId('away-back')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Swap' }));
    expect(header).toHaveTextContent("I'm away");
    const back = screen.getByRole('button', { name: 'Back to my week' });
    expect(back).toHaveAttribute('data-testid', 'away-back');
    expect(back.className).toContain('min-h-[44px]');
    // Leading: the back button comes before the title.
    expect(back.compareDocumentPosition(screen.getByRole('heading', { name: "I'm away" })))
      .toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    await user.click(back);
    expect(onBack).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Restore' }));
    expect(header).toHaveTextContent('Your game time');
    expect(screen.queryByTestId('away-back')).not.toBeInTheDocument();
    // The close stays in every header state.
    expect(screen.getByLabelText('Close sheet')).toBeInTheDocument();
  });

  it('is a no-op outside the sheet', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Swapper />);
    await user.click(screen.getByRole('button', { name: 'Swap' }));
    expect(screen.queryByTestId('away-back')).not.toBeInTheDocument();
  });

});

describe('GameTimeCheckSheet — the week editor\'s away swap (ROK-1585 drawer A)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('swaps to "I\'m away" from the week editor\'s entry row and back again', async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.click(screen.getByTestId('away-entry'));
    expect(screen.getByTestId('game-time-check-header')).toHaveTextContent("I'm away");
    expect(screen.getByTestId('away-panel')).toBeInTheDocument();

    await user.click(screen.getByTestId('away-back'));
    expect(screen.getByTestId('game-time-check-header')).toHaveTextContent('Your game time');
    expect(screen.queryByTestId('away-panel')).not.toBeInTheDocument();
  });

  it('moves focus to the back button on open, and back to the "I\'m away" row on back', async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.click(screen.getByTestId('away-entry'));
    expect(screen.getByTestId('away-back')).toHaveFocus();

    await user.click(screen.getByTestId('away-back'));
    expect(screen.getByTestId('away-entry')).toHaveFocus();
  });

  it('clears the override when the body unmounts, so the next open starts on the week', async () => {
    const user = userEvent.setup();
    const { rerender } = renderSheet();
    await user.click(screen.getByTestId('away-entry'));
    gateCleared(rerender);
    rerender(<GameTimeCheckSheet isOpen onClose={onClose} body={<PhoneWeekCheckStep ageDays={9} hasSlots onSkip={onSkip} />} />);
    expect(screen.getByTestId('game-time-check-header')).toHaveTextContent('Your game time');
    expect(screen.queryByTestId('away-back')).not.toBeInTheDocument();
    expect(screen.getByTestId('away-entry')).toBeVisible();
  });
});
