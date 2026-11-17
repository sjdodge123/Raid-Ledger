/** ROK-2212 — the WoW: Forever "Suggested groups" hub widget (W1–W7), rendered through `gameWidgetCells`. */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useQuery } from '@tanstack/react-query';
import type { JSX } from 'react';
import type { GuildPage, GuildRaidsDto, SuggestedGroupsDto } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { renderWithProviders } from '../../../test/render-helpers';
import { clearRegistry, registerPlugin } from '../../plugin-registry';
import { gameWidgetCells } from '../../../components/hub/hub-widget-cells';
import { WOW_FOREVER_GAME_SLUG } from '../lib/forever-identity';
import { SuggestedGroupCard } from '../hub/suggested-groups/suggested-group-card';
import {
    group, SG_UUID_DPS, SG_UUID_HEAL, SG_UUID_TANK, SUGGESTED_GROUPS_FIXTURE, suggestedGroupsHandler, visitorFixture,
} from '../hub/suggested-groups/suggested-groups.fixtures';
import { useSuggestedGroups } from '../hub/suggested-groups/use-suggested-groups';
import { suggestedGroupsWidget } from './suggested-groups.register';

const auth = vi.hoisted(() => ({ role: 'member' as string }));

vi.mock('../../../hooks/use-auth', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../hooks/use-auth')>()),
    useAuth: () => ({ user: { id: 1, role: auth.role }, isAuthenticated: true }),
    useViewerCacheScope: () => `user:1:${auth.role}`,
}));

type ViewerRole = GuildPage['viewer']['role'];

function page(role: ViewerRole = 'member'): GuildPage {
    return {
        guild: { id: 7, gameId: 3, kind: 'wow_guild', name: 'Hub', region: 'us', realmSlug: null, realmName: null, faction: null, memberCount: 5, lastSnapshotAt: null, gameSlug: WOW_FOREVER_GAME_SLUG },
        importedBy: null,
        viewer: { role, canEdit: false, canManageEditors: false },
        ranks: [],
        roleCounts: { tank: 0, healer: 0, dps: 0, unknown: 0 },
    };
}

function Overview({ role }: { role: ViewerRole }): JSX.Element {
    const raids = useQuery<GuildRaidsDto, Error>({ queryKey: ['sg-raids'], queryFn: () => new Promise(() => undefined), enabled: false });
    const groups = useSuggestedGroups(7);
    const cells = gameWidgetCells({ page: page(role), raids }, new Set(['blizzard']));
    return <div>{groups.isSuccess && <span data-testid="sg-ready" />}{cells.map((c) => <div key={c.key}>{c.node}</div>)}</div>;
}

async function renderAs(role: ViewerRole, body: SuggestedGroupsDto, userRole = 'member'): Promise<void> {
    auth.role = userRole;
    server.use(suggestedGroupsHandler(body));
    renderWithProviders(<Overview role={role} />);
}

beforeEach(() => {
    clearRegistry();
    registerPlugin('blizzard', { icon: '/x.png', color: 'blue', label: 'WoW' }).registerHubWidget(suggestedGroupsWidget);
});

