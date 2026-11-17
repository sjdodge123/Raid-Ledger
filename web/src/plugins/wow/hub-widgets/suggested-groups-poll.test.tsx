/**
 * ROK-2212 W4 — Poll on a suggested group opens the scheduling poll locked to
 * the hub's game, tagged to the guild hub (F1 ruling) and pre-filled with ONLY
 * the group's claimed players (unclaimed rows have no user, F2).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useQuery } from '@tanstack/react-query';
import type { JSX } from 'react';
import type { GuildPage, GuildRaidsDto } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { renderWithProviders } from '../../../test/render-helpers';
import { WOW_FOREVER_GAME_SLUG } from '../lib/forever-identity';
import { suggestedGroupsHandler } from '../hub/suggested-groups/suggested-groups.fixtures';
import { SuggestedGroupsWidget } from './suggested-groups-widget';

vi.mock('../../../hooks/use-standalone-poll', () => ({ useCreateSchedulingPoll: vi.fn() }));
vi.mock('../../../hooks/use-auth', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../hooks/use-auth')>()),
    useAuth: () => ({ user: { id: 1, role: 'member' }, isAuthenticated: true }),
    useViewerCacheScope: () => 'user:1:member',
}));

import { useCreateSchedulingPoll } from '../../../hooks/use-standalone-poll';

const mutateAsync = vi.fn();

const PAGE: GuildPage = {
    guild: { id: 7, gameId: 3, kind: 'wow_guild', name: 'Ironforge Irregulars', region: 'us', realmSlug: null, realmName: null, faction: null, memberCount: 5, lastSnapshotAt: null, gameSlug: WOW_FOREVER_GAME_SLUG },
    importedBy: null,
    viewer: { role: 'member', canEdit: false, canManageEditors: false },
    ranks: [],
    roleCounts: { tank: 0, healer: 0, dps: 0, unknown: 0 },
};

/** The widget with an idle raids query (it never reads raids). */
function Host({ page }: { page: GuildPage }): JSX.Element {
    const raids = useQuery<GuildRaidsDto, Error>({ queryKey: ['sg-poll-raids'], queryFn: () => new Promise(() => undefined), enabled: false });
    return <SuggestedGroupsWidget page={page} raids={raids} gameSlug={WOW_FOREVER_GAME_SLUG} />;
}

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useCreateSchedulingPoll).mockReturnValue({
        mutateAsync, isPending: false, isError: false, error: null,
    } as unknown as ReturnType<typeof useCreateSchedulingPoll>);
    mutateAsync.mockResolvedValue({ id: 1, lineupId: 2, visibility: 'public', shareToken: null });
});

describe('Suggested groups widget — Poll (W4)', () => {
    it('opens the poll tagged to the guild hub with only the claimed players picked', async () => {
        server.use(suggestedGroupsHandler());
        const user = userEvent.setup();
        renderWithProviders(<Host page={PAGE} />);
        const sfk = await screen.findByRole('article', { name: 'Shadowfang Keep group' });
        await user.click(within(sfk).getByRole('button', { name: 'Poll Shadowfang Keep group' }));
        expect(await screen.findByTestId('create-poll-hub-line')).toHaveTextContent('Tagged to Ironforge Irregulars');
        await waitFor(() => expect(screen.getByTestId('member-picker'), 'the 3 claimed players are picked, the 2 unclaimed rows are not')
            .toHaveTextContent('3 members selected'));
        await user.click(screen.getByRole('button', { name: /create poll/i }));
        expect(mutateAsync.mock.calls[0]?.[0]).toMatchObject({ gameId: 3, hubId: 7, memberUserIds: [1, 2, 3] });
    });

    it('shows no Poll button to a visitor who cannot start one', async () => {
        server.use(suggestedGroupsHandler());
        renderWithProviders(<Host page={{ ...PAGE, viewer: { ...PAGE.viewer, role: 'visitor' } }} />);
        await screen.findAllByTestId('suggested-group-card');
        expect(screen.queryByRole('button', { name: /^Poll/ })).toBeNull();
    });
});
