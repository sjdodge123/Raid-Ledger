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

    // ROK-1579 (operator ruling 2026-09-16: "I don't like the cross-hatch
    // visual"): the strip has two states, free and not — no hatched stale bar,
    // on any week. The staleness the copy names is the prompt's job.
    it('never hatches a bar — the unclaimed hours are plain edges', () => {
        renderStrip();
        const bars = [...document.querySelectorAll('[data-bar]')];
        expect(bars.length).toBe(7 * HOURS.length);
        expect(bars.filter((b) => b.getAttribute('data-bar') === 'stale')).toHaveLength(0);
        expect(bars.every((b) => !(b as HTMLElement).style.backgroundImage)).toBe(true);
    });
});

// ROK-1579: while the strip was being squeezed by the flex column, the
// `aria-current` column rendered full height and the other six were clipped.
// Nothing in the markup may make the selected column a different SIZE — the
// only difference between columns is colour.
describe('WeekStrip — every column is the same size', () => {
    it('differs between the selected day and the rest by colour alone', () => {
        renderStrip();
        const layout = (d: number): string[] =>
            screen.getByTestId(`phone-week-strip-day-${d}`).className
                .split(/\s+/)
                .filter((c) => c && !c.startsWith('border-') && !c.startsWith('bg-'))
                .sort();
        const first = layout(0);
        expect(first).toContain('p-1');
        for (let d = 1; d < 7; d++) expect(layout(d)).toEqual(first);
    });

    it('never sizes a column with a height or self-alignment class', () => {
        renderStrip();
        for (let d = 0; d < 7; d++) {
            const classes = screen.getByTestId(`phone-week-strip-day-${d}`).className.split(/\s+/);
            expect(classes.filter((c) => /^(h-|min-h-|max-h-|self-)/.test(c))).toEqual([]);
        }
    });
});
