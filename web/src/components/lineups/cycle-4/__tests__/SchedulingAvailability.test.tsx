/**
 * ROK-1580 — the "Find a better time" body branches on the viewport.
 *
 * Below 1024px it is the phone module (one day, group mode); from 1024px up it is
 * the unchanged seven-column heatmap. Both are fed by the same `weekStart`
 * state and the same cell-click → suggest-form prefill, so this file pins the
 * branch AND the fact that a phone tap still prefills the form.
 */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import type { AggregateGameTimeResponse } from '@raid-ledger/contract';
import { renderWithProviders } from '../../../../test/render-helpers';
import { stubGridLayout } from '../../../../test/stub-grid-layout';
import { SchedulingAvailability } from '../SchedulingAvailability';
import { getWeekStart } from '../scheduling-availability';

const getMatchAvailabilityMock = vi.fn();

vi.mock('../../../../lib/api-client', () => ({
    getSchedulePoll: vi.fn(),
    toggleScheduleVote: vi.fn(),
    suggestSlot: vi.fn(),
    createEventFromSlot: vi.fn(),
    retractAllVotes: vi.fn(),
    getMatchAvailability: (...args: unknown[]) => getMatchAvailabilityMock(...args),
    getSchedulingBanner: vi.fn(),
    getOtherPolls: vi.fn(),
    cancelSchedulePoll: vi.fn(),
    remindVoters: vi.fn(),
    addPollMembers: vi.fn(),
}));

vi.mock('../../../../hooks/use-game-time', () => ({
    useGameTime: () => ({ data: { slots: [] } }),
}));

/** Wednesday 16 Sep 2026, 8 PM — one cell the whole poll is free in. */
const NOW = new Date(2026, 8, 16, 12, 0, 0);
const WED = 3;

function buildAggregate(): AggregateGameTimeResponse {
    return {
        eventId: 1,
        totalUsers: 2,
        totalMembers: 2,
        freshnessDays: 7,
        untemplatedMembers: 0,
        viewerGameTimeAgeDays: 0,
        cells: [
            { dayOfWeek: WED, hour: 20, availableCount: 2, totalCount: 2, staleCount: 0, unknownCount: 0 },
        ],
    } as AggregateGameTimeResponse;
}

/** Force `useMediaQuery('(min-width: 1024px)')` to a known answer. */
function stubViewport(desktop: boolean): void {
    vi.stubGlobal('matchMedia', (query: string) => ({
        matches: desktop && query.includes('1024'),
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
    }));
}

const onPrefill = vi.fn();

function renderSection() {
    return renderWithProviders(
        <SchedulingAvailability
            lineupId={3}
            matchId={9}
            slots={[]}
            readOnly={false}
            onPrefill={onPrefill}
        />,
    );
}

describe('SchedulingAvailability viewport branch (ROK-1580)', () => {
    beforeAll(() => { stubGridLayout(); });

    beforeEach(() => {
        vi.clearAllMocks();
        getMatchAvailabilityMock.mockResolvedValue(buildAggregate());
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(NOW);
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('mounts the phone module below 1024px, not the seven-column grid', async () => {
        stubViewport(false);
        renderSection();

        expect(await screen.findByTestId('phone-week-editor')).toBeInTheDocument();
        expect(screen.queryByTestId('heatmap-grid')).toBeNull();
    });

    it('keeps the seven-column heatmap from 1024px up', async () => {
        stubViewport(true);
        renderSection();

        expect(await screen.findByTestId('heatmap-grid')).toBeInTheDocument();
        expect(screen.queryByTestId('phone-week-editor')).toBeNull();
    });

    it('prefills the suggest form from a phone tap, in the displayed week', async () => {
        stubViewport(false);
        renderSection();

        fireEvent.click(await screen.findByTestId(`phone-group-cell-${WED}-20`));

        expect(onPrefill).toHaveBeenCalledWith('2026-09-16T20:00');
    });

    it('re-queries the neighbouring week when the pager rolls past Saturday', async () => {
        stubViewport(false);
        renderSection();
        const next = await screen.findByRole('button', { name: 'Next day' });

        for (let i = 0; i < 4; i += 1) fireEvent.click(next);

        const nextWeek = getWeekStart(NOW);
        nextWeek.setDate(nextWeek.getDate() + 7);
        await waitFor(() =>
            expect(getMatchAvailabilityMock).toHaveBeenCalledWith(3, 9, nextWeek),
        );
    });
});
