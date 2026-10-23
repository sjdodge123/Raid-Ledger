/** ROK-1876 L3 — the "Server hours" Overview widget on the game-server hub, fed by GET /game-servers/calendar. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import type { GameServerCalendarItemDto, GameServerEffect, GameServerState, GuildPage } from '@raid-ledger/contract';
import type { HubCtx } from '../../hub-module';
import { server } from '../../../test/mocks/server';
import { GAME_SERVERS_CALENDAR_URL } from '../../../test/mocks/pelican-handlers';
import { createTestQueryClient } from '../../../test/render-helpers';
import { useTimezoneStore } from '../../../stores/timezone-store';
import { ServerHoursWidget } from './server-hours-widget';
import { pelicanHubModule } from './register-hub';
import { LazyServerHoursWidget } from './server-hours-widget-lazy';

const SUMMARY = { id: 9, gameId: 3, kind: 'game_server' as const, name: 'Valheim — Main', region: 'server', realmSlug: null, realmName: null, faction: null, memberCount: 1, lastSnapshotAt: null };
const H = 3_600_000;
const at = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();
const base = { serverName: 'Valheim', gameId: 7, provider: 'pelican' };

function page(withServer = true, state: GameServerState = 'running'): GuildPage {
    return {
        guild: SUMMARY, importedBy: null,
        viewer: { role: 'visitor', canEdit: false, canManageEditors: false },
        ranks: [], roleCounts: { tank: 0, healer: 0, dps: 0, unknown: 0 },
        ...(withServer ? { server: { pelicanServerId: 4, gameSlug: 'valheim', gameIconUrl: null, state, viewerJoined: false } } : {}),
    };
}

/** Never read by the widget — spelled out rather than cast (recent-arrivals-widget.test idiom). */
const IDLE_RAIDS: HubCtx['raids'] = {
    data: undefined, error: null, isPending: true, isLoading: true, isLoadingError: false,
    isRefetchError: false, isSuccess: false, isError: false, isFetched: false,
    isFetchedAfterMount: false, isFetching: false, isInitialLoading: true, isPaused: false,
    isPlaceholderData: false, isRefetching: false, isStale: false, isEnabled: true,
    status: 'pending', fetchStatus: 'fetching', dataUpdatedAt: 0, errorUpdatedAt: 0,
    failureCount: 0, failureReason: null, errorUpdateCount: 0,
    refetch: () => Promise.reject(new Error('not used')),
};

function ctx(p: GuildPage): HubCtx {
    return { page: p, raids: IDLE_RAIDS };
}

function serve(items: GameServerCalendarItemDto[]) {
    server.use(http.get(GAME_SERVERS_CALENDAR_URL, () => HttpResponse.json({ data: items })));
}

function renderWidget(p: GuildPage = page()) {
    return render(<QueryClientProvider client={createTestQueryClient()}><ServerHoursWidget {...ctx(p)} /></QueryClientProvider>);
}

beforeEach(() => { useTimezoneStore.setState({ resolved: 'UTC' }); });
afterEach(() => { vi.useRealTimers(); });

describe('ServerHoursWidget (ROK-1876)', () => {
    it("renders this server's windows and the next restart, not another server's", async () => {
        serve([
            { kind: 'window', ...base, serverKey: '4', start: at(2 * H), end: at(4 * H), label: 'Open', source: 'schedule' },
            { kind: 'window', ...base, serverKey: '4', start: at(50 * H), end: at(52 * H), label: 'Open', source: 'schedule' },
            { kind: 'window', ...base, serverKey: '12', start: at(26 * H), end: at(27 * H), label: 'Other', source: 'schedule' },
            { kind: 'marker', ...base, serverKey: '4', at: at(10 * H), effect: 'restart', label: 'Restart' },
        ]);
        renderWidget();
        expect(screen.getByRole('heading', { name: 'Server hours' })).toBeInTheDocument();
        await waitFor(() => expect(screen.getAllByTestId('server-hub-hours-row').length).toBeGreaterThan(0));
        expect(screen.getAllByTestId('server-hub-hours-row')).toHaveLength(2);
        expect(screen.getByTestId('server-hub-hours-now')).toHaveTextContent(/^Online now · outside its usual hours/);
        expect(screen.getByTestId('server-hub-hours-restart')).toHaveTextContent(/^Restart · /);
    });

    it('shows "No set hours" when the server has no windows', async () => {
        serve([{ kind: 'window', ...base, serverKey: '12', start: at(2 * H), end: at(3 * H), label: 'Other', source: 'schedule' }]);
        renderWidget();
        expect(await screen.findByTestId('server-hub-hours-empty')).toHaveTextContent('No set hours');
        expect(screen.getByTestId('server-hub-hours-now')).toHaveTextContent('Online');
        expect(screen.queryByTestId('server-hub-hours-row')).not.toBeInTheDocument();
    });

    it('keeps its clock ticking while mounted, so a window that opens flips the now line (Codex r1 P2)', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        serve([{ kind: 'window', ...base, serverKey: '4', start: at(90_000), end: at(2 * H), label: 'Open', source: 'schedule' }]);
        renderWidget();
        await waitFor(() => expect(screen.getByTestId('server-hub-hours-now')).toHaveTextContent(/^Online now · outside its usual hours/));
        await act(async () => { await vi.advanceTimersByTimeAsync(3 * 60_000); });
        expect(screen.getByTestId('server-hub-hours-now')).toHaveTextContent(/^Online now · until /);
    });

    it('reserves the card while the hours chunk loads, so the Overview does not shift (review fix-delta MINOR)', async () => {
        server.use(http.get(GAME_SERVERS_CALENDAR_URL, () => HttpResponse.json({ data: [] })));
        render(<QueryClientProvider client={createTestQueryClient()}><LazyServerHoursWidget {...ctx(page())} /></QueryClientProvider>);
        expect(screen.getByTestId('server-hub-hours-fallback'), 'the Suspense fallback is a placeholder card, not null').toHaveTextContent('Loading hours…');
        expect(screen.getByRole('heading', { name: 'Server hours' })).toBeInTheDocument();
        expect(await screen.findByText('No set hours')).toBeInTheDocument();
    });

    it('is an Overview widget before Recent arrivals, visible to every viewer of a server hub only', () => {
        const w = pelicanHubModule.overviewWidgets.find((x) => x.id === 'server-hours');
        const arrivals = pelicanHubModule.overviewWidgets.find((x) => x.id === 'recent-arrivals');
        expect(w?.order).toBe(50);
        expect((w?.order ?? 99) < (arrivals?.order ?? 0)).toBe(true);
        expect(w?.visible?.(ctx(page()))).toBe(true);
        expect(w?.visible?.(ctx(page(false)))).toBe(false);
    });
});

