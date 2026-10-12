/**
 * ROK-1595 S2 — the week strip's away tile knows its source: a synced
 * (calendar) day is the quiet tile with a calendar glyph, a manual day keeps
 * the ROK-1585 tile. A plain set (no sources) still reads as manual.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { WeekStrip } from '../WeekStrip';
import type { AwaySource } from '../../away/away-row.types';

const HOURS = [17, 18, 19, 20, 21, 22, 23];
const renderStrip = (awayDays: ReadonlySet<number> | ReadonlyMap<number, AwaySource>, day = 2) =>
    render(<WeekStrip slots={[]} hours={HOURS} day={day} onPick={vi.fn()} awayDays={awayDays} />);
const column = (d: number): HTMLElement => screen.getByTestId(`phone-week-strip-day-${d}`);
const glyph = (d: number) => column(d).querySelector('[data-testid="phone-week-strip-away-calendar"]');

describe('WeekStrip — away tile by source (ROK-1595 S2)', () => {
    it('draws a synced day as the calendar tile and a manual day as the plain one', () => {
        renderStrip(new Map<number, AwaySource>([[4, 'calendar'], [6, 'manual']]));
        expect(column(4)).toHaveAttribute('data-away-source', 'calendar');
        expect(column(6)).toHaveAttribute('data-away-source', 'manual');
        expect(glyph(4)).not.toBeNull();
        expect(glyph(6)).toBeNull();
        expect(column(4).className).toContain('border-dashed');
        expect(column(4).className).toContain('bg-transparent');
        expect(column(4).className).not.toContain('bg-overlay/40');
        expect(column(6).className).toContain('bg-overlay/40');
        expect(column(4)).toHaveTextContent(/away/i);
        expect(column(1)).not.toHaveAttribute('data-away-source');
    });

    it('names the synced day "away from calendar" for screen readers', () => {
        renderStrip(new Map<number, AwaySource>([[4, 'calendar'], [6, 'manual']]));
        expect(screen.getByLabelText('Thursday, no hours free, away from calendar')).toBeInTheDocument();
        expect(screen.getByLabelText('Saturday, no hours free, away')).toBeInTheDocument();
    });

    it('reads a plain set of away days as manual', () => {
        renderStrip(new Set([4]));
        expect(column(4)).toHaveAttribute('data-away-source', 'manual');
        expect(glyph(4)).toBeNull();
    });

    it('keeps the selected colours on a selected synced day', () => {
        renderStrip(new Map<number, AwaySource>([[2, 'calendar']]));
        expect(column(2).className).toContain('border-success');
        expect(column(2).className).toContain('border-dashed');
        expect(glyph(2)).not.toBeNull();
    });

    it('lays the calendar tile out like its neighbours (colour and border style only)', () => {
        renderStrip(new Map<number, AwaySource>([[4, 'calendar']]));
        const layout = (d: number): string[] => column(d).className.split(/\s+/)
            .filter((c) => c && !c.startsWith('border-') && !c.startsWith('bg-')).sort();
        expect(layout(4)).toEqual(layout(3));
    });
});
