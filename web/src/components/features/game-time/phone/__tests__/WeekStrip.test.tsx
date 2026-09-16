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

    // ROK-1579 (operator ruling 2026-09-16): three bars per day, not one per
    // hour — day 9 AM–5 PM, evening 5–9 PM, late 9 PM–1 AM, each filled by the
    // share of that band the viewer has claimed.
    it('draws exactly three band bars per day', () => {
        renderStrip();
        expect(document.querySelectorAll('[data-testid="phone-week-strip-bar"]')).toHaveLength(21);
        for (let d = 0; d < 7; d++) {
            const bars = screen.getByTestId(`phone-week-strip-day-${d}`)
                .querySelectorAll('[data-testid="phone-week-strip-bar"]');
            expect(bars).toHaveLength(3);
            expect([...bars].map((b) => b.getAttribute('data-band')))
                .toEqual(['day', 'evening', 'late']);
        }
    });

    it('fills each band by the share of it the viewer has claimed', () => {
        // The fixture claims Tuesday 7–11 PM (19, 20, 21, 22): nothing in the
        // daytime band, half the evening band, half the late band.
        renderStrip();
        const kinds = (d: number): (string | null)[] =>
            [...screen.getByTestId(`phone-week-strip-day-${d}`)
                .querySelectorAll('[data-testid="phone-week-strip-bar"]')]
                .map((b) => b.getAttribute('data-kind'));
        expect(kinds(2)).toEqual(['none', 'partial', 'partial']);
        expect(kinds(3)).toEqual(['none', 'none', 'none']);
    });

    it('marks a wholly claimed band as full', () => {
        renderStrip({ slots: avail(4, [17, 18, 19, 20]) });
        const bars = [...screen.getByTestId('phone-week-strip-day-4')
            .querySelectorAll('[data-testid="phone-week-strip-bar"]')]
            .map((b) => b.getAttribute('data-kind'));
        expect(bars).toEqual(['none', 'full', 'none']);
    });

    // ROK-1579 (operator ruling 2026-09-16: "I don't like the cross-hatch
    // visual"): the bars are flat fills — no hatched stale bar, on any week.
    // The staleness the copy names is the prompt's job.
    it('never hatches a bar — the unclaimed bands are plain edges', () => {
        renderStrip();
        const bars = [...document.querySelectorAll<HTMLElement>('[data-testid="phone-week-strip-bar"]')];
        expect(bars.length).toBe(21);
        expect(bars.filter((b) => b.getAttribute('data-kind') === 'stale')).toHaveLength(0);
        expect(bars.every((b) => !b.style.backgroundImage)).toBe(true);
    });

    // The strip summarises the WHOLE day: it must not shrink to the hours the
    // editor happens to show, or the profile's fitted window would hide the
    // daytime a shift worker just saved.
    it('summarises the whole day whatever hours the editor shows', () => {
        renderStrip({ hours: [17, 18, 19], slots: avail(4, [9, 10, 11, 12, 13, 14, 15, 16]) });
        const bars = [...screen.getByTestId('phone-week-strip-day-4')
            .querySelectorAll('[data-testid="phone-week-strip-bar"]')]
            .map((b) => b.getAttribute('data-kind'));
        expect(bars).toEqual(['full', 'none', 'none']);
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
