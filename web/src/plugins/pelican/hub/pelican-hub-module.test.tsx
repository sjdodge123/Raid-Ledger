/**
 * ROK-1831 — the Pelican game_server hub module: registration, the Join pill,
 * the server member columns and the Quick Play tab.
 */
import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { GuildPage, GuildMemberRow } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { renderWithProviders } from '../../../test/render-helpers';
import { getHubModuleRegistrations } from '../../plugin-registry';
import type { HubCtx } from '../../hub-module';
import '../register';
import { pelicanHubModule, serverCoreWidgetVisible } from './register-hub';
import { JoinLeavePill, ServerStatusPill } from './server-hero';
import { QuickPlayTab } from './quick-play-tab';
import { lastSeenLabel } from './server-member.helpers';
import { registerServerHubGameTab } from './server-hub-game-tabs';

const HUB = 'http://localhost:3000/plugins/pelican/hubs/9';

function member(id: number, server: GuildMemberRow['server']): GuildMemberRow {
    return { memberId: id, name: `P${id}`, class: null, level: null, rankIndex: null, rankName: null, effectiveRole: null, characterId: null, isMain: false, ...(server ? { server } : {}) };
}

function page(joined: boolean): GuildPage {
    return {
        guild: { id: 9, gameId: 3, kind: 'game_server', name: 'Valheim — Main', region: 'server', realmSlug: null, realmName: null, faction: null, memberCount: 1, lastSnapshotAt: null },
        importedBy: null,
        viewer: { role: 'visitor', canEdit: false, canManageEditors: false },
        ranks: [{ rankIndex: null, rankName: null, members: [
            member(1, { lastSeenAt: '2026-10-18T10:00:00.000Z', onlineNow: true, characterName: 'Bjorn', source: 'presence' }),
            member(2, { lastSeenAt: null, onlineNow: false, characterName: null, source: 'manual' }),
        ] }],
        roleCounts: { tank: 0, healer: 0, dps: 0, unknown: 0 },
        server: { pelicanServerId: 4, gameSlug: 'valheim', gameIconUrl: null, state: 'running', viewerJoined: joined },
    };
}

/** Never read by these components — spelled out rather than cast (settings-sheet.test idiom). */
const IDLE_RAIDS: HubCtx['raids'] = {
    data: undefined, error: null, isPending: true, isLoading: true, isLoadingError: false,
    isRefetchError: false, isSuccess: false, isError: false, isFetched: false,
    isFetchedAfterMount: false, isFetching: false, isInitialLoading: true, isPaused: false,
    isPlaceholderData: false, isRefetching: false, isStale: false, isEnabled: true,
    status: 'pending', fetchStatus: 'fetching', dataUpdatedAt: 0, errorUpdatedAt: 0,
    failureCount: 0, failureReason: null, errorUpdateCount: 0,
    refetch: () => Promise.reject(new Error('not used')),
};

function ctx(joined = false, gameSlug = 'valheim'): HubCtx {
    const p = page(joined);
    return { page: { ...p, server: { pelicanServerId: 4, gameSlug, gameIconUrl: null, state: 'running', viewerJoined: joined } }, raids: IDLE_RAIDS };
}

