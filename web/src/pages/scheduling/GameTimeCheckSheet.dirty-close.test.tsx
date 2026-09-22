/**
 * ROK-1640 — the game-time drawer hid Save below the fold, and × silently threw
 * away the times just entered.
 *
 * (a) Save sits in a `shrink-0` footer OUTSIDE the scroll body, so it is pinned
 *     to the drawer's bottom edge whatever the body holds (a `sticky` footer
 *     inside a scrolling body only stuck within that body).
 * (b) Closing with unsaved edits — ×, backdrop, swipe-down, Escape — asks
 *     "Discard your changes?": Keep editing keeps the draft, Discard closes and
 *     the next open starts clean.
 * (c) Closing with no edits closes at once, as before.
 *
 * Both bodies are covered: `check` (the poll's "Your game time") and `profile`
 * (the profile route and the More drawer's Game Time row mount the same sheet).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/render-helpers';
import { GameTimeCheckSheet } from './GameTimeCheckSheet';
import { PhoneWeekCheckStep } from '../../components/features/game-time/phone/PhoneWeekCheckStep';
import { PROFILE_HOURS } from '../../components/features/game-time/phone/phone-week-check.helpers';
import type { GridDims } from '../../components/features/game-time/game-time-grid.types';

const ROW = 26;
const DIMS: GridDims = { colWidth: 300, rowHeight: ROW, headerHeight: 0, colStartLeft: 52 };

vi.mock('../../hooks/use-game-time', () => ({
  useGameTime: () => ({ data: { slots: [], gameTimeStale: true } }),
  useConfirmGameTime: () => ({ mutate: vi.fn(), isPending: false }),
  useSaveGameTime: () => ({ mutate: vi.fn(), isPending: false }),
  useCreateAbsence: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteAbsence: () => ({ mutateAsync: vi.fn(), mutate: vi.fn(), isPending: false }),
  useGameTimeAbsences: () => ({ data: [] }),
}));

const onClose = vi.fn();
const CONFIRM = 'Discard your changes?';

function renderSheet(variant: 'check' | 'profile' = 'check') {
  const body = variant === 'check'
    ? <PhoneWeekCheckStep ageDays={9} hasSlots={false} onSkip={vi.fn()} dims={DIMS} />
    : <PhoneWeekCheckStep variant="profile" hours={PROFILE_HOURS} dims={DIMS} />;
  return renderWithProviders(<GameTimeCheckSheet isOpen onClose={onClose} body={body} />);
}

/** Paint one hour on today's day (the clock is pinned to a Sunday). */
function paintAnHour(): void {
  const target = screen.getByTestId('slot-day-target-0');
  fireEvent.pointerDown(target, { pointerId: 1, clientX: 10, clientY: 2 * ROW + 5 });
  fireEvent.pointerUp(screen.getByTestId('block-editor-layer'), { pointerId: 1, clientX: 10, clientY: 2 * ROW + 5 });
  expect(screen.getByTestId('phone-week-save')).toBeEnabled();
}

const sheetDialog = (): HTMLElement => screen.getByRole('dialog', { name: 'Game time check' });
/** Let the guard's one-macrotask Escape settle pass. */
const settle = (): Promise<void> => act(() => new Promise((r) => { setTimeout(r, 0); }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-13T12:00:00'));
});
afterEach(() => vi.useRealTimers());

describe('ROK-1640 (a) — Save is pinned outside the scroll body', () => {
  it.each(['check', 'profile'] as const)('%s: the footer is a shrink-0 flex footer, not sticky, after the scroll body', (variant) => {
    renderSheet(variant);
    const save = screen.getByTestId('phone-week-save');
    const footer = save.parentElement!;
    expect(footer.className).not.toMatch(/\bsticky\b/);
    expect(footer.className).toContain('shrink-0');
    expect(footer.className).toContain('safe-area-inset-bottom');
    const scrollBody = footer.previousElementSibling as HTMLElement;
    expect(scrollBody.className).toContain('overflow-y-auto');
    expect(scrollBody).not.toContainElement(save);
    expect(scrollBody).toContainElement(screen.getByTestId('slot-day-target-0'));
  });
});

describe('ROK-1640 (c) — closing clean closes at once', () => {
  it('× with no edits calls onClose immediately and shows no confirm', async () => {
    renderSheet();
    await userEvent.click(screen.getByRole('button', { name: 'Close sheet' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(CONFIRM)).not.toBeInTheDocument();
  });
});

describe('ROK-1640 (b) — closing with edits asks first', () => {
  it.each(['check', 'profile'] as const)('%s: × shows the confirm; Keep editing keeps the draft; Discard closes and resets', async (variant) => {
    const { unmount } = renderSheet(variant);
    paintAnHour();
    await userEvent.click(screen.getByRole('button', { name: 'Close sheet' }));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByText(CONFIRM)).toBeInTheDocument();

    await userEvent.click(screen.getByTestId('discard-changes-keep'));
    expect(screen.queryByText(CONFIRM)).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId('phone-week-save')).toBeEnabled();

    await settle();
    await userEvent.click(screen.getByRole('button', { name: 'Close sheet' }));
    await userEvent.click(screen.getByTestId('discard-changes-discard'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('game-time-check-sheet')).not.toBeInTheDocument();

    unmount();
    renderSheet(variant);
    expect(screen.getByTestId('phone-week-save')).toBeDisabled();
  });

  it('the backdrop asks instead of closing', async () => {
    renderSheet();
    paintAnHour();
    fireEvent.click(sheetDialog().previousElementSibling!);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByText(CONFIRM)).toBeInTheDocument();
  });

  it('a swipe down asks instead of closing', () => {
    renderSheet();
    paintAnHour();
    const handle = sheetDialog().firstElementChild!;
    fireEvent.touchStart(handle, { touches: [{ clientY: 100 }] });
    fireEvent.touchMove(handle, { touches: [{ clientY: 400 }] });
    fireEvent.touchEnd(handle);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByText(CONFIRM)).toBeInTheDocument();
  });

  it('Escape asks; a second Escape dismisses the confirm without re-opening it or closing', async () => {
    renderSheet();
    paintAnHour();
    await userEvent.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByText(CONFIRM)).toBeInTheDocument();

    await userEvent.keyboard('{Escape}');
    await settle();
    expect(screen.queryByText(CONFIRM)).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId('game-time-check-sheet')).toBeInTheDocument();
  });
});
