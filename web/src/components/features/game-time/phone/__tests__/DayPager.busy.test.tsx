/** "3h free · 1h busy" — the day header's busy clause (ROK-1595 S2, AC 8). */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { GameTimeCalendarBusy } from '@raid-ledger/contract';
import { DayPager } from '../DayPager';
import { PhoneWeekEditorCore } from '../PhoneWeekEditorCore';

const DIMS = { colWidth: 100, rowHeight: 40, headerHeight: 0, colStartLeft: 52 };
const EVENING = [17, 18, 19, 20, 21, 22, 23];
const avail = (day: number, hours: number[]) =>
    hours.map((hour) => ({ dayOfWeek: day, hour, status: 'available' as const }));

describe('DayPager — busy clause', () => {
    it('reads "3h free · 1h busy" with the busy clause in text-busy', () => {
        render(<DayPager day={2} freeHours={3} busyHours={1} onPrev={vi.fn()} onNext={vi.fn()} />);
        expect(screen.getByTestId('phone-day-free')).toHaveTextContent('3h free · 1h busy');
        expect(screen.getByTestId('phone-day-busy')).toHaveClass('text-busy');
    });

    it('omits the clause when nothing is busy', () => {
        render(<DayPager day={2} freeHours={3} busyHours={0} onPrev={vi.fn()} onNext={vi.fn()} />);
        expect(screen.getByTestId('phone-day-free')).toHaveTextContent(/^3h free$/);
        expect(screen.queryByTestId('phone-day-busy')).not.toBeInTheDocument();
    });

    it('a group subtitle replaces the whole line, busy clause included', () => {
        render(<DayPager day={2} freeHours={3} busyHours={2} subtitle="Sep 16 · 4 in poll" onPrev={vi.fn()} onNext={vi.fn()} />);
        expect(screen.getByTestId('phone-day-free')).toHaveTextContent(/^Sep 16 · 4 in poll$/);
    });
});

describe('PhoneWeekEditorCore — busy hours from calendarBusy', () => {
    const busy: GameTimeCalendarBusy[] = [{ dayOfWeek: 2, startHour: 20, endHour: 21, provider: 'google' }];

    it('counts the day on screen and draws its band', () => {
        render(<PhoneWeekEditorCore slots={avail(2, [19, 20, 21])} onChange={vi.fn()} hours={EVENING}
            initialDay={2} dims={DIMS} calendarBusy={busy} />);
        expect(screen.getByTestId('phone-day-free')).toHaveTextContent('3h free · 1h busy');
        expect(screen.getByText('Busy · Google Calendar')).toBeInTheDocument();
    });

    it('does not count a busy hour outside every slot, but still draws its band', () => {
        const early: GameTimeCalendarBusy[] = [{ dayOfWeek: 2, startHour: 17, endHour: 19, provider: 'google' }];
        render(<PhoneWeekEditorCore slots={avail(2, [19, 20, 21])} onChange={vi.fn()} hours={EVENING}
            initialDay={2} dims={DIMS} calendarBusy={early} />);
        expect(screen.getByTestId('phone-day-free')).toHaveTextContent(/^3h free$/);
        expect(screen.queryByTestId('phone-day-busy')).not.toBeInTheDocument();
        expect(screen.getByText('Busy · Google Calendar')).toBeInTheDocument();
    });

    it('counts only the busy hours that overlap a slot', () => {
        const straddle: GameTimeCalendarBusy[] = [{ dayOfWeek: 2, startHour: 17, endHour: 21, provider: 'google' }];
        render(<PhoneWeekEditorCore slots={avail(2, [19, 20, 21])} onChange={vi.fn()} hours={EVENING}
            initialDay={2} dims={DIMS} calendarBusy={straddle} />);
        expect(screen.getByTestId('phone-day-free')).toHaveTextContent(/^3h free · 2h busy$/);
    });

    it('shows no busy clause or band on a day without busy hours', () => {
        render(<PhoneWeekEditorCore slots={avail(3, [19])} onChange={vi.fn()} hours={EVENING}
            initialDay={3} dims={DIMS} calendarBusy={busy} />);
        expect(screen.queryByTestId('phone-day-busy')).not.toBeInTheDocument();
        expect(screen.queryByText('Busy · Google Calendar')).not.toBeInTheDocument();
    });
});
