/**
 * ROK-1831 L3-ii — the Recent arrivals widget, its registration, and the
 * nav guild row's game icon.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { GuildPage, GuildServerArrival, MyGuild } from '@raid-ledger/contract';
import type { HubCtx } from '../../hub-module';
import { GuildRows } from '../../wow/slots/guild-entry-bits';
import { RecentArrivalsWidget } from './recent-arrivals-widget';
import { pelicanHubModule } from './register-hub';

const SUMMARY = { id: 9, gameId: 3, kind: 'game_server' as const, name: 'Valheim — Main', region: 'server', realmSlug: null, realmName: null, faction: null, memberCount: 1, lastSnapshotAt: null };

function page(recentArrivals: GuildServerArrival[] | undefined): GuildPage {
    return {
        guild: SUMMARY, importedBy: null,
        viewer: { role: 'visitor', canEdit: false, canManageEditors: false },
        ranks: [], roleCounts: { tank: 0, healer: 0, dps: 0, unknown: 0 },
        server: { pelicanServerId: 4, gameSlug: 'valheim', gameIconUrl: null, state: 'running', viewerJoined: false, ...(recentArrivals ? { recentArrivals } : {}) },
    };
}

/** Never read by the widget — spelled out rather than cast (settings-sheet.test idiom). */
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

describe('RecentArrivalsWidget (ROK-1831)', () => {
    it('lists arrivals with name, character and first-seen line', () => {
        render(<RecentArrivalsWidget {...ctx(page([
            { memberId: 1, name: 'Ada', characterName: 'Viking', firstSeenAt: new Date().toISOString() },
            { memberId: 2, name: 'Bo', characterName: null, firstSeenAt: '2026-01-01T00:00:00.000Z' },
        ]))} />);
        const rows = screen.getAllByTestId('server-hub-arrivals-row');
        expect(rows).toHaveLength(2);
        expect(rows[0]).toHaveTextContent('Ada');
        expect(rows[0]).toHaveTextContent('Viking');
        expect(rows[0]).toHaveTextContent(/First seen/);
    });

    it('shows the empty state when there are no arrivals (or the field is absent)', () => {
        render(<RecentArrivalsWidget {...ctx(page(undefined))} />);
        expect(screen.getByTestId('server-hub-arrivals-empty')).toHaveTextContent('No arrivals yet');
    });

    it('is registered as an Overview widget, visible only with a server block', () => {
        const w = pelicanHubModule.overviewWidgets.find((x) => x.id === 'recent-arrivals');
        expect(w?.visible?.(ctx(page([])))).toBe(true);
        const p = page([]);
        delete p.server;
        expect(w?.visible?.(ctx(p))).toBe(false);
    });
});

describe('nav guild row game icon (ROK-1831 D6)', () => {
    const mine = (id: number, gameIconUrl: string | null): MyGuild => ({ ...SUMMARY, id, rankIndex: null, rankName: null, canEdit: false, gmPostHeadline: null, gameIconUrl });

    it('shows the game icon when sent, the generic crest when null', () => {
        render(<MemoryRouter><GuildRows guilds={[mine(1, 'https://img/valheim.png'), mine(2, null)]} /></MemoryRouter>);
        const icons = screen.getAllByTestId('guild-entry-game-icon');
        expect(icons).toHaveLength(1);
        expect(icons[0]).toHaveAttribute('src', 'https://img/valheim.png');
    });
});
