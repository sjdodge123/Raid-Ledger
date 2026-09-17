/**
 * "Find a better time" on a PHONE is the one-day drawer module (ROK-1580).
 *
 * The seven-column heatmap is unreadable at 390px, so below 1024px the sheet
 * mounts the phone week editor in GROUP mode: one day of the poll aggregate,
 * the viewer's own week outlined on top, a pager that walks days and rolls into
 * the neighbouring week (ROK-1570 re-fetch), and a legend instead of the
 * desktop's prose.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import type { AggregateGameTimeResponse, GameTimeSlot } from '@raid-ledger/contract';
import { renderWithProviders } from '../../../../test/render-helpers';
import { PhoneGroupAvailability } from '../PhoneGroupAvailability';
import { getWeekStart } from '../scheduling-availability';
import { CHECK_HOURS } from '../../../features/game-time/phone/phone-week-check.helpers';

/** Wednesday 16 Sep 2026 — the day the approved frame was drawn on. */
const NOW = new Date(2026, 8, 16, 12, 0, 0);
const WED = 3;
const THIS_WEEK = getWeekStart(NOW);

let viewerSlots: GameTimeSlot[] = [];

vi.mock('../../../../hooks/use-game-time', () => ({
    useGameTime: () => ({ data: { slots: viewerSlots } }),
}));

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
    viewerSlots = [];
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

    it("marks the viewer's own saved week with a bar over the group's fill (ROK-1587)", () => {
        viewerSlots = [19, 20].map((hour) => ({ dayOfWeek: WED, hour, status: 'available' as const }));

        renderModule();

        expect(screen.queryByTestId('phone-group-you-block')).not.toBeInTheDocument();
        const bars = screen.getAllByTestId('phone-group-you-bar');
        expect(bars).toHaveLength(1);
        const start = CHECK_HOURS.indexOf(19);
        expect(bars[0].style.top).toBe(`${(start / CHECK_HOURS.length) * 100}%`);
        expect(bars[0].style.height).toBe(`${(2 / CHECK_HOURS.length) * 100}%`);
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
        for (const key of ['free', 'stale counts half', 'few', 'you']) {
            expect(legend).toHaveTextContent(key);
        }
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
