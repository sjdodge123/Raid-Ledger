/**
 * The phone drawer's away view (ROK-1585 drawer A): the stacked `AwayPanel`
 * scrolls, and the pinned footer carries ONLY the add button — no "Save my
 * week", no Skip. Adding keeps the viewer on the away view.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, fireEvent, within } from '@testing-library/react';
import { PhoneAwayView } from '../PhoneAwayView';

const m = vi.hoisted(() => ({
    mutateAsync: vi.fn(),
    absences: [] as Array<{ id: number; startDate: string; endDate: string; reason: string | null }>,
}));
vi.mock('../../../../../hooks/use-game-time', () => ({
    useCreateAbsence: () => ({ mutateAsync: m.mutateAsync, mutate: vi.fn(), isPending: false }),
    useDeleteAbsence: () => ({ mutate: vi.fn(), isPending: false }),
    useGameTimeAbsences: () => ({ data: m.absences }),
}));
vi.mock('../../../../../lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 7, 27, 12, 0, 0)); // a Thursday
    vi.clearAllMocks();
    m.absences = [];
    m.mutateAsync.mockResolvedValue({ id: 9, startDate: '2026-08-31', endDate: '2026-09-06', reason: null });
});
afterEach(() => { vi.useRealTimers(); });

describe('PhoneAwayView', () => {
    it('renders the stacked panel in a scrolling body', () => {
        render(<PhoneAwayView />);
        const panel = screen.getByTestId('away-panel');
        expect(panel).toHaveAttribute('data-layout', 'stacked');
        expect(panel.parentElement!.className).toContain('overflow-y-auto');
        expect(panel.parentElement!.className).toContain('min-h-0');
    });

    it('pins ONLY the add button in a shrink-0 footer outside the scroll body (ROK-1640)', () => {
        render(<PhoneAwayView />);
        const footer = screen.getByTestId('phone-away-footer');
        expect(footer.className).not.toMatch(/\bsticky\b/);
        expect(footer.className).toContain('shrink-0');
        expect(footer.previousElementSibling!.className).toContain('overflow-y-auto');
        expect(within(footer).getAllByRole('button')).toHaveLength(1);
        expect(within(footer).getByTestId('absence-submit')).toBeInTheDocument();
        expect(screen.getAllByTestId('absence-submit')).toHaveLength(1);
        expect(screen.queryByTestId('phone-week-save')).not.toBeInTheDocument();
        expect(screen.queryByTestId('phone-week-skip')).not.toBeInTheDocument();
    });

    it('keeps the add button disabled until a range is picked', () => {
        render(<PhoneAwayView />);
        expect(screen.getByTestId('absence-submit')).toBeDisabled();
        fireEvent.click(screen.getByTestId('absence-pick-next-week'));
        expect(screen.getByTestId('absence-submit')).toBeEnabled();
        expect(screen.getByTestId('absence-submit')).toHaveTextContent('Add absence · 7 days');
    });

    it('stays on the away view after adding, with the form reset', async () => {
        render(<PhoneAwayView />);
        fireEvent.click(screen.getByTestId('absence-pick-next-week'));
        await act(async () => { fireEvent.click(screen.getByTestId('absence-submit')); });
        expect(m.mutateAsync).toHaveBeenCalledTimes(1);
        expect(screen.getByTestId('away-panel')).toBeInTheDocument();
        expect(screen.getByTestId('absence-submit')).toBeDisabled();
    });
});
