/**
 * ROK-1932 — the server hub hero's "N online" counts every player on the
 * server, and "· N not linked yet" nudges towards the Characters tab when some
 * of them have no character linked to a Raid Ledger user.
 */
import { beforeAll, describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { GuildPage, GuildPageServer } from '@raid-ledger/contract';
import type { HubCtx } from '../../hub-module';
import { ServerStatusPill } from './server-hero';
import { registerServerHubGameTab } from './server-hub-game-tabs';
import { usePluginStore } from '../../../stores/plugin-store';

/** Never read by the pill — spelled out rather than cast (pelican-hub-module.test idiom). */
const IDLE_RAIDS: HubCtx['raids'] = {
    data: undefined, error: null, isPending: true, isLoading: true, isLoadingError: false,
    isRefetchError: false, isSuccess: false, isError: false, isFetched: false,
    isFetchedAfterMount: false, isFetching: false, isInitialLoading: true, isPaused: false,
    isPlaceholderData: false, isRefetching: false, isStale: false, isEnabled: true,
    status: 'pending', fetchStatus: 'fetching', dataUpdatedAt: 0, errorUpdatedAt: 0,
    failureCount: 0, failureReason: null, errorUpdateCount: 0,
    refetch: () => Promise.reject(new Error('not used')),
};

function ctx(counts: Pick<GuildPageServer, 'onlineCount' | 'unlinkedOnlineCount'>, gameSlug = 'valheim'): HubCtx {
    const page: GuildPage = {
        guild: { id: 9, gameId: 3, kind: 'game_server', name: 'Valheim — Main', region: 'server', realmSlug: null, realmName: null, faction: null, memberCount: 2, lastSnapshotAt: null },
        importedBy: null,
        viewer: { role: 'visitor', canEdit: false, canManageEditors: false },
        ranks: [{ rankIndex: null, rankName: null, members: [] }],
        roleCounts: { tank: 0, healer: 0, dps: 0, unknown: 0 },
        server: { pelicanServerId: 4, gameSlug, gameIconUrl: null, state: 'running', viewerJoined: false, ...counts },
    };
    return { page, raids: IDLE_RAIDS };
}

beforeAll(() => {
    registerServerHubGameTab('valheim', { id: 'characters', label: 'Characters', order: 15, component: () => null });
    usePluginStore.getState().setActiveSlugs(['pelican', 'valheim']);
});

describe('ServerStatusPill — online + unlinked nudge (ROK-1932)', () => {
    it('shows "6 online · 4 not linked yet" with the nudge linking to the Characters tab', () => {
        render(<ServerStatusPill {...ctx({ onlineCount: 6, unlinkedOnlineCount: 4 })} />);
        expect(screen.getByTestId('server-hub-online')).toHaveTextContent(/^6 online$/);
        const nudge = screen.getByTestId('server-hub-unlinked');
        expect(nudge).toHaveTextContent(/^4 not linked yet$/);
        expect(nudge).toHaveAttribute('href', '#characters');
        expect(screen.getByTestId('server-hub-status')).toHaveTextContent('6 online·4 not linked yet');
    });

    it('shows just "6 online" when every online player is linked', () => {
        render(<ServerStatusPill {...ctx({ onlineCount: 6, unlinkedOnlineCount: 0 })} />);
        expect(screen.getByTestId('server-hub-online')).toHaveTextContent(/^6 online$/);
        expect(screen.queryByTestId('server-hub-unlinked')).toBeNull();
    });

    it('shows just "6 online" when the unlinked count is unknown (older payload)', () => {
        render(<ServerStatusPill {...ctx({ onlineCount: 6 })} />);
        expect(screen.getByTestId('server-hub-online')).toHaveTextContent(/^6 online$/);
        expect(screen.queryByTestId('server-hub-unlinked')).toBeNull();
    });

    it('keeps the nudge as plain text on a hub with no Characters tab', () => {
        render(<ServerStatusPill {...ctx({ onlineCount: 3, unlinkedOnlineCount: 2 }, 'minecraft')} />);
        const nudge = screen.getByTestId('server-hub-unlinked');
        expect(nudge).toHaveTextContent(/^2 not linked yet$/);
        expect(nudge.tagName).toBe('SPAN');
        expect(nudge).not.toHaveAttribute('href');
    });
});
