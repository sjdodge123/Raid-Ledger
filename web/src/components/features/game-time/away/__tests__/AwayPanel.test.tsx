import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { AwayPanel } from '../AwayPanel';
import { AwayUpcomingList } from '../AwayUpcomingList';
import type { AwayRowItem } from '../away-row.types';

/**
 * AwayPanel coverage (ROK-1585). The first three describes PORT every case of
 * the legacy `game-time-absence.test.tsx` (ROK-1426) onto the new form; the
 * clock is frozen to the same Thursday because the presets are relative.
 */
const m = vi.hoisted(() => ({
    mutateAsync: vi.fn(), createMutate: vi.fn(), delMutate: vi.fn(), isPending: false,
    absences: [] as Array<{ id: number; startDate: string; endDate: string; reason: string | null }>,
}));
vi.mock('../../../../../hooks/use-game-time', () => ({
    useCreateAbsence: () => ({ mutateAsync: m.mutateAsync, mutate: m.createMutate, isPending: m.isPending }),
    useDeleteAbsence: () => ({ mutate: m.delMutate, isPending: false }),
    useGameTimeAbsences: () => ({ data: m.absences }),
}));
vi.mock('../../../../../lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const THURSDAY = new Date(2026, 7, 27, 12, 0, 0); // 2026-08-27
const from = () => screen.getByLabelText('From') as HTMLInputElement;
const to = () => screen.getByLabelText('To') as HTMLInputElement;
const submit = () => screen.getByTestId('absence-submit');
const span = () => screen.getByTestId('absence-span');
const pickBtn = (id: string) => screen.getByTestId(`absence-pick-${id}`);

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(THURSDAY);
    vi.clearAllMocks();
    m.isPending = false;
    m.absences = [];
    m.mutateAsync.mockResolvedValue({ id: 1, startDate: '', endDate: '', reason: null });
});
afterEach(() => { vi.useRealTimers(); });

describe('AwayPanel (stacked) — presets', () => {
    it('This weekend fills the coming Saturday to Sunday', () => {
        render(<AwayPanel layout="stacked" />);
        fireEvent.click(pickBtn('weekend'));
        expect(from().value).toBe('2026-08-29');
        expect(to().value).toBe('2026-08-30');
        expect(span()).toHaveTextContent('2 days');
    });

    it('Next week fills the following Monday to Sunday', () => {
        render(<AwayPanel layout="stacked" />);
        fireEvent.click(pickBtn('next-week'));
        expect(from().value).toBe('2026-08-31');
        expect(to().value).toBe('2026-09-06');
        expect(span()).toHaveTextContent('7 days');
        expect(submit()).toHaveTextContent('Add absence · 7 days');
    });

    it('marks the matching preset as pressed, and only that one', () => {
        render(<AwayPanel layout="stacked" />);
        fireEvent.click(pickBtn('weekend'));
        expect(pickBtn('weekend')).toHaveAttribute('aria-pressed', 'true');
        expect(pickBtn('next-week')).toHaveAttribute('aria-pressed', 'false');
        expect(pickBtn('custom')).toHaveAttribute('aria-pressed', 'false');
    });

    it('flips to Custom once a date is edited by hand', () => {
        render(<AwayPanel layout="stacked" />);
        fireEvent.click(pickBtn('weekend'));
        fireEvent.change(to(), { target: { value: '2026-09-02' } });
        expect(pickBtn('custom')).toHaveAttribute('aria-pressed', 'true');
        expect(pickBtn('weekend')).toHaveAttribute('aria-pressed', 'false');
    });

    it('Custom clears both dates', () => {
        render(<AwayPanel layout="stacked" />);
        fireEvent.click(pickBtn('next-week'));
        fireEvent.click(pickBtn('custom'));
        expect(from().value).toBe('');
        expect(to().value).toBe('');
        expect(span()).toHaveTextContent('');
    });

    it('starts with no preset selected', () => {
        render(<AwayPanel layout="stacked" />);
        for (const id of ['weekend', 'next-week', 'custom']) {
            expect(pickBtn(id)).toHaveAttribute('aria-pressed', 'false');
        }
    });
});

