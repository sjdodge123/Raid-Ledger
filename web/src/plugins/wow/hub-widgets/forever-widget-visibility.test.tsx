/**
 * ROK-1905 (Q2 rulings) — who sees the members-only Forever widgets on a guild
 * hub Overview: a visitor, a member, and staff (operator/admin) who are not in
 * the guild. Guild professions (ROK-1923) and Dungeon quests (ROK-1924) both
 * and Who's saved (ROK-1914) register `audience: 'everyone'` and gate in `useVisible`, so non-member staff
 * see them as the API allows. Renders through `gameWidgetCells`, the real
 * Overview gating path.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { useQuery } from '@tanstack/react-query';
import type { JSX } from 'react';
import { GuildRaidsSchema, type GuildPage, type GuildRaidsDto, type WowRosterInsightsDto } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { renderWithProviders } from '../../../test/render-helpers';
import {
    PROFESSIONS_FIXTURE, ROLES_FIXTURE, VISITOR_FIXTURE, contentEvent, createEmptyRosterInsights, createMockRosterInsights, guildRaidsHandler, questReadinessHandler, readinessFixture,
    rosterInsightsHandler,
} from '../../../test/handlers/forever-hub-widgets';
import { fetchApi } from '../../../lib/api-client';
import { clearRegistry, registerPlugin } from '../../plugin-registry';
import { gameWidgetCells } from '../../../components/hub/hub-widget-cells';
import { WOW_FOREVER_GAME_SLUG } from '../lib/forever-identity';
import { registerDungeonQuestsWidget } from './dungeon-quests.register';
import { registerClassLevelWidgets } from './class-level.register';
import { registerRolesWidget } from './roles.register';
import { professionsWidget } from './professions.register';
import { whosSavedWidget } from './whos-saved.register';
import { useRosterInsights } from './use-roster-insights';

const auth = vi.hoisted(() => ({ role: 'member' as string }));

vi.mock('../../../hooks/use-auth', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../hooks/use-auth')>()),
    useAuth: () => ({ user: { id: 1, role: auth.role }, isAuthenticated: true }),
    useViewerCacheScope: () => `user:1:${auth.role}`,
}));

type ViewerRole = GuildPage['viewer']['role'];

type HubKind = GuildPage['guild']['kind'];

function page(role: ViewerRole, kind: HubKind = 'wow_guild'): GuildPage {
    return {
        guild: { id: 7, gameId: 1, kind, name: 'Hub', region: 'us', realmSlug: null, realmName: null, faction: null, memberCount: 5, lastSnapshotAt: null, gameSlug: WOW_FOREVER_GAME_SLUG },
        importedBy: null,
        viewer: { role, canEdit: false, canManageEditors: false },
        ranks: [],
        roleCounts: { tank: 0, healer: 0, dps: 0, unknown: 0 },
    };
}

/** The Overview cells plus a marker once both queries the probes read have settled. */
function Overview({ role, kind }: { role: ViewerRole; kind: HubKind }): JSX.Element {
    const raids = useQuery<GuildRaidsDto, Error>({
        queryKey: ['visibility-raids'],
        queryFn: () => fetchApi('/guilds/7/raids', {}, GuildRaidsSchema),
    });
    const insights = useRosterInsights(7);
    const cells = gameWidgetCells({ page: page(role, kind), raids }, new Set(['blizzard']));
    return (
        <div>
            {raids.isSuccess && insights.isSuccess && <span data-testid="queries-ready" />}
            {cells.map((c) => <div key={c.key}>{c.node}</div>)}
        </div>
    );
}

/** One viewer: their user role, their guild role, and the roster payload the API sends them. */
async function renderAs(userRole: string, guildRole: ViewerRole, insights: WowRosterInsightsDto, kind: HubKind = 'wow_guild'): Promise<void> {
    auth.role = userRole;
    server.use(
        rosterInsightsHandler({ all: insights }),
        guildRaidsHandler([contentEvent(101, '2099-01-01T20:00:00.000Z')]),
        questReadinessHandler({ 101: readinessFixture }),
    );
    renderWithProviders(<Overview role={guildRole} kind={kind} />);
    await screen.findByTestId('queries-ready');
}

beforeEach(() => {
    clearRegistry();
    const blizzard = registerPlugin('blizzard', { icon: '/x.png', color: 'blue', label: 'WoW' });
    blizzard.registerHubWidget(professionsWidget);
    blizzard.registerHubWidget(whosSavedWidget);
    registerDungeonQuestsWidget(blizzard);
});

describe('Forever members-only widgets — visibility by viewer', () => {
    it('a visitor sees neither Guild professions nor Dungeon quests', async () => {
        await renderAs('member', 'visitor', VISITOR_FIXTURE);
        expect(screen.queryByRole('heading', { name: 'Guild professions' })).toBeNull();
        expect(screen.queryByRole('heading', { name: 'Dungeon quests' })).toBeNull();
        expect(screen.queryByRole('heading', { name: "Who's saved" })).toBeNull();
    });

    it('a guild member sees both, and Who\'s saved', async () => {
        await renderAs('member', 'member', PROFESSIONS_FIXTURE);
        expect(await screen.findByRole('heading', { name: 'Guild professions' })).toBeInTheDocument();
        expect(await screen.findByRole('heading', { name: 'Dungeon quests' })).toBeInTheDocument();
        expect(await screen.findByRole('heading', { name: "Who's saved" })).toBeInTheDocument();
    });

    it('an admin who is not in the guild sees both, and Who\'s saved (the API lets staff in)', async () => {
        await renderAs('admin', 'visitor', PROFESSIONS_FIXTURE);
        expect(await screen.findByRole('heading', { name: 'Guild professions' })).toBeInTheDocument();
        expect(await screen.findByRole('heading', { name: 'Dungeon quests' })).toBeInTheDocument();
        expect(await screen.findByRole('heading', { name: "Who's saved" })).toBeInTheDocument();
    });

    it('an operator who is not in the guild sees Dungeon quests', async () => {
        await renderAs('operator', 'visitor', PROFESSIONS_FIXTURE);
        expect(await screen.findByRole('heading', { name: 'Dungeon quests' })).toBeInTheDocument();
    });
});

describe('Forever class / level / role widgets on a community hub (ROK-1925)', () => {
    const MEMBER_PAYLOAD: WowRosterInsightsDto = createMockRosterInsights({ roles: ROLES_FIXTURE.roles });

    beforeEach(() => {
        const blizzard = registerPlugin('blizzard', { icon: '/x.png', color: 'blue', label: 'WoW' });
        registerClassLevelWidgets(blizzard);
        registerRolesWidget(blizzard);
    });

    it('a member of a Forever community hub sees Class breakdown, Level progression and Role breakdown', async () => {
        await renderAs('member', 'member', MEMBER_PAYLOAD, 'game_community');
        expect(await screen.findByRole('heading', { name: 'Class breakdown' })).toBeInTheDocument();
        expect(await screen.findByRole('heading', { name: 'Level progression' })).toBeInTheDocument();
        expect(await screen.findByRole('heading', { name: 'Role breakdown' })).toBeInTheDocument();
    });

    it('a visitor (the API sends an empty payload) sees none of the three', async () => {
        await renderAs('member', 'visitor', createEmptyRosterInsights(), 'game_community');
        expect(screen.queryByRole('heading', { name: 'Class breakdown' })).toBeNull();
        expect(screen.queryByRole('heading', { name: 'Level progression' })).toBeNull();
        expect(screen.queryByRole('heading', { name: 'Role breakdown' })).toBeNull();
    });
});
