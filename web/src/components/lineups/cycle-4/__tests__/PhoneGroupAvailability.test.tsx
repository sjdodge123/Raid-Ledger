/**
 * "Find a better time" on a PHONE is the one-day drawer module (ROK-1580).
 *
 * The seven-column heatmap is unreadable at 390px, so below 1024px the sheet
 * mounts the phone week editor in GROUP mode: one day of the poll aggregate,
 * the viewer's own events drawn on top, a pager that walks days and rolls into
 * the neighbouring week (ROK-1570 re-fetch), and a legend instead of the
 * desktop's prose.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import type { AggregateGameTimeResponse, GameTimeEventBlock } from '@raid-ledger/contract';
import { renderWithProviders } from '../../../../test/render-helpers';
import { PhoneGroupAvailability } from '../PhoneGroupAvailability';
import { getWeekStart } from '../scheduling-availability';
import { CHECK_HOURS } from '../../../features/game-time/phone/phone-week-check.helpers';
import { slotMarksForWeek } from '../../../features/game-time/slot-marks.utils';

/** Wednesday 16 Sep 2026 — the day the approved frame was drawn on. */
const NOW = new Date(2026, 8, 16, 12, 0, 0);
const WED = 3;
const THIS_WEEK = getWeekStart(NOW);

let viewerEvents: GameTimeEventBlock[] = [];

/** The composite read, scoped: events come back only for the week asked for. */
vi.mock('../../../../hooks/use-game-time', () => ({
    useGameTime: (opts?: { week?: string }) => ({
        data: { slots: [], events: opts?.week === getWeekStart(new Date(2026, 8, 16)).toISOString() ? viewerEvents : [] },
    }),
}));

const ev = (over: Partial<GameTimeEventBlock> = {}): GameTimeEventBlock => ({
    eventId: 7, title: 'Raid night', gameSlug: null, gameName: null, coverUrl: null, signupId: 1,
    confirmationStatus: 'confirmed', dayOfWeek: WED, startHour: 19, endHour: 22, ...over,
});

/** Four members, painted across Wednesday evening. */
function buildAggregate(over: Partial<AggregateGameTimeResponse> = {}): AggregateGameTimeResponse {
    return {
        eventId: 1,
        totalUsers: 4,
        totalMembers: 4,
        freshnessDays: 7,
        untemplatedMembers: 0,
        viewerGameTimeAgeDays: 0,
        cells: [
            { dayOfWeek: WED, hour: 19, availableCount: 4, totalCount: 4, staleCount: 0, unknownCount: 0 },
            { dayOfWeek: WED, hour: 20, availableCount: 3, totalCount: 4, staleCount: 1, unknownCount: 0 },
            { dayOfWeek: 6, hour: 21, availableCount: 2, totalCount: 4, staleCount: 0, unknownCount: 2 },
        ],
        ...over,
    } as AggregateGameTimeResponse;
}

const onPickHour = vi.fn();
const onWeekChange = vi.fn();

function renderModule(over: Partial<Parameters<typeof PhoneGroupAvailability>[0]> = {}) {
    return renderWithProviders(
        <PhoneGroupAvailability
            data={buildAggregate()}
            isLoading={false}
            weekStart={THIS_WEEK}
            onWeekChange={onWeekChange}
            readOnly={false}
            onPickHour={onPickHour}
            {...over}
        />,
    );
}

beforeEach(() => {
    vi.clearAllMocks();
    viewerEvents = [];
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
});

afterEach(() => {
    vi.useRealTimers();
});

