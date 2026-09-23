/**
 * ROK-1640 (Codex P2) — the dirty-close guard covers the "I'm away" view too.
 *
 * A range or note typed into the away form and not yet added is unsaved input:
 * closing asks "Discard your changes?". Adding it (the form resets) or going
 * back to the week clears it. Dirty from the week and from the away form OR
 * together — the away view mounting clean must not mask an unsaved week.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/render-helpers';
import { GameTimeCheckSheet } from './GameTimeCheckSheet';
import { PhoneWeekCheckStep } from '../../components/features/game-time/phone/PhoneWeekCheckStep';
import type { GridDims } from '../../components/features/game-time/game-time-grid.types';

const ROW = 26;
const DIMS: GridDims = { colWidth: 300, rowHeight: ROW, headerHeight: 0, colStartLeft: 52 };

const m = vi.hoisted(() => ({ mutateAsync: vi.fn() }));
vi.mock('../../hooks/use-game-time', () => ({
  useGameTime: () => ({ data: { slots: [], gameTimeStale: true } }),
  useConfirmGameTime: () => ({ mutate: vi.fn(), isPending: false }),
  useSaveGameTime: () => ({ mutate: vi.fn(), isPending: false }),
  useCreateAbsence: () => ({ mutateAsync: m.mutateAsync, isPending: false }),
  useDeleteAbsence: () => ({ mutate: vi.fn(), isPending: false }),
  useGameTimeAbsences: () => ({ data: [] }),
}));
vi.mock('../../lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const onClose = vi.fn();
const CONFIRM = 'Discard your changes?';

function renderSheet() {
  const body = <PhoneWeekCheckStep ageDays={9} hasSlots={false} onSkip={vi.fn()} dims={DIMS} />;
  return renderWithProviders(<GameTimeCheckSheet isOpen onClose={onClose} body={body} />);
}

const openAway = (): Promise<void> => userEvent.click(screen.getByTestId('away-entry'));
const closeSheet = (): Promise<void> => userEvent.click(screen.getByRole('button', { name: 'Close sheet' }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-13T12:00:00'));
  m.mutateAsync.mockResolvedValue({ id: 9, startDate: '2026-09-14', endDate: '2026-09-20', reason: null });
});
afterEach(() => vi.useRealTimers());

describe('ROK-1640 — unsaved away input guards the close', () => {
  it('a picked range not yet added: × asks instead of closing', async () => {
    renderSheet();
    await openAway();
    fireEvent.click(screen.getByTestId('absence-pick-next-week'));
    await closeSheet();
    expect(onClose, 'close must not drop an un-added away range').not.toHaveBeenCalled();
    expect(screen.queryByText(CONFIRM)).toBeInTheDocument();
  });

  it('after "Add absence" the form is clean, so × closes at once', async () => {
    renderSheet();
    await openAway();
    fireEvent.click(screen.getByTestId('absence-pick-next-week'));
    await act(async () => { fireEvent.click(screen.getByTestId('absence-submit')); });
    expect(m.mutateAsync).toHaveBeenCalledTimes(1);
    await closeSheet();
    expect(screen.queryByText(CONFIRM)).not.toBeInTheDocument();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('back to the week drops the away draft, so × closes at once', async () => {
    renderSheet();
    await openAway();
    fireEvent.click(screen.getByTestId('absence-pick-next-week'));
    await userEvent.click(screen.getByTestId('away-back'));
    await closeSheet();
    expect(screen.queryByText(CONFIRM)).not.toBeInTheDocument();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('an unsaved week stays dirty while the away view is open with a clean form', async () => {
    renderSheet();
    const target = screen.getByTestId('slot-day-target-0');
    fireEvent.pointerDown(target, { pointerId: 1, clientX: 10, clientY: 2 * ROW + 5 });
    fireEvent.pointerUp(screen.getByTestId('block-editor-layer'), { pointerId: 1, clientX: 10, clientY: 2 * ROW + 5 });
    expect(screen.getByTestId('phone-week-save')).toBeEnabled();
    await openAway();
    await closeSheet();
    expect(onClose, 'the away view must not mask the week draft').not.toHaveBeenCalled();
    expect(screen.queryByText(CONFIRM)).toBeInTheDocument();
  });
});
