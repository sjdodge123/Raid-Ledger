/**
 * ROK-1831 fix r1b — a visitor gets no member rows from the server, so the
 * Members tab invites a Join instead of saying nobody has played.
 */
import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import type { GuildPage } from '@raid-ledger/contract';
import { renderWithProviders } from '../../../test/render-helpers';
import type { HubCtx } from '../../hub-module';
import { HubMembers } from '../../../components/hub/hub-members';
import { pelicanHubModule, SERVER_MEMBERS_VISITOR_EMPTY } from './register-hub';

/** Never read by the Members tab — spelled out rather than cast (settings-sheet.test idiom). */
const IDLE_RAIDS: HubCtx['raids'] = {
    data: undefined, error: null, isPending: true, isLoading: true, isLoadingError: false,
    isRefetchError: false, isSuccess: false, isError: false, isFetched: false,
    isFetchedAfterMount: false, isFetching: false, isInitialLoading: true, isPaused: false,
    isPlaceholderData: false, isRefetching: false, isStale: false, isEnabled: true,
    status: 'pending', fetchStatus: 'fetching', dataUpdatedAt: 0, errorUpdatedAt: 0,
    failureCount: 0, failureReason: null, errorUpdateCount: 0,
    refetch: () => Promise.reject(new Error('not used')),
};

function ctx(joined: boolean): HubCtx {
    const page: GuildPage = {
        guild: { id: 9, gameId: 3, kind: 'game_server', name: 'Valheim — Main', region: 'server', realmSlug: null, realmName: null, faction: null, memberCount: 5, lastSnapshotAt: null },
        importedBy: null,
        viewer: { role: joined ? 'member' : 'visitor', canEdit: false, canManageEditors: false },
        ranks: [],
        roleCounts: { tank: 0, healer: 0, dps: 0, unknown: 0 },
        server: { pelicanServerId: 4, gameSlug: 'valheim', gameIconUrl: null, state: 'running', viewerJoined: joined },
    };
    return { page, raids: IDLE_RAIDS };
}

describe('server hub Members empty state (ROK-1831)', () => {
    it('tells a visitor to join to see who plays here', () => {
        renderWithProviders(<HubMembers ctx={ctx(false)} module={pelicanHubModule} />);
        expect(screen.getByTestId('guild-members-empty')).toHaveTextContent(SERVER_MEMBERS_VISITOR_EMPTY);
        expect(SERVER_MEMBERS_VISITOR_EMPTY).toBe('Join to see who plays here');
    });

    it('keeps "No one has played here yet." for a joined viewer with no rows', () => {
        renderWithProviders(<HubMembers ctx={ctx(true)} module={pelicanHubModule} />);
        expect(screen.getByTestId('guild-members-empty')).toHaveTextContent('No one has played here yet.');
    });
});