describe('PhoneGroupAvailability — the day on screen', () => {
    it('paints the group with the shared heatmap copy, counts inside the cell', () => {
        renderModule();

        const cell = screen.getByTestId(`phone-group-cell-${WED}-20`);
        expect(cell).toHaveTextContent('3 free · 1 stale');
        expect(cell).toHaveAttribute('aria-label', '3 free · 1 stale · 0 unknown');
        expect(document.querySelectorAll('[data-testid^="phone-group-cell-"]')).toHaveLength(7);
    });

    it('opens on TODAY when the displayed week is the current one', () => {
        renderModule();

        expect(screen.getByTestId('phone-day-title')).toHaveTextContent('Wednesday');
        expect(screen.getByTestId('phone-day-free')).toHaveTextContent('Sep 16 · 4 in poll');
    });

    it('opens on Sunday for any other week, and dates the subtitle from it', () => {
        const other = new Date(THIS_WEEK);
        other.setDate(other.getDate() - 7);

        renderModule({ weekStart: other });

        expect(screen.getByTestId('phone-day-title')).toHaveTextContent('Sunday');
        expect(screen.getByTestId('phone-day-free')).toHaveTextContent('Sep 6 · 4 in poll');
    });

    it('falls back to the plain user count when the poll size is absent', () => {
        renderModule({ data: buildAggregate({ totalMembers: undefined, totalUsers: 2 }) });

        expect(screen.getByTestId('phone-day-free')).toHaveTextContent('Sep 16 · 2 in poll');
    });

    // ROK-1588 Q5: Reschedule mounts this module for an event's signups.
    it('names the group with the caller\'s noun', () => {
        renderModule({ sizeNoun: 'signed up' });

        expect(screen.getByTestId('phone-day-free')).toHaveTextContent('Sep 16 · 4 signed up');
        expect(screen.getByTestId('phone-day-free')).not.toHaveTextContent('in poll');
    });
});

describe('PhoneGroupAvailability — picking an hour', () => {
    it('reports the DISPLAYED day with the tapped hour', () => {
        renderModule();

        fireEvent.click(screen.getByTestId(`phone-group-cell-${WED}-19`));

        expect(onPickHour).toHaveBeenCalledWith(WED, 19);
    });

    it('draws the suggestion the caller hands back', () => {
        renderModule({ suggested: { dayOfWeek: WED, hour: 19 } });

        expect(screen.getByTestId('phone-group-suggested-block')).toBeInTheDocument();
    });

    it('does not suggest anything while the poll is read-only', () => {
        renderModule({ readOnly: true });

        const cell = screen.getByTestId(`phone-group-cell-${WED}-19`);
        fireEvent.click(cell);

        expect(onPickHour).not.toHaveBeenCalled();
        // Not an inert button — a labelled tile (review 2a).
        expect(cell).toHaveAttribute('role', 'img');
        expect(cell.tagName).not.toBe('BUTTON');
    });

    it("draws no you bar, and the viewer's own events for the displayed week (operator ruling 2026-09-17)", () => {
        viewerEvents = [ev()];
        renderModule();
        expect(screen.queryByTestId('phone-group-you-bar')).not.toBeInTheDocument();
        const block = screen.getByTestId('phone-group-event-7');
        expect(block).toHaveTextContent('Raid night');
        const start = CHECK_HOURS.indexOf(19);
        expect(block.style.top).toBe(`${(start / CHECK_HOURS.length) * 100}%`);
        expect(block.style.height).toBe(`${(3 / CHECK_HOURS.length) * 100}%`);
    });

    it("does not draw this week's events on another week", () => {
        // Sunday of next week is the day that week opens on.
        viewerEvents = [ev({ dayOfWeek: 0 })];
        renderModule({ weekStart: new Date(2026, 8, 20) });
        expect(screen.getByTestId('phone-group-cell-0-19')).toBeInTheDocument();
        expect(screen.queryByTestId('phone-group-event-7')).not.toBeInTheDocument();
    });

    it('leaves out the event being rescheduled', () => {
        viewerEvents = [ev(), ev({ eventId: 8, startHour: 22, endHour: 23 })];
        renderModule({ excludeEventId: 7 });
        expect(screen.queryByTestId('phone-group-event-7')).not.toBeInTheDocument();
        expect(screen.getByTestId('phone-group-event-8')).toBeInTheDocument();
    });
});