describe('pelicanHubModule (ROK-1831)', () => {
    it('registers for kind game_server under the pelican plugin', () => {
        const reg = getHubModuleRegistrations().find((r) => r.module.kind === 'game_server');
        expect(reg?.pluginSlug).toBe('pelican');
        expect(reg?.module).toBe(pelicanHubModule);
    });

    it('lists every member flat and renders the server columns from row.server', () => {
        const rows = pelicanHubModule.memberRows(page(false));
        expect(rows.map((r) => r.memberId)).toEqual([1, 2]);
        const [player, character, online] = pelicanHubModule.memberColumns;
        if (player === undefined || character === undefined || online === undefined) throw new Error('expected server columns');
        const first = rows[0];
        const second = rows[1];
        if (first === undefined || second === undefined) throw new Error('expected two rows');
        render(<><player.cell row={first} /><character.cell row={first} /><online.cell row={first} /><online.cell row={second} /></>);
        expect(screen.getByTestId('server-member-player')).toHaveTextContent(first.name);
        expect(screen.getByText('Bjorn')).toBeInTheDocument();
        expect(screen.getByText('Online')).toBeInTheDocument();
        expect(screen.getByText('Offline')).toBeInTheDocument();
        expect(lastSeenLabel(second)).toBe('Joined, not played yet');
    });

    it('the hero reads server.onlineCount, so a visitor with no rows sees the real count (Codex r2 P3)', () => {
        const c = ctx();
        const server = c.page.server;
        if (server === undefined) throw new Error('fixture has a server block');
        const visitorPage = { ...c.page, ranks: [{ rankIndex: null, rankName: null, members: [] }], server: { ...server, onlineCount: 3 } };
        renderWithProviders(<ServerStatusPill page={visitorPage} raids={c.raids} />);
        expect(screen.getByTestId('server-hub-online')).toHaveTextContent('3 online');
    });

    it('the hero falls back to counting online rows when onlineCount is absent', () => {
        const c = ctx();
        renderWithProviders(<ServerStatusPill page={c.page} raids={c.raids} />);
        expect(screen.getByTestId('server-hub-online')).toHaveTextContent('1 online');
    });

    it('Join calls POST /join; Leave confirms then calls DELETE /join', async () => {
        const calls: string[] = [];
        server.use(
            http.post(`${HUB}/join`, () => { calls.push('POST'); return HttpResponse.json({ joined: true }, { status: 201 }); }),
            http.delete(`${HUB}/join`, () => { calls.push('DELETE'); return HttpResponse.json({ joined: false }); }),
        );
        const { unmount } = renderWithProviders(<JoinLeavePill {...ctx(false)} />);
        await userEvent.click(screen.getByTestId('server-hub-join'));
        await waitFor(() => expect(calls).toEqual(['POST']));
        unmount();
        renderWithProviders(<JoinLeavePill {...ctx(true)} />);
        await userEvent.click(screen.getByTestId('server-hub-leave'));
        await userEvent.click(screen.getByTestId('server-hub-leave-yes'));
        await waitFor(() => expect(calls).toEqual(['POST', 'DELETE']));
    });

    it('Quick Play tab lists sessions and shows an empty state', async () => {
        server.use(http.get(`${HUB}/quick-play`, () => HttpResponse.json({ data: [
            { eventId: 51, startedAt: '2026-10-17T18:00:00.000Z', endedAt: '2026-10-17T20:00:00.000Z', status: 'ended', participantCount: 3 },
        ] })));
        const { unmount } = renderWithProviders(<QuickPlayTab {...ctx()} />);
        expect(await screen.findByTestId('server-hub-quick-play-row')).toHaveTextContent('3 players');
        unmount();
        server.use(http.get(`${HUB}/quick-play`, () => HttpResponse.json({ data: [] })));
        renderWithProviders(<QuickPlayTab {...ctx()} />);
        expect(await screen.findByTestId('server-hub-quick-play-empty')).toBeInTheDocument();
    });

    it('hides the leader post and Discord mirror from a visitor, shows them to members and staff (ROK-1831)', () => {
        expect(serverCoreWidgetVisible('gm-post', ctx(false))).toBe(false);
        expect(serverCoreWidgetVisible('discord', ctx(false))).toBe(false);
        expect(serverCoreWidgetVisible('schedule', ctx(false))).toBe(true);
        expect(serverCoreWidgetVisible('gm-post', ctx(true))).toBe(true);
        const staff = ctx(false);
        const leader: HubCtx = { ...staff, page: { ...staff.page, viewer: { role: 'leader', canEdit: true, canManageEditors: true } } };
        expect(serverCoreWidgetVisible('discord', leader)).toBe(true);
        expect(pelicanHubModule.coreWidgetVisible).toBe(serverCoreWidgetVisible);
    });

    it('a per-game tab shows only on hubs of its game', () => {
        registerServerHubGameTab('valheim', { id: 'map', label: 'Map', order: 20, component: () => null });
        const tab = pelicanHubModule.tabs.find((t) => t.id === 'map');
        expect(tab?.visible?.(ctx())).toBe(true);
        expect(tab?.visible?.(ctx(false, 'minecraft'))).toBe(false);
    });
});
