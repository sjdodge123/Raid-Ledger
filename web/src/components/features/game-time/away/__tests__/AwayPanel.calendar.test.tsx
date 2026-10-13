/**
 * ROK-1595 S1 — synced calendar away days in the real `AwayPanel`, end to end
 * through the hooks and MSW (no hook mocks): a `source:'calendar'` absence is
 * Ignored, never Removed (D4 regression), Ignore posts and hides the row, a
 * refused Ignore puts it back, and the "From your calendars · Synced N min ago"
 * divider reads off the overview.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { CalendarsOverview, GameTimeAbsence } from '@raid-ledger/contract';
import { server } from '../../../../../test/mocks/server';
import { renderWithProviders } from '../../../../../test/render-helpers';
import {
    ABSENCE_IGNORE_URL, GAME_TIME_ABSENCES_URL, calendarAbsenceFixture, manualAbsenceFixture,
} from '../../../../../test/mocks/game-time-calendar-handlers';
import {
    CALENDARS_OVERVIEW_URL, calendarErrorResponse, calendarsOverviewFixture, readConnectionFixture,
} from '../../../../../test/mocks/calendar-sync-handlers';
import { AwayPanel } from '../AwayPanel';

const t = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('../../../../../lib/toast', () => ({ toast: { success: t.success, error: t.error } }));
vi.mock('../../../../../hooks/use-auth', async (orig) => ({
    ...(await orig<Record<string, unknown>>()), getAuthToken: () => 'test-token',
}));

const NOW = new Date(2026, 9, 12, 12, 0, 0); // Mon Oct 12 2026, local
const MANUAL = 'Tue Oct 20 – Wed Oct 21';
const SYNCED = 'Sat Oct 24 – Tue Oct 27';

function overview(enabled = true): CalendarsOverview {
    const lastSyncedAt = new Date(NOW.getTime() - 4 * 60_000).toISOString();
    return calendarsOverviewFixture({ enabled, connections: [{ ...readConnectionFixture, lastSyncedAt }] });
}

/** Absences list that forgets ignored ids; Ignore answers `status` once `gate` opens. */
interface ServeOpts { status?: number; gate?: Promise<void>; enabled?: boolean; refetchGate?: Promise<void> }

function serve(absences: GameTimeAbsence[], opts: ServeOpts = {}) {
    const ignored = new Set<number>();
    const posted: string[] = [];
    server.use(
        http.get(GAME_TIME_ABSENCES_URL, async () => {
            // `refetchGate` holds every list read made after an Ignore, so only the rollback can restore a row.
            if (opts.refetchGate && posted.length > 0) await opts.refetchGate;
            return HttpResponse.json({ data: absences.filter((a) => !ignored.has(a.id)) });
        }),
        http.get(CALENDARS_OVERVIEW_URL, () => HttpResponse.json(overview(opts.enabled ?? true))),
        http.post(ABSENCE_IGNORE_URL, async ({ params }) => {
            posted.push(String(params['id']));
            if (opts.gate) await opts.gate;
            if (opts.status === 409) return calendarErrorResponse(409, 'not_calendar');
            ignored.add(Number(params['id']));
            return new HttpResponse(null, { status: 204 });
        }),
    );
    return posted;
}

/** The row whose title is `title`; fails loudly when it is not rendered. */
function rowOf(title: string): HTMLElement {
    const row = screen.getByText(title).closest<HTMLElement>('[data-testid="away-row"]');
    if (!row) throw new Error(`no away row titled "${title}"`);
    return row;
}

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    vi.clearAllMocks();
});
afterEach(() => { vi.useRealTimers(); });

