/**
 * ROK-1588 — the desktop "Find a better time" week: seven day columns × hour
 * rows, counts + fill + marks per cell, week nav, hour bands, legend.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { GameTimeEventBlock } from '@raid-ledger/contract';
import { computeHeatmapBg } from '../../grid-cell.utils';
import { toGroupCellMap } from '../../phone/group-day.utils';
import { groupCellAriaLabel, type SlotMark } from '../../slot-marks.utils';
import { GroupWeekView, type GroupWeekViewProps } from '../GroupWeekView';

/** Sunday Sep 20 2026, 00:00 local. */
const WEEK = new Date(2026, 8, 20);
const WED = 3;

const CELLS = toGroupCellMap([
    { dayOfWeek: WED, hour: 20, availableCount: 5, totalCount: 6, staleCount: 0, unknownCount: 0, busyCount: 1 },
    { dayOfWeek: WED, hour: 21, availableCount: 3, totalCount: 6, staleCount: 1, unknownCount: 2, busyCount: 0 },
    { dayOfWeek: 0, hour: 17, availableCount: 0, totalCount: 6, staleCount: 0, unknownCount: 6, busyCount: 0 },
]);

const EVENT: GameTimeEventBlock = {
    eventId: 7, title: 'Raid night', gameSlug: null, gameName: null, coverUrl: null, signupId: 1,
    confirmationStatus: 'confirmed', dayOfWeek: WED, startHour: 19, endHour: 22,
};
const MARKS = new Map<string, SlotMark>([['3:20', { dayOfWeek: WED, hour: 20, votes: 2 }]]);

const renderView = (over: Partial<GroupWeekViewProps> = {}) => {
    const props: GroupWeekViewProps = {
        weekStart: WEEK,
        cells: CELLS,
        slotMarks: MARKS,
        onPick: vi.fn(),
        onWeekChange: vi.fn(),
        legend: { memberCounts: { total: 6, fresh: 4, stale: 1, unknown: 1 } },
        ...over,
    };
    return { props, ...render(<GroupWeekView {...props} />) };
};

const cell = (d: number, h: number): HTMLElement => screen.getByTestId(`group-week-cell-${d}-${h}`);
const allCells = (): NodeListOf<Element> => document.querySelectorAll('[data-testid^="group-week-cell-"]');

describe('GroupWeekView — layout', () => {
    it('renders the root testid and seven day headers with dates', () => {
        renderView();
        expect(screen.getByTestId('group-week-view')).toBeInTheDocument();
        expect(screen.getByTestId('group-week-header-0')).toHaveTextContent('SunSep 20');
        expect(screen.getByTestId('group-week-header-6')).toHaveTextContent('SatSep 26');
    });

    it('honours a custom testId', () => {
        renderView({ testId: 'reschedule-week' });
        expect(screen.getByTestId('reschedule-week')).toBeInTheDocument();
    });

    it('renders 49 cells (7 days × CHECK_HOURS) by default', () => {
        renderView({ slotMarks: undefined });
        expect(allCells()).toHaveLength(49);
        expect(screen.getByText('5 PM')).toBeInTheDocument();
    });

    it('shows the count top-right with the busy clause in text-busy', () => {
        renderView();
        expect(cell(WED, 20)).toHaveTextContent('5 free · 1 busy');
        expect(within(cell(WED, 20)).getByText(/1 busy/)).toHaveClass('text-busy');
        expect(cell(WED, 21)).toHaveTextContent('3 free · 1 stale');
        expect(cell(1, 18).textContent).toBe('');
    });

    it('fills each cell with computeHeatmapBg', () => {
        renderView();
        const probe = document.createElement('div');
        probe.style.background = computeHeatmapBg(CELLS.get('3:20')) ?? '';
        expect(cell(WED, 20).style.background).toBe(probe.style.background);
        expect(cell(0, 17).style.background).toBe('');
    });
});

