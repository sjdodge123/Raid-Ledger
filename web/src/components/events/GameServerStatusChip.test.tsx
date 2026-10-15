import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { GameServerState, GameServerStatusDto } from '@raid-ledger/contract';
import { server } from '../../test/mocks/server';
import { GAME_SERVERS_STATUS_URL } from '../../test/mocks/pelican-handlers';
import { renderWithProviders } from '../../test/render-helpers';
import { usePluginStore } from '../../stores/plugin-store';
import { clearRegistry, registerPlugin } from '../../plugins/plugin-registry';
import { gameServerStatusesKey } from '../../hooks/use-game-server-statuses';
import { GameServerStatusChip } from './GameServerStatusChip';

const NOW = new Date('2026-10-14T12:00:00.000Z');
const BADGE = { icon: '/x.svg', color: '#000', label: 'X' };
const minsAgo = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString();

function status(serverName: string, state: GameServerState, checkedAt = minsAgo(2)): GameServerStatusDto {
    return { serverKey: `k-${serverName}`, serverName, gameId: 7, provider: 'test-gs', state, checkedAt };
}

let requests: string[] = [];
function respond(data: GameServerStatusDto[]) {
    server.use(http.get(GAME_SERVERS_STATUS_URL, ({ request }) => {
        requests.push(request.url);
        return HttpResponse.json({ data });
    }));
}

function activateProvider() {
    registerPlugin('test-gs', BADGE).registerGameServerProvider();
    usePluginStore.setState({ activeSlugs: new Set(['test-gs']) });
}

describe('GameServerStatusChip (ROK-1776)', () => {
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(NOW);
        requests = [];
        clearRegistry();
        usePluginStore.setState({ activeSlugs: new Set<string>() });
    });
    afterEach(() => {
        clearRegistry();
        usePluginStore.setState({ activeSlugs: new Set<string>() });
        vi.useRealTimers();
    });

    it('shows the online chip with its checked-at age, requesting only this game', async () => {
        activateProvider();
        respond([status('Valheim Main', 'running')]);
        renderWithProviders(<GameServerStatusChip gameId={7} />);
        const chip = await screen.findByText('Server online');
        expect(chip.getAttribute('title')).toBe('Valheim Main: Online');
        expect(chip.getAttribute('data-tone')).toBe('success');
        expect(screen.getByTestId('game-server-status').textContent).toBe('Server onlinechecked 2 min ago');
        expect(requests).toHaveLength(1);
        expect(new URL(requests[0] ?? '').searchParams.get('gameIds')).toBe('7');
    });

    it('renders nothing when the game has no mapped, visible server', async () => {
        activateProvider();
        respond([]);
        renderWithProviders(<GameServerStatusChip gameId={7} />);
        await waitFor(() => expect(requests).toHaveLength(1));
        expect(screen.queryByTestId('game-server-status')).toBeNull();
    });

    it('renders nothing and makes no request while no provider plugin is active', async () => {
        registerPlugin('test-gs', BADGE).registerGameServerProvider();
        respond([status('Valheim Main', 'running')]);
        const { queryClient } = renderWithProviders(<GameServerStatusChip gameId={7} />);
        // A disabled query never leaves 'idle'; an ungated one is 'fetching' straight after mount.
        expect(queryClient.getQueryState(gameServerStatusesKey(7))?.fetchStatus).toBe('idle');
        expect(screen.queryByTestId('game-server-status')).toBeNull();
        expect(requests).toEqual([]);
    });

    it('degrades a stale check to unknown', async () => {
        activateProvider();
        respond([status('Valheim Main', 'running', minsAgo(30))]);
        renderWithProviders(<GameServerStatusChip gameId={7} />);
        const chip = await screen.findByText('Server status unknown');
        expect(chip.getAttribute('data-tone')).toBe('neutral');
        expect(chip.getAttribute('title')).toBe('Valheim Main: Unknown');
    });

    it('summarises several servers as worst state + count, names only in the title', async () => {
        activateProvider();
        respond([status('Alpha', 'running'), status('Beta', 'offline', minsAgo(4)), status('Gamma', 'starting')]);
        renderWithProviders(<GameServerStatusChip gameId={7} />);
        const chip = await screen.findByText('1 of 3 servers offline');
        expect(chip.getAttribute('data-tone')).toBe('danger');
        expect(chip.getAttribute('title')).toBe('Alpha: Online, Beta: Offline, Gamma: Starting');
        expect(screen.getByText('checked 4 min ago')).toBeTruthy();
    });
});
