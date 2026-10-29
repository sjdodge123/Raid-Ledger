/**
 * ROK-1173 AC6 — the Members list is windowed: with 2000 rows only the rows in
 * view plus overscan are mounted, scrolling moves the window, and band
 * headings ride along in grouped mode. jsdom has no layout, so the viewport
 * is the stubbed `window.innerHeight` the list sizes its box from.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { GuildMemberRow } from '@raid-ledger/contract';
import type { HubMemberColumn } from '../../plugins/hub-module';
import { bandMembers } from './hub-members.helpers';
import { HubMemberVirtualList, OVERSCAN } from './hub-member-virtual-list';
import { CARD_METRICS, TABLE_METRICS, virtualSlice } from './hub-member-virtual.helpers';

function row(i: number): GuildMemberRow {
    return { memberId: i, name: `Member ${i}`, class: 'Warrior', level: 60, rankIndex: i % 2, rankName: i % 2 === 0 ? 'Officer' : 'Raider', effectiveRole: null, characterId: null, isMain: false };
}

const ROWS = Array.from({ length: 2000 }, (_, i) => row(i));
const COLUMNS: HubMemberColumn[] = [{ id: 'name', header: 'Name', cell: ({ row: r }) => <span>{r.name}</span> }];
const byRank: NonNullable<HubMemberColumn['groupBy']> = (r) => ({ key: String(r.rankIndex), label: r.rankName ?? '' });

const originalHeight = window.innerHeight;
/** 1000px window → a 700px list box. */
beforeEach(() => { Object.defineProperty(window, 'innerHeight', { configurable: true, value: 1000 }); });
afterEach(() => { Object.defineProperty(window, 'innerHeight', { configurable: true, value: originalHeight }); });

function mounted(): string[] {
    return screen.getAllByTestId('guild-member-row').map((el) => el.textContent ?? '');
}

describe('HubMemberVirtualList (ROK-1173 AC6)', () => {
    it('mounts only a window of a 2000-row flat list on the desktop table', () => {
        render(<HubMemberVirtualList bands={bandMembers(ROWS, undefined)} columns={COLUMNS} rowClass={undefined} desktop />);
        const count = mounted().length;
        expect(count, `2000 rows must not all mount; got ${count}`).toBeLessThan(100);
        expect(count).toBe(Math.ceil(700 / TABLE_METRICS.row) + OVERSCAN);
        expect(mounted()[0]).toBe('Member 0');
    });

    it('moves the window when the box scrolls, keeping the DOM small', () => {
        render(<HubMemberVirtualList bands={bandMembers(ROWS, undefined)} columns={COLUMNS} rowClass={undefined} desktop={false} />);
        const scroller = screen.getByTestId('guild-members-scroller');
        fireEvent.scroll(scroller, { target: { scrollTop: 1000 * CARD_METRICS.row } });
        const names = mounted();
        expect(names, 'row 1000 must be mounted after scrolling to it').toContain('Member 1000');
        expect(names).not.toContain('Member 0');
        expect(names.length).toBeLessThan(100);
    });

    it('is a keyboard-reachable region, not a focus trap', () => {
        render(<HubMemberVirtualList bands={bandMembers(ROWS, undefined)} columns={COLUMNS} rowClass={undefined} desktop />);
        const scroller = screen.getByRole('region', { name: 'Members list' });
        expect(scroller).toHaveAttribute('tabindex', '0');
        expect(screen.getAllByTestId('guild-member-row')[0]).not.toHaveAttribute('tabindex');
    });
});

describe('virtualSlice', () => {
    it('keeps the band heading with the first mounted rows and accounts every pixel in the spacers', () => {
        const bands = bandMembers(ROWS.slice(0, 40), byRank);
        const m = { row: 10, heading: 20 };
        const slice = virtualSlice(bands, m, 0, 50, 2);
        expect(slice.top).toBe(0);
        expect(slice.bands[0]?.showHeading).toBe(true);
        const mountedPx = slice.bands.reduce((px, b) => px + (b.showHeading ? 20 : 0) + b.rows.length * 10, 0);
        expect(slice.top + mountedPx + slice.bottom, 'spacers + mounted items must equal the full height').toBe(2 * 20 + 40 * 10);
    });

    it('clamps a scroll position past the end of a list that just shrank', () => {
        const bands = bandMembers(ROWS.slice(0, 5), undefined);
        const slice = virtualSlice(bands, { row: 10, heading: 20 }, 99_999, 30, 1);
        expect(slice.mountedRows, 'a shrunken list must still mount its rows').toBeGreaterThan(0);
        expect(slice.bottom).toBe(0);
    });
});