describe('GroupWeekView — marks', () => {
    it('sets data-busy with a 4px busy edge', () => {
        renderView();
        expect(cell(WED, 20)).toHaveAttribute('data-busy', '1');
        expect(cell(WED, 20).className).toContain('before:bg-busy');
        expect(cell(WED, 21)).not.toHaveAttribute('data-busy');
    });

    it('draws no "your game time" mark on any cell (operator ruling 2026-09-17)', () => {
        renderView({ events: [EVENT] });
        expect(document.querySelector('[data-you]')).toBeNull();
        expect(cell(WED, 19).className).not.toContain('border-dashed');
    });

    it('overlays the viewer\'s events as titled blocks that leave the cells beneath pickable', () => {
        const { props } = renderView({ events: [EVENT] });
        const blocks = screen.getAllByTestId('group-week-event-7');
        expect(blocks).toHaveLength(1);
        expect(blocks[0]).toHaveTextContent('Raid night');
        expect(blocks[0]).toHaveAttribute('data-day', String(WED));
        expect(blocks[0]).toHaveAttribute('data-start-hour', '19');
        expect(blocks[0].className).toContain('pointer-events-none');
        expect(blocks[0].style.height).toBe(`${3 * 40 - 4}px`);
        fireEvent.click(cell(WED, 20));
        expect(props.onPick).toHaveBeenCalledWith(WED, 20);
    });

    it('draws no event blocks when the viewer has none this week', () => {
        renderView();
        expect(document.querySelector('[data-testid^="group-week-event-"]')).toBeNull();
    });

    it('outlines a slot start hour and labels it "N voted"', () => {
        renderView();
        expect(cell(WED, 20)).toHaveAttribute('data-votes', '2');
        expect(cell(WED, 20).className).toContain('outline-slot');
        expect(within(cell(WED, 20)).getByText('2 voted')).toHaveClass('text-slot');
    });

    it('rings the picked cell and swaps the corner label to "Suggested"', () => {
        renderView({ picked: { dayOfWeek: WED, hour: 20 } });
        expect(cell(WED, 20)).toHaveAttribute('data-picked', 'true');
        expect(cell(WED, 20).className).toContain('ring-emerald-500');
        expect(within(cell(WED, 20)).getByText('Suggested')).toHaveClass('text-emerald-500');
        expect(within(cell(WED, 20)).queryByText('2 voted')).toBeNull();
        expect(cell(WED, 20).getAttribute('aria-label')).toContain('2 voted');
    });

    it('marks the current cell', () => {
        renderView({ current: { dayOfWeek: 2, hour: 18 } });
        expect(cell(2, 18)).toHaveAttribute('data-current', 'true');
    });

    it('labels every cell with groupCellAriaLabel', () => {
        renderView({ picked: { dayOfWeek: WED, hour: 19 } });
        expect(cell(WED, 20)).toHaveAttribute('aria-label',
            groupCellAriaLabel(WED, 20, CELLS.get('3:20'), { votes: 2 }));
        expect(cell(WED, 19)).toHaveAttribute('aria-label',
            groupCellAriaLabel(WED, 19, undefined, { picked: true }));
    });

    it('applies only token classes in both colour families', () => {
        for (const scheme of ['default-dark', 'default-light']) {
            const { unmount } = render(
                <div data-scheme={scheme}>
                    <GroupWeekView weekStart={WEEK} cells={CELLS} slotMarks={MARKS}
                        picked={{ dayOfWeek: 1, hour: 17 }} onPick={vi.fn()} onWeekChange={vi.fn()} legend={{}} />
                </div>,
            );
            expect(cell(WED, 20).className).toMatch(/outline-slot/);
            expect(cell(WED, 19).className).not.toMatch(/border-dashed/);
            expect(cell(1, 17).className).toMatch(/ring-emerald-500/);
            expect(screen.getByTestId('group-week-grid').innerHTML).not.toMatch(/#[0-9a-f]{6}/i);
            unmount();
        }
    });
});

describe('GroupWeekView — picking', () => {
    it('click, Enter and Space call onPick(day, hour)', async () => {
        const user = userEvent.setup();
        const { props } = renderView();
        await user.click(cell(WED, 21));
        expect(props.onPick).toHaveBeenLastCalledWith(WED, 21);
        cell(2, 18).focus();
        await user.keyboard('{Enter}');
        expect(props.onPick).toHaveBeenLastCalledWith(2, 18);
        cell(4, 22).focus();
        await user.keyboard(' ');
        expect(props.onPick).toHaveBeenLastCalledWith(4, 22);
        expect(props.onPick).toHaveBeenCalledTimes(3);
    });

    it('a disabled cell does not call onPick', () => {
        const { props } = renderView({ isCellDisabled: (d, h) => d === 1 && h === 17 });
        fireEvent.click(cell(1, 17));
        expect(props.onPick).not.toHaveBeenCalled();
        expect(cell(1, 17)).toHaveAttribute('aria-disabled', 'true');
    });

    it('without onPick renders role="img" tiles and no cell buttons', () => {
        renderView({ onPick: undefined });
        expect(cell(WED, 20)).toHaveAttribute('role', 'img');
        expect(within(screen.getByTestId('group-week-grid')).queryAllByRole('button')).toHaveLength(0);
    });

    it('arrow keys move focus between cells', () => {
        renderView();
        cell(WED, 20).focus();
        fireEvent.keyDown(cell(WED, 20), { key: 'ArrowRight' });
        expect(document.activeElement).toBe(cell(4, 20));
        fireEvent.keyDown(cell(4, 20), { key: 'ArrowDown' });
        expect(document.activeElement).toBe(cell(4, 21));
        fireEvent.keyDown(cell(4, 21), { key: 'ArrowLeft' });
        expect(document.activeElement).toBe(cell(WED, 21));
        fireEvent.keyDown(cell(WED, 21), { key: 'ArrowUp' });
        expect(document.activeElement).toBe(cell(WED, 20));
        fireEvent.keyDown(cell(WED, 20), { key: 'Home' });
        expect(document.activeElement).toBe(cell(0, 20));
        fireEvent.keyDown(cell(0, 20), { key: 'ArrowLeft' });
        expect(document.activeElement).toBe(cell(0, 20));
        fireEvent.keyDown(cell(0, 20), { key: 'End' });
        expect(document.activeElement).toBe(cell(6, 20));
    });
});

describe('GroupWeekView — toolbar', () => {
    it('Previous / Next week call onWeekChange(-1 / 1) around the range label', () => {
        const { props } = renderView();
        fireEvent.click(screen.getByRole('button', { name: 'Previous week' }));
        expect(props.onWeekChange).toHaveBeenLastCalledWith(-1);
        fireEvent.click(screen.getByRole('button', { name: 'Next week' }));
        expect(props.onWeekChange).toHaveBeenLastCalledWith(1);
        expect(screen.getByText('Sep 20 – 26')).toBeInTheDocument();
    });

    it('labels a week spanning two months with both', () => {
        renderView({ weekStart: new Date(2026, 8, 27) });
        expect(screen.getByText('Sep 27 – Oct 3')).toBeInTheDocument();
    });

    it('Show earlier adds 11 rows and flips aria-expanded', () => {
        renderView({ slotMarks: undefined });
        const toggle = screen.getByTestId('group-week-show-earlier');
        expect(toggle).toHaveAttribute('aria-expanded', 'false');
        fireEvent.click(toggle);
        expect(allCells()).toHaveLength(49 + 77);
        expect(toggle).toHaveAttribute('aria-expanded', 'true');
        expect(toggle).toHaveTextContent('▴ Hide earlier');
    });

    it('a slot at 2 AM auto-opens the later band', () => {
        renderView({ slotMarks: new Map([['5:2', { dayOfWeek: 5, hour: 2, votes: 0 }]]) });
        expect(screen.getByTestId('group-week-show-later')).toHaveAttribute('aria-expanded', 'true');
        expect(within(cell(5, 2)).getByText('0 voted')).toBeInTheDocument();
    });

    it('a picked or current hour outside the window opens its band', () => {
        renderView({ slotMarks: undefined, current: { dayOfWeek: 1, hour: 9 } });
        expect(screen.getByTestId('group-week-show-earlier')).toHaveAttribute('aria-expanded', 'true');
    });
});

describe('GroupWeekView — legend', () => {
    it('shows the four keys and the member freshness clause', () => {
        renderView();
        const legend = screen.getByTestId('group-week-legend');
        for (const key of ['More people free', 'Someone busy', 'Your events', 'Already suggested']) {
            expect(legend).toHaveTextContent(key);
        }
        expect(screen.getByTestId('group-week-members'))
            .toHaveTextContent('6 members · 4 fresh · 1 out of date · 1 unknown');
    });

    it('omits zero clauses', () => {
        renderView({ legend: { memberCounts: { total: 1, fresh: 1, stale: 0, unknown: 0 } } });
        expect(screen.getByTestId('group-week-members')).toHaveTextContent(/^1 member · 1 fresh$/);
    });

    it('omits the right-hand clause without member counts', () => {
        renderView({ legend: {} });
        expect(screen.getByTestId('group-week-legend')).toBeInTheDocument();
        expect(screen.queryByTestId('group-week-members')).toBeNull();
    });
});