/* ROK-1877 L2 — every mockup state the model can produce, rendered on the card. */
const DAY = 86_400_000;
const NY = 'America/New_York';
const DEMO_SPANS = '9:00 AM – 9:40 AM, 2:00 PM – 10:00 PM';
const FRI_430PM_EDT = Date.parse('2026-10-16T20:30:00Z');
const FRI_1115PM_EDT = Date.parse('2026-10-17T03:15:00Z');
const iso = (ms: number) => new Date(ms).toISOString();
const win = (start: number, end: number): GameServerCalendarItemDto => ({ kind: 'window', ...base, serverKey: '4', start: iso(start), end: iso(end), label: 'Up', source: 'schedule' });
const mark = (atMs: number, effect: GameServerEffect): GameServerCalendarItemDto => ({ kind: 'marker', ...base, serverKey: '4', at: iso(atMs), effect, label: effect });
const days = <T,>(firstDay: string, n: number, perDay: (midnight: number) => T[]): T[] =>
    Array.from({ length: n }, (_, i) => perDay(Date.parse(`${firstDay}T00:00:00Z`) + i * DAY)).flat();
/** The demo seed: 13:00–13:40 and 18:00–02:00 UTC daily (9:00–9:40 AM and 2:00–10:00 PM EDT). */
const demo = (firstDay: string) => days(firstDay, 9, (d) => [win(d + 13 * H, d + 13 * H + 40 * 60_000), win(d + 18 * H, d + 26 * H)]);
const dailyMark = (hourUtc: number, minuteUtc: number, effect: GameServerEffect) => days('2026-10-15', 9, (d) => [mark(d + hourUtc * H + minuteUtc * 60_000, effect)]);

async function show(items: GameServerCalendarItemDto[], opts: { state?: GameServerState; now?: number; tz?: string } = {}) {
    vi.useFakeTimers({ shouldAdvanceTime: true, now: opts.now ?? FRI_430PM_EDT });
    useTimezoneStore.setState({ resolved: opts.tz ?? NY });
    serve(items);
    renderWidget(page(true, opts.state ?? 'running'));
    await waitFor(() => expect(screen.queryByTestId('server-hub-hours-loading')).not.toBeInTheDocument());
}

const nowText = () => screen.getByTestId('server-hub-hours-now').textContent;
const tone = () => screen.getByTestId('server-hub-hours-dot').getAttribute('data-tone');
const rowLabels = () => screen.queryAllByTestId('server-hub-hours-row').map((r) => r.getAttribute('data-day-label'));

