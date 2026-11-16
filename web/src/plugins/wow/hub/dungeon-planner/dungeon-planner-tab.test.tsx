/**
 * ROK-2216 U6 — the Dungeon planner tab over MSW: only claimed ids reach the
 * plan API, only the plan's quests render, "n/a" for a quest a character can't
 * take, faction-note wording, dropped chips, invite count and the Wowhead link.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import { server } from '../../../../test/mocks/server';
import { renderWithProviders } from '../../../../test/render-helpers';
import { createMockRosterInsights, rosterInsightsHandler } from '../../../../test/handlers/forever-hub-widgets';
import DungeonPlannerTab from './dungeon-planner-tab';
import { INSTANCE, PAGE, makePlan, plannerHandlers } from './dungeon-planner-tab.fixtures';
import { ROSTER, UUID_A, UUID_B } from './planner-roster.fixtures';

vi.mock('../../../../hooks/use-media-query', () => ({ useMediaQuery: () => true }));
vi.mock('../../../../hooks/use-auth', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../../hooks/use-auth')>()),
    useAuth: () => ({ user: { id: 1, role: 'member' }, isAuthenticated: true }),
}));

const URL_WITH_PLAN = `/hubs/7?d=${INSTANCE.id}&c=${UUID_A},${UUID_B},m12#dungeon-planner`;
const hosts: string[] = [];
const onStart = ({ request }: { request: Request }): void => { hosts.push(new URL(request.url).host); };

function renderTab(handlers = plannerHandlers()): void {
    server.use(rosterInsightsHandler({ all: createMockRosterInsights({ classes: ROSTER.classes }) }), ...handlers);
    server.events.on('request:start', onStart);
    renderWithProviders(<DungeonPlannerTab page={PAGE} />, { initialEntries: [URL_WITH_PLAN] });
}

afterEach(() => {
    server.events.removeListener('request:start', onStart);
    hosts.length = 0;
});

describe('DungeonPlannerTab', () => {
    it('sends only the claimed picks to the plan API, in pick order', async () => {
        const seen: URL[] = [];
        renderTab(plannerHandlers({ onPlan: (u) => seen.push(u) }));
        await screen.findByText('Red Silk Bandanas ↗');
        expect(seen.map((u) => u.searchParams.get('characterIds'))).toContain(`${UUID_A},${UUID_B}`);
        expect(seen.every((u) => !(u.searchParams.get('characterIds') ?? '').includes('m12'))).toBe(true);
    });

    it('renders only the plan\'s quests and "n/a" where a character can\'t take one', async () => {
        renderTab();
        await screen.findByText('Red Silk Bandanas ↗');
        expect(screen.queryByText('Horde Only Quest ↗')).toBeNull();
        const row = screen.getByTestId('planner-quest-502');
        expect(within(row).getByTitle("Blinky can't take this quest")).toHaveTextContent('n/a');
        expect(within(row).getByText('Missing')).toBeInTheDocument();
    });

    it('words the faction note by where the side came from', async () => {
        renderTab();
        expect(await screen.findByText('1 Horde quest hidden — this is an Alliance guild.')).toBeInTheDocument();
    });

    it('words the faction note for a side taken from the characters', async () => {
        renderTab(plannerHandlers({ plan: makePlan({ sideSource: 'characters', hiddenOtherFaction: 2 }) }));
        expect(await screen.findByText("2 Horde quests hidden for this group's faction.")).toBeInTheDocument();
    });

    it('greys a dropped pick, keeps the unclaimed one, and counts invites from the characters the API kept', async () => {
        const plan = makePlan({ characters: makePlan().characters.slice(0, 1), droppedCharacterIds: [UUID_B] });
        renderTab(plannerHandlers({ plan }));
        expect(await screen.findByText(/no longer on the roster/)).toBeInTheDocument();
        expect(screen.getByText(/Lv18 · no quest data/)).toBeInTheDocument();
        const invite = screen.getByRole('link', { name: 'Create event & invite these 1' });
        expect(invite).toHaveAttribute('href', `/events/new?gameId=3&guildId=7&contentInstanceIds=101&inviteCharacterIds=${UUID_A}`);
        expect(screen.getByRole('link', { name: 'Create event ▸' })).toHaveAttribute('href', '/events/new?gameId=3&guildId=7&contentInstanceIds=101');
    });

    it('has no Wowhead link or unverified hint for an in-game row without a zone id, and never calls Wowhead', async () => {
        renderTab();
        await screen.findByText('Red Silk Bandanas ↗');
        expect(screen.queryByRole('link', { name: 'Wowhead ↗' })).toBeNull();
        expect(screen.queryByText('levels unverified')).toBeNull();
        expect(hosts.filter((h) => h.includes('wowhead'))).toEqual([]);
    });

    it('links the zone on Wowhead and shows the unverified hint for a non-in-game range', async () => {
        renderTab(plannerHandlers({ instance: { ...INSTANCE, wowheadZoneId: 1581, levelSource: 'community' } }));
        const link = await screen.findByRole('link', { name: 'Wowhead ↗' });
        expect(link.getAttribute('href')).toMatch(/wowhead\.com\/forever\/zone=1581$/);
        expect(screen.getAllByText('levels unverified').length).toBeGreaterThan(0);
    });
});
