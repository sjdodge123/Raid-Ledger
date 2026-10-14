import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import type { GameServerCalendarItemDto, GameServerStatusDto } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { GAME_SERVERS_CALENDAR_URL, GAME_SERVERS_STATUS_URL } from '../../../test/mocks/pelican-handlers';
import { createTestQueryClient } from '../../../test/render-helpers';
import { useTimezoneStore } from '../../../stores/timezone-store';
import { STATUS_REFETCH_MS, usePelicanCalendarItems } from './use-pelican-calendar-items';

const REGISTRY_URL = 'http://localhost:3000/games/configured';
const range = { from: '2026-10-11T00:00:00.000Z', to: '2026-10-18T00:00:00.000Z' };
const base = { serverKey: 'srv-1', serverName: 'Valheim Dedicated', gameId: 7, provider: 'pelican' };
const items: GameServerCalendarItemDto[] = [
    { kind: 'window', ...base, start: '2026-10-14T22:00:00Z', end: '2026-10-15T06:00:00Z', label: 'up', source: 'schedule' },
    { kind: 'marker', ...base, at: '2026-10-15T08:05:00Z', effect: 'restart', label: 'restart' },
];
const statuses: GameServerStatusDto[] = [{ ...base, state: 'running', checkedAt: new Date().toISOString() }];

let requests: string[] = [];
const record = ({ request }: { request: Request }) => { requests.push(request.url); };
const serverRequests = () => requests.filter((u) => u.includes('/game-servers/') || u.includes('/games/configured'));

function useData() {
    server.use(
        http.get(GAME_SERVERS_CALENDAR_URL, () => HttpResponse.json({ data: items })),
        http.get(GAME_SERVERS_STATUS_URL, () => HttpResponse.json({ data: statuses })),
        http.get(REGISTRY_URL, () => HttpResponse.json({ data: [{ id: 7, slug: 'valheim' }], meta: { total: 1 } })),
    );
}

interface Props { selected: ReadonlySet<string> | undefined; enabled: boolean }
function renderLayer(initial: Props, client: QueryClient = createTestQueryClient()) {
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const hook = renderHook((p: Props) => usePelicanCalendarItems(range, p.selected, p.enabled), { wrapper, initialProps: initial });
    return { ...hook, client };
}

beforeEach(() => {
    requests = [];
    server.events.on('request:start', record);
    useTimezoneStore.setState({ resolved: 'UTC' });
});
afterEach(() => { server.events.removeListener('request:start', record); });

describe('usePelicanCalendarItems', () => {
    it('fires no request and returns [] when enabled is false', () => {
        useData();
        const { result, client } = renderLayer({ selected: new Set(['valheim']), enabled: false });
        // renderHook runs the mount effects in act(): an enabled query is already fetching here.
        expect(client.isFetching()).toBe(0);
        expect(serverRequests()).toEqual([]);
        expect(result.current).toEqual([]);
    });

    it('returns [] for an empty response (unconfigured Pelican, AC3)', async () => {
        const { result } = renderLayer({ selected: undefined, enabled: true });
        await waitFor(() => expect(serverRequests()).toHaveLength(2));
        expect(result.current).toEqual([]);
    });

    it('requests the range without gameIds and maps items with live state', async () => {
        useData();
        const { result } = renderLayer({ selected: undefined, enabled: true });
        await waitFor(() => expect(result.current).toHaveLength(2));
        const calendarUrl = new URL(requests.find((u) => u.includes('/game-servers/calendar')) ?? 'http://x');
        expect(calendarUrl.searchParams.get('from')).toBe(range.from);
        expect(calendarUrl.searchParams.get('to')).toBe(range.to);
        expect(calendarUrl.searchParams.has('gameIds')).toBe(false);
        await waitFor(() => expect(result.current[1]).toMatchObject({
            kind: 'marker', tip: { title: 'Restart · Valheim Dedicated · 8:05 AM', detail: 'Online · checked just now' },
        }));
    });

    it('applies the game filter client-side with no calendar refetch', async () => {
        useData();
        const { result, rerender } = renderLayer({ selected: new Set(['valheim']), enabled: true });
        await waitFor(() => expect(result.current).toHaveLength(2));
        rerender({ selected: new Set(['wow']), enabled: true });
        expect(result.current).toEqual([]);
        rerender({ selected: new Set(['valheim']), enabled: true });
        expect(result.current).toHaveLength(2);
        expect(requests.filter((u) => u.includes('/game-servers/calendar'))).toHaveLength(1);
    });

    it('polls status every 60s while enabled (AC10)', async () => {
        const { client } = renderLayer({ selected: undefined, enabled: true });
        await waitFor(() => expect(serverRequests()).toHaveLength(2));
        const query = client.getQueryCache().find({ queryKey: ['game-servers', 'status'] });
        expect(STATUS_REFETCH_MS).toBe(60_000);
        expect(query?.observers[0]?.options.refetchInterval).toBe(60_000);
    });
});