describe('AwayPanel (stacked) — validation', () => {
    it('cannot submit an empty form', () => {
        render(<AwayPanel layout="stacked" />);
        expect(submit()).toBeDisabled();
        expect(submit()).toHaveTextContent(/^Add absence$/);
        expect(span()).toHaveTextContent('');
    });

    it('cannot submit with only a start date', () => {
        render(<AwayPanel layout="stacked" />);
        fireEvent.change(from(), { target: { value: '2026-08-29' } });
        expect(submit()).toBeDisabled();
    });

    it('enables submit for a valid range, reports the inclusive day count and creates it', () => {
        render(<AwayPanel layout="stacked" />);
        fireEvent.change(from(), { target: { value: '2026-08-29' } });
        fireEvent.change(to(), { target: { value: '2026-08-31' } });
        expect(span()).toHaveTextContent('3 days');
        expect(submit()).toBeEnabled();
        fireEvent.click(submit());
        expect(m.mutateAsync).toHaveBeenCalledTimes(1);
    });

    it('says "1 day" for a single-day absence', () => {
        render(<AwayPanel layout="stacked" />);
        fireEvent.change(from(), { target: { value: '2026-08-29' } });
        fireEvent.change(to(), { target: { value: '2026-08-29' } });
        expect(span()).toHaveTextContent('1 day');
        expect(submit()).toBeEnabled();
    });

    it('refuses an inverted range', () => {
        render(<AwayPanel layout="stacked" />);
        fireEvent.change(from(), { target: { value: '2026-08-31' } });
        fireEvent.change(to(), { target: { value: '2026-08-29' } });
        expect(span()).toHaveTextContent('');
        expect(submit()).toBeDisabled();
    });

    it('constrains the To picker to the chosen start, matching the API rule', () => {
        render(<AwayPanel layout="stacked" />);
        expect(to().min).toBe('');
        fireEvent.change(from(), { target: { value: '2026-08-29' } });
        expect(to().min).toBe('2026-08-29');
    });

    it('blocks submit while a save is in flight', () => {
        m.isPending = true;
        render(<AwayPanel layout="stacked" />);
        fireEvent.click(pickBtn('weekend'));
        expect(submit()).toBeDisabled();
        expect(submit()).toHaveTextContent('Adding…');
    });
});

describe('AwayPanel (stacked) — note', () => {
    it('is hidden behind "+ Add a note", optional, and capped at the API limit', () => {
        render(<AwayPanel layout="stacked" />);
        expect(screen.queryByTestId('away-note')).toBeNull();
        fireEvent.click(screen.getByTestId('away-note-toggle'));
        const note = screen.getByTestId('away-note') as HTMLInputElement;
        expect(note.maxLength).toBe(255);
        fireEvent.click(pickBtn('weekend'));
        expect(submit()).toBeEnabled();
        fireEvent.change(note, { target: { value: 'Vacation' } });
        expect(note.value).toBe('Vacation');
    });

    it('the toggle reports aria-expanded (the smoke reads it) and reveals a textbox named "Note"', () => {
        render(<AwayPanel layout="stacked" />);
        const toggle = screen.getByTestId('away-note-toggle');
        expect(toggle).toHaveAttribute('aria-expanded', 'false');
        fireEvent.click(toggle);
        expect(toggle).toHaveAttribute('aria-expanded', 'true');
        expect(screen.queryByRole('textbox', { name: 'Note' })).toBe(screen.getByTestId('away-note'));
    });
});

