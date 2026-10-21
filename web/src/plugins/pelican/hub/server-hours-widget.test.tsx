/** ROK-1876 L3 — the "Server hours" Overview widget on the game-server hub, fed by GET /game-servers/calendar. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import type { GameServerCalendarItemDto, GuildPage } from '@raid-ledger/contract';
import type { HubCtx } from '../../hub-module';
import { server } from '../../../test/mocks/server';
import { GAME_SERVERS_CALENDAR_URL } from '../../../test/mocks/pelican-handlers';
import { createTestQueryClient } from '../../../test/render-helpers';
import { useTimezoneStore } from '../../../stores/timezone-store';
import { ServerHoursWidget } from './server-hours-widget';
import { pelicanHubModule } from './register-hub';

const SUMMARY = { id: 9, gameId: 3, kind: 'game_server' as const, name: 'Valheim — Main', region: 'server', realmSlug: null, realmName: null, faction: null, memberCount: 1, lastSnapshotAt: null };
const H = 3_600_000;
const at = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();
const base = { serverName: 'Valheim', gameId: 7, provider: 'pelican' };

function page(withServer = true): GuildPage {
    return {
        guild: SUMMARY, importedBy: null,
        viewer: { role: 'visitor', canEdit: false, canManageEditors: false },
        ranks: [], roleCounts: { tank: 0, healer: 0, dps: 0, unknown: 0 },
        ...(withServer ? { server: { pelicanServerId: 4, gameSlug: 'valheim', gameIconUrl: null, state: 'running' as const, viewerJoined: false } } : {}),
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
        expect(screen.getByTestId('server-hub-hours-now')).toHaveTextContent(/^Online · opens /);
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
        await waitFor(() => expect(screen.getByTestId('server-hub-hours-now')).toHaveTextContent(/^Online · opens /));
        await act(async () => { await vi.advanceTimersByTimeAsync(3 * 60_000); });
        expect(screen.getByTestId('server-hub-hours-now')).toHaveTextContent(/^Online · closes /);
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
