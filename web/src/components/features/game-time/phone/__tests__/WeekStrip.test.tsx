/** Week-at-a-glance strip for the phone week editor (ROK-1569). */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { GameTimeSlot } from '@raid-ledger/contract';
import { WeekStrip } from '../WeekStrip';

const HOURS = [17, 18, 19, 20, 21, 22, 23];
const avail = (day: number, hours: number[]): GameTimeSlot[] =>
    hours.map((h) => ({ dayOfWeek: day, hour: h, status: 'available' as const }));

const renderStrip = (over: Partial<Parameters<typeof WeekStrip>[0]> = {}) =>
    render(
        <WeekStrip
            slots={avail(2, [19, 20, 21, 22])}
            hours={HOURS}
            day={2}
            onPick={vi.fn()}
            {...over}
        />,
    );

describe('WeekStrip', () => {
    it('offers all seven days as buttons that say how free they are', () => {
        renderStrip();
        expect(screen.getAllByRole('button')).toHaveLength(7);
        expect(screen.getByLabelText('Tuesday, 4 hours free')).toBeInTheDocument();
        expect(screen.getByLabelText('Monday, no hours free')).toBeInTheDocument();
    });

    it('marks the day being edited as current', () => {
        renderStrip();
        expect(screen.getByTestId('phone-week-strip-day-2')).toHaveAttribute('aria-current', 'date');
        expect(screen.getByTestId('phone-week-strip-day-3')).not.toHaveAttribute('aria-current');
    });

    it('jumps to the tapped day', () => {
        const onPick = vi.fn();
        renderStrip({ onPick });
        fireEvent.click(screen.getByTestId('phone-week-strip-day-5'));
        expect(onPick).toHaveBeenCalledWith(5);
    });

    it('draws one bar per visible hour, free where the viewer is free', () => {
        renderStrip();
        const col = screen.getByTestId('phone-week-strip-day-2');
        const bars = col.querySelectorAll('[data-bar]');
        expect(bars).toHaveLength(HOURS.length);
        expect([...bars].filter((b) => b.getAttribute('data-bar') === 'free')).toHaveLength(4);
    });

    it('hatches the unclaimed hours only when the week is stale', () => {
        renderStrip({ stale: false });
        expect(document.querySelectorAll('[data-bar="stale"]')).toHaveLength(0);
        renderStrip({ stale: true });
        expect(document.querySelectorAll('[data-bar="stale"]').length).toBeGreaterThan(0);
    });
});