describe('Suggested groups widget', () => {
    it('W1: renders one card per top group, with a See all jump to the planner tab', async () => {
        await renderAs('member', SUGGESTED_GROUPS_FIXTURE);
        expect(await screen.findAllByTestId('suggested-group-card')).toHaveLength(3);
        expect(screen.getByRole('heading', { name: 'Suggested groups' })).toBeInTheDocument();
        expect(screen.getByTestId('forever-see-all-suggested-groups')).toHaveAttribute('href', '#dungeon-planner');
        const sfk = screen.getByRole('article', { name: 'Shadowfang Keep group' });
        expect(within(sfk).getAllByTestId('suggested-group-member')).toHaveLength(5);
        expect(within(sfk).getAllByText('Unclaimed')).toHaveLength(2);
        expect(within(sfk).getByText('Levels 21–25 · 2 shared quests')).toBeInTheDocument();
    });

    it('W2: Schedule invites only the claimed members and says "Invites 3 of 5"', async () => {
        await renderAs('member', SUGGESTED_GROUPS_FIXTURE);
        const sfk = await screen.findByRole('article', { name: 'Shadowfang Keep group' });
        expect(within(sfk).getByRole('link', { name: 'Schedule Shadowfang Keep, invites 3 of 5' }))
            .toHaveAttribute('href', `/events/new?gameId=3&guildId=7&contentInstanceIds=101&inviteCharacterIds=${SG_UUID_TANK},${SG_UUID_HEAL},${SG_UUID_DPS}`);
        expect(within(sfk).getByTestId('suggested-group-invites')).toHaveTextContent('Invites 3 of 5');
    });

    it('W3: Open in planner carries the dungeon and all 5 tokens incl. unclaimed', async () => {
        await renderAs('member', SUGGESTED_GROUPS_FIXTURE);
        const sfk = await screen.findByRole('article', { name: 'Shadowfang Keep group' });
        expect(within(sfk).getByRole('link', { name: 'Open in planner: Shadowfang Keep group' }))
            .toHaveAttribute('href', `/hubs/7?d=101&c=${SG_UUID_TANK},${SG_UUID_HEAL},${SG_UUID_DPS},m41,m42#dungeon-planner`);
    });

    it('W5: a visitor sees the cards and Open in planner, but no Schedule or Poll', async () => {
        await renderAs('visitor', visitorFixture());
        const sfk = await screen.findByRole('article', { name: 'Shadowfang Keep group' });
        expect(within(sfk).queryByRole('link', { name: /^Schedule/ })).toBeNull();
        expect(within(sfk).queryByRole('button', { name: /^Poll/ })).toBeNull();
        expect(within(sfk).getByRole('link', { name: 'Open in planner: Shadowfang Keep group' })).toBeInTheDocument();
    });

    it('W5b: non-member staff (operator) on a visitor page still get Schedule', async () => {
        await renderAs('visitor', visitorFixture(), 'operator');
        const sfk = await screen.findByRole('article', { name: 'Shadowfang Keep group' });
        expect(within(sfk).getByRole('link', { name: /^Schedule Shadowfang Keep/ })).toBeInTheDocument();
    });

    it('W6: hidden when there are no groups', async () => {
        await renderAs('member', { ...SUGGESTED_GROUPS_FIXTURE, groups: [] });
        await screen.findByTestId('sg-ready');
        expect(screen.queryByRole('heading', { name: 'Suggested groups' })).toBeNull();
        expect(screen.queryByTestId('suggested-group-card')).toBeNull();
    });

    it('W7: the footnote counts the pool, unclaimed rows and who was left out', async () => {
        await renderAs('member', SUGGESTED_GROUPS_FIXTURE);
        expect(await screen.findByTestId('suggested-groups-footnote'))
            .toHaveTextContent('From 2 tanks, 3 healers and 9 DPS (4 unclaimed). Left out: 1 with no role, 2 with no level.');
    });
});

describe('SuggestedGroupCard — Poll seam (W4)', () => {
    it('Poll calls onPoll with the group; omitted onPoll = no Poll button', async () => {
        const onPoll = vi.fn();
        const g = group(101, 'Shadowfang Keep');
        const { unmount } = renderWithProviders(<SuggestedGroupCard group={g} page={page()} canAct onPoll={onPoll} />);
        await userEvent.click(screen.getByRole('button', { name: 'Poll Shadowfang Keep group' }));
        expect(onPoll).toHaveBeenCalledWith(g);
        unmount();
        renderWithProviders(<SuggestedGroupCard group={g} page={page()} canAct />);
        expect(screen.queryByRole('button', { name: /^Poll/ })).toBeNull();
    });
});