describe('ServerHoursWidget now line (ROK-1877)', () => {
    it('S1 online in hours: success dot and word, "until 10:00 PM", one "Every day" row', async () => {
        await show(demo('2026-10-15'));
        expect(nowText()).toBe('Online now · until 10:00 PM');
        expect(tone()).toBe('online');
        expect(screen.getByTestId('server-hub-hours-dot')).toHaveClass('bg-success');
        expect(screen.getByText('Online now')).toHaveClass('text-success');
        expect(rowLabels()).toEqual(['Every day']);
        expect(screen.getByTestId('server-hub-hours-row')).toHaveTextContent(`Every day${DEMO_SPANS}`);
        expect(screen.queryByTestId('server-hub-hours-sub')).not.toBeInTheDocument();
    });

    it('S3 manual start outside hours: "outside its usual hours" plus the muted next-scheduled line', async () => {
        await show(demo('2026-10-15'), { now: FRI_1115PM_EDT });
        expect(nowText()).toBe('Online now · outside its usual hours');
        expect(tone()).toBe('online');
        expect(screen.getByTestId('server-hub-hours-sub')).toHaveTextContent('Next scheduled: Sat 9:00 AM');
        expect(screen.getByTestId('server-hub-hours-sub')).toHaveClass('text-muted');
    });

    it('S4 offline in hours: the warning dot and "usually up until 10:00 PM", word stays foreground', async () => {
        await show(demo('2026-10-15'), { state: 'offline' });
        expect(nowText()).toBe('Offline · usually up until 10:00 PM');
        expect(tone()).toBe('warn');
        expect(screen.getByTestId('server-hub-hours-dot')).toHaveClass('bg-warning');
        expect(screen.getByText('Offline')).toHaveClass('text-foreground');
    });

    it('S2 offline, next up: the faint dot and "next up Sat 9:00 AM"', async () => {
        await show(demo('2026-10-15'), { state: 'offline', now: FRI_1115PM_EDT });
        expect(nowText()).toBe('Offline · next up Sat 9:00 AM');
        expect(tone()).toBe('offline');
        expect(screen.getByTestId('server-hub-hours-dot')).toHaveClass('bg-faint');
    });

});

describe('ServerHoursWidget body and power lines (ROK-1877)', () => {
    it('merges weekday-only hours into one "Mon–Fri" row', async () => {
        const weekdays = days('2026-10-19', 5, (d) => [win(d + 17 * H, d + 21 * H)]);
        await show(weekdays, { state: 'offline', now: Date.parse('2026-10-19T12:00:00Z'), tz: 'UTC' });
        expect(rowLabels()).toEqual(['Mon–Fri']);
        expect(screen.getByTestId('server-hub-hours-row')).toHaveTextContent('Mon–Fri5:00 PM – 9:00 PM');
    });

    it('still reads "Mon–Fri" on a Tuesday, when the run wraps the 7-day window', async () => {
        const weekdays = days('2026-10-19', 8, (d) => (new Date(d).getUTCDay() % 6 === 0 ? [] : [win(d + 17 * H, d + 21 * H)]));
        await show(weekdays, { state: 'offline', now: Date.parse('2026-10-20T12:00:00Z'), tz: 'UTC' });
        expect(rowLabels()).toEqual(['Mon–Fri']);
    });

    it('splits the DST-shifted Sunday into its own row (US fall-back 2026-11-01)', async () => {
        await show(demo('2026-10-25'), { now: Date.parse('2026-10-26T19:00:00Z') });
        expect(rowLabels()).toEqual(['Mon–Sat', 'Sun']);
        expect(screen.getAllByTestId('server-hub-hours-row')[1]).toHaveTextContent('Sun8:00 AM – 8:40 AM, 1:00 PM – 9:00 PM');
    });

    it('S7 start-only: the "Starts · daily" line, no rows and no "No set hours"', async () => {
        await show(dailyMark(22, 0, 'start'));
        expect(screen.getByTestId('server-hub-hours-start')).toHaveTextContent('Starts · daily 6:00 PM');
        expect(screen.queryByTestId('server-hub-hours-stop')).not.toBeInTheDocument();
        expect(screen.queryByTestId('server-hub-hours-empty')).not.toBeInTheDocument();
        expect(screen.queryByTestId('server-hub-hours-row')).not.toBeInTheDocument();
        expect(nowText()).toBe('Online now');
    });

    it('S7 stop-only: the "Stops · daily" line in the muted restart-line style', async () => {
        await show(dailyMark(6, 0, 'stop'));
        expect(screen.getByTestId('server-hub-hours-stop')).toHaveTextContent('Stops · daily 2:00 AM');
        expect(screen.getByTestId('server-hub-hours-stop')).toHaveClass('text-dim');
        expect(screen.queryByTestId('server-hub-hours-empty')).not.toBeInTheDocument();
    });

    it('a restart at the same time every day reads "nightly"', async () => {
        await show([...demo('2026-10-15'), ...dailyMark(4, 5, 'restart')]);
        expect(screen.getByTestId('server-hub-hours-restart')).toHaveTextContent('Restart · nightly 12:05 AM');
    });

    it('S6 no set hours: restart-only reads "No set hours" with the restart line and a bare state', async () => {
        await show(dailyMark(4, 5, 'restart'), { state: 'offline' });
        expect(screen.getByTestId('server-hub-hours-empty')).toHaveTextContent('No set hours');
        expect(screen.getByTestId('server-hub-hours-restart')).toHaveTextContent('Restart · nightly 12:05 AM');
        expect(nowText()).toBe('Offline');
        expect(tone()).toBe('offline');
    });

    it('error: unchanged copy, the now line still shows the live state', async () => {
        server.use(http.get(GAME_SERVERS_CALENDAR_URL, () => HttpResponse.json({ error: 'boom' }, { status: 500 })));
        renderWidget();
        expect(await screen.findByTestId('server-hub-hours-error')).toHaveTextContent('Couldn’t load the hours');
        expect(nowText()).toBe('Online now');
        expect(screen.queryByTestId('server-hub-hours-empty')).not.toBeInTheDocument();
    });
});