describe('PhoneGroupAvailability — already-suggested slots (ROK-1587)', () => {
    /** A slot at `hour` on day `day` of the displayed week, with `votes` voters. */
    const slotAt = (day: number, hour: number, votes: number) => {
        const at = new Date(THIS_WEEK);
        at.setDate(at.getDate() + day);
        at.setHours(hour, 0, 0, 0);
        return { proposedTime: at.toISOString(), votes: Array.from({ length: votes }, () => ({})) };
    };

    it('draws the slot marks it is handed on the day it opens on', () => {
        const slotMarks = slotMarksForWeek([slotAt(WED, 20, 2), slotAt(6, 21, 1)], THIS_WEEK);

        renderModule({ slotMarks });

        expect(screen.getByTestId('phone-group-slot-block-20')).toHaveTextContent('2 voted');
        expect(screen.queryByTestId('phone-group-slot-block-21')).toBeNull();
        const strip = (d: number) => screen.getByTestId(`phone-week-strip-day-${d}`)
            .querySelector('[data-testid="phone-week-strip-votes"]');
        expect(strip(WED)).toHaveTextContent('● 1');
        expect(strip(6)).toHaveTextContent('● 1');
    });

    it('still shows the marks on a read-only poll', () => {
        const slotMarks = slotMarksForWeek([slotAt(WED, 19, 0)], THIS_WEEK);

        renderModule({ slotMarks, readOnly: true });

        expect(screen.getByTestId('phone-group-slot-block-19')).toHaveTextContent('0 voted');
        expect(screen.getByTestId(`phone-group-cell-${WED}-19`)).toHaveAttribute('role', 'img');
    });

    it('draws no slot blocks without marks', () => {
        renderModule();

        expect(screen.queryByTestId('phone-group-slot-chip')).toBeNull();
    });
});

describe('PhoneGroupAvailability — paging weeks (ROK-1570)', () => {
    it('rolls past Saturday into the next week, landing on Sunday', () => {
        renderModule();
        const next = screen.getByRole('button', { name: 'Next day' });

        // Wednesday → Thursday → Friday → Saturday, then off the end.
        for (let i = 0; i < 3; i += 1) fireEvent.click(next);
        expect(screen.getByTestId('phone-day-title')).toHaveTextContent('Saturday');
        expect(onWeekChange).not.toHaveBeenCalled();

        fireEvent.click(next);

        expect(onWeekChange).toHaveBeenCalledWith(1);
        expect(screen.getByTestId('phone-day-title')).toHaveTextContent('Sunday');
    });

    it('rolls before Sunday into the previous week, landing on Saturday', () => {
        renderModule();
        const prev = screen.getByRole('button', { name: 'Previous day' });

        for (let i = 0; i < 3; i += 1) fireEvent.click(prev);
        expect(screen.getByTestId('phone-day-title')).toHaveTextContent('Sunday');

        fireEvent.click(prev);

        expect(onWeekChange).toHaveBeenCalledWith(-1);
        expect(screen.getByTestId('phone-day-title')).toHaveTextContent('Saturday');
    });
});

describe('PhoneGroupAvailability — the rest of the module', () => {
    it('explains the fills in a legend instead of the desktop prose', () => {
        renderModule();

        const legend = screen.getByTestId('phone-group-legend');
        for (const key of ['free', 'stale counts half', 'few', 'Your events', 'Already suggested']) {
            expect(legend).toHaveTextContent(key);
        }
    });

    it('keys "Your events" with the event swatch and "Already suggested" with the dashed slot swatch', () => {
        renderModule();

        expect(screen.queryByTestId('phone-group-legend-you')).not.toBeInTheDocument();
        const events = screen.getByTestId('phone-group-legend-events');
        expect(events).toHaveTextContent('Your events');
        const eventSwatch = events.querySelector('[aria-hidden="true"]');
        expect(eventSwatch?.getAttribute('style')).toMatch(/border-left/);

        const slot = screen.getByTestId('phone-group-legend-slot');
        expect(slot).toHaveTextContent('Already suggested');
        const slotSwatch = slot.querySelector('[aria-hidden="true"]');
        expect(slotSwatch?.className).toContain('border-dashed');
        expect(slotSwatch?.className).toContain('border-slot');
        expect(slotSwatch?.className).toContain('bg-slot/10');
    });

    it('nudges a viewer whose own game time no longer counts', () => {
        renderModule({ data: buildAggregate({ viewerGameTimeStale: true }) });

        expect(screen.getByTestId('heatmap-stale-hint')).toBeInTheDocument();
    });

    it('keeps quiet while the viewer is fresh', () => {
        renderModule();

        expect(screen.queryByTestId('heatmap-stale-hint')).toBeNull();
    });

    it('shows the skeleton while loading and nothing at all without cells', () => {
        const { unmount } = renderModule({ data: undefined, isLoading: true });
        expect(screen.queryByTestId('phone-week-editor')).toBeNull();
        unmount();

        renderModule({ data: undefined, isLoading: false });
        expect(screen.queryByTestId('phone-week-editor')).toBeNull();
        expect(screen.queryByTestId('phone-group-legend')).toBeNull();
    });
});