describe('AwayPanel — synced calendar days (ROK-1595 S1)', () => {
    it('offers Ignore, never Remove, on a synced row (D4 regression), with "4 days · Google Calendar"', async () => {
        serve([manualAbsenceFixture, calendarAbsenceFixture]);
        renderWithProviders(<AwayPanel layout="stacked" />);
        await screen.findByText(SYNCED);
        const row = rowOf(SYNCED);
        expect(row).toHaveAttribute('data-source', 'calendar');
        expect(within(row).queryByRole('button', { name: `Remove ${SYNCED}` })).toBeNull();
        expect(within(row).getByRole('button', { name: `Ignore ${SYNCED}` })).toBeInTheDocument();
        expect(within(row).getByTestId('away-row-meta')).toHaveTextContent('4 days · Google Calendar');
    });

    it('keeps Remove (and no Ignore) on a manual row', async () => {
        serve([manualAbsenceFixture, calendarAbsenceFixture]);
        renderWithProviders(<AwayPanel layout="stacked" />);
        await screen.findByText(MANUAL);
        const row = rowOf(MANUAL);
        expect(row).toHaveAttribute('data-source', 'manual');
        expect(within(row).getByRole('button', { name: `Remove ${MANUAL}` })).toBeInTheDocument();
        expect(within(row).queryByRole('button', { name: `Ignore ${MANUAL}` })).toBeNull();
    });

    it('draws synced rows quiet: hairline border, no fill, muted title', async () => {
        serve([manualAbsenceFixture, calendarAbsenceFixture]);
        renderWithProviders(<AwayPanel layout="stacked" />);
        await screen.findByText(SYNCED);
        expect(rowOf(SYNCED).className).toContain('border-edge-subtle');
        expect(rowOf(SYNCED).className).toContain('bg-transparent');
        expect(screen.getByText(SYNCED).className).toContain('text-muted');
        expect(rowOf(MANUAL).className).toContain('bg-panel');
    });

    it('Ignore posts the row id, hides it, and toasts "Ignored …" (no Undo, F-9)', async () => {
        const posted = serve([manualAbsenceFixture, calendarAbsenceFixture]);
        renderWithProviders(<AwayPanel layout="stacked" />);
        await screen.findByText(SYNCED);
        fireEvent.click(within(rowOf(SYNCED)).getByRole('button', { name: `Ignore ${SYNCED}` }));
        await waitFor(() => expect(screen.queryByText(SYNCED)).toBeNull());
        await waitFor(() => expect(t.success).toHaveBeenCalledWith(`Ignored ${SYNCED}`));
        expect(posted).toEqual([String(calendarAbsenceFixture.id)]);
        expect(screen.getByText(MANUAL)).toBeInTheDocument();
    });

    it('puts the row back and toasts when the server refuses (409)', async () => {
        let release: () => void = () => {};
        const gate = new Promise<void>((resolve) => { release = resolve; });
        let releaseRefetch: () => void = () => {};
        const refetchGate = new Promise<void>((resolve) => { releaseRefetch = resolve; });
        serve([manualAbsenceFixture, calendarAbsenceFixture], { status: 409, gate, refetchGate });
        renderWithProviders(<AwayPanel layout="stacked" />);
        await screen.findByText(SYNCED);
        fireEvent.click(within(rowOf(SYNCED)).getByRole('button', { name: `Ignore ${SYNCED}` }));
        await waitFor(() => expect(screen.queryByText(SYNCED)).toBeNull());
        release();
        // The post-error refetch is still held: the row is back from the rollback alone.
        await waitFor(() => expect(screen.queryByText(SYNCED), 'rolled back before the list refetch lands').not.toBeNull());
        // The per-call onError toast runs only after the hook's onSettled, which awaits the
        // invalidation refetches (TanStack v5 order), so the refetch must land before it fires.
        releaseRefetch();
        await waitFor(() => expect(t.error).toHaveBeenCalledWith('Could not ignore that day'));
    });
});

describe('AwayPanel — calendar group divider (ROK-1595 S1)', () => {
    it('reads "From your calendars" left and "Synced 4 min ago" right', async () => {
        serve([manualAbsenceFixture, calendarAbsenceFixture]);
        renderWithProviders(<AwayPanel layout="stacked" />);
        expect(await screen.findByTestId('away-calendar-synced')).toHaveTextContent('Synced 4 min ago');
        const divider = screen.getByTestId('away-calendar-divider');
        expect(divider).toHaveTextContent('From your calendars');
        expect(divider.lastElementChild).toBe(screen.getByTestId('away-calendar-synced'));
    });

    it('hides the synced time with the kill switch off, without breaking the list', async () => {
        serve([calendarAbsenceFixture], { enabled: false });
        renderWithProviders(<AwayPanel layout="stacked" />);
        await screen.findByText(SYNCED);
        await waitFor(() => expect(screen.getByTestId('away-calendar-divider')).toBeInTheDocument());
        expect(screen.queryByTestId('away-calendar-synced')).toBeNull();
    });
});

describe('AwayPanel — empty state with calendar days (A3)', () => {
    const EMPTY = 'No time away booked. Pick the days below and polls stop counting you as free on them.';

    it('shows the empty text over the calendar group when only synced days exist', async () => {
        serve([calendarAbsenceFixture]);
        renderWithProviders(<AwayPanel layout="stacked" />);
        await screen.findByText(SYNCED);
        expect(screen.getByTestId('away-empty')).toHaveTextContent(EMPTY);
        expect(screen.getByTestId('away-calendar-group')).toBeInTheDocument();
    });

    it('shows only the empty text, and no calendar group, when nothing is booked', async () => {
        serve([]);
        renderWithProviders(<AwayPanel layout="stacked" />);
        expect(await screen.findByTestId('away-empty')).toHaveTextContent(EMPTY);
        expect(screen.queryByTestId('away-calendar-group')).toBeNull();
    });
});