describe('AwayPanel (stacked) — list', () => {
    it('shows the empty copy when nothing is booked', () => {
        render(<AwayPanel layout="stacked" />);
        expect(screen.getByTestId('away-panel')).toHaveAttribute('data-layout', 'stacked');
        expect(screen.getByTestId('away-empty')).toHaveTextContent(
            'No time away booked. Pick the days below and polls stop counting you as free on them.');
    });

    it('renders upcoming rows with meta, and Remove deletes that absence', () => {
        m.absences = [{ id: 7, startDate: '2026-09-19', endDate: '2026-09-20', reason: 'Lake trip' }];
        render(<AwayPanel layout="stacked" />);
        const row = screen.getByTestId('away-row');
        expect(row).toHaveAttribute('data-source', 'manual');
        expect(row).toHaveTextContent('Sat Sep 19 – Sun Sep 20');
        expect(row).toHaveTextContent('2 days · Lake trip');
        fireEvent.click(screen.getByRole('button', { name: 'Remove Sat Sep 19 – Sun Sep 20' }));
        expect(m.delMutate).toHaveBeenCalledWith(7, expect.anything());
        expect(screen.queryByTestId('away-empty')).toBeNull();
    });

    it('hideSubmit leaves the submit to the caller', () => {
        render(<AwayPanel layout="stacked" hideSubmit />);
        expect(screen.queryByTestId('absence-submit')).toBeNull();
    });
});

describe('AwayPanel (inline, D1)', () => {
    it('has a heading with the upcoming count and ONE add line with the submit last', () => {
        m.absences = [
            { id: 1, startDate: '2026-09-19', endDate: '2026-09-20', reason: null },
            { id: 2, startDate: '2026-10-01', endDate: '2026-10-04', reason: null },
        ];
        render(<AwayPanel layout="inline" />);
        expect(screen.getByTestId('away-panel')).toHaveAttribute('data-layout', 'inline');
        expect(screen.getByRole('heading', { name: /I'm away/ })).toHaveTextContent('2 upcoming');
        const line = screen.getByTestId('away-add-line');
        expect(within(line).getByTestId('absence-pick-weekend')).toBeInTheDocument();
        expect(line.lastElementChild).toBe(screen.getByTestId('absence-submit'));
        expect(within(line).getByTestId('away-note-toggle')).toBeInTheDocument();
    });

    it('reveals the note on its own row under the add line', () => {
        render(<AwayPanel layout="inline" />);
        fireEvent.click(screen.getByTestId('away-note-toggle'));
        const note = screen.getByTestId('away-note');
        expect(screen.getByTestId('away-add-line')).not.toContainElement(note);
    });
});

describe('AwayUpcomingList — calendar seam', () => {
    const cal: AwayRowItem = { key: 'cal-1', id: null, startDate: '2026-09-25', endDate: '2026-09-25', reason: 'Dentist', source: 'calendar' };

    it('groups calendar rows under "From your calendars" with Ignore', () => {
        const onIgnore = vi.fn();
        render(<AwayUpcomingList rows={[cal]} heading="Upcoming" onRemove={vi.fn()} onIgnore={onIgnore} isDeleting={false} />);
        const row = screen.getByTestId('away-row');
        expect(row).toHaveAttribute('data-source', 'calendar');
        expect(screen.getByText('From your calendars')).toBeInTheDocument();
        expect(within(row).queryByText('Remove')).toBeNull();
        fireEvent.click(within(row).getByRole('button', { name: 'Ignore Fri Sep 25' }));
        expect(onIgnore).toHaveBeenCalledWith(cal);
    });

    it('offers no button on a calendar row without onIgnore, and no calendar heading without calendar rows', () => {
        const { rerender } = render(<AwayUpcomingList rows={[cal]} onRemove={vi.fn()} isDeleting={false} />);
        expect(within(screen.getByTestId('away-row')).queryByRole('button')).toBeNull();
        rerender(<AwayUpcomingList rows={[]} onRemove={vi.fn()} isDeleting={false} />);
        expect(screen.queryByText('From your calendars')).toBeNull();
    });
});
