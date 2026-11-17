/**
 * ROK-2216 U6 — the Dungeon planner tab over MSW: only claimed ids reach the
 * plan API, only the plan's quests render, "n/a" for a quest a character can't
 * take, faction-note wording, dropped chips, invite count and the Wowhead link.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../../../../test/mocks/server';
import { renderWithProviders } from '../../../../test/render-helpers';
import { createMockRosterInsights, ROSTER_INSIGHTS_URL, rosterInsightsHandler } from '../../../../test/handlers/forever-hub-widgets';
import DungeonPlannerTab from './dungeon-planner-tab';
import { INSTANCE, PAGE, makePlan, plannerHandlers } from './dungeon-planner-tab.fixtures';
import { ROSTER, UUID_A, UUID_B } from './planner-roster.fixtures';
import { claimed, group, suggestedGroupsHandler, SUGGESTED_GROUPS_FIXTURE, unclaimed } from '../suggested-groups/suggested-groups.fixtures';

const media = vi.hoisted(() => ({ desktop: true }));
vi.mock('../../../../hooks/use-media-query', () => ({ useMediaQuery: () => media.desktop }));
vi.mock('../../../../hooks/use-auth', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../../hooks/use-auth')>()),
    useAuth: () => ({ user: { id: 1, role: 'member' }, isAuthenticated: true }),
}));

const URL_WITH_PLAN = `/hubs/7?d=${INSTANCE.id}&c=${UUID_A},${UUID_B},m12#dungeon-planner`;
const hosts: string[] = [];
const onStart = ({ request }: { request: Request }): void => { hosts.push(new URL(request.url).host); };

function renderTab(handlers = plannerHandlers(), entry = URL_WITH_PLAN): void {
    server.use(rosterInsightsHandler({ all: createMockRosterInsights({ classes: ROSTER.classes }) }), ...handlers);
    server.events.on('request:start', onStart);
    renderWithProviders(<DungeonPlannerTab page={PAGE} />, { initialEntries: [entry] });
}

afterEach(() => {
    server.events.removeListener('request:start', onStart);
    hosts.length = 0;
    media.desktop = true;
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
        expect(screen.getByText(/Shareable \(1\)/)).toBeInTheDocument();
        expect(screen.queryByText(/Sharable/)).toBeNull();
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
        expect(await screen.findByText(/· no longer on the roster/)).toBeInTheDocument();
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

describe('DungeonPlannerTab — invites and prerequisites', () => {
    it('names dropped picks as off the roster and unclaimed ones as unlinked', async () => {
        const plan = makePlan({ characters: makePlan().characters.slice(0, 1), droppedCharacterIds: [UUID_B] });
        renderTab(plannerHandlers({ plan }));
        expect(await screen.findByText('Blinky is no longer on the roster — not invited.')).toBeInTheDocument();
        expect(screen.getByText('Alt has no linked character — not invited.')).toBeInTheDocument();
    });

    it('marks an unmet prerequisite with "!" on that character only (AC5)', async () => {
        renderTab();
        const row = await screen.findByTestId('planner-quest-502');
        expect(within(row).getAllByRole('img', { name: 'Prerequisites not met' })).toHaveLength(1);
        expect(within(row).getByText('! Tanky: prerequisites not met')).toBeInTheDocument();
        expect(within(screen.getByTestId('planner-quest-501')).queryByRole('img', { name: 'Prerequisites not met' })).toBeNull();
    });
});

describe('DungeonPlannerTab — Create event, quest errors, Copy link and the phone bar', () => {
    it('disables both Create-event buttons until a dungeon is picked (AC8)', async () => {
        renderTab(plannerHandlers(), `/hubs/7?c=${UUID_A}#dungeon-planner`);
        await screen.findByTestId(`planner-chip-${UUID_A}`);
        expect(screen.getByRole('button', { name: 'Create event ▸' })).toBeDisabled();
        expect(screen.getByRole('button', { name: /Create event & invite these/ })).toBeDisabled();
    });

    it('disables the invite button when no picked character has quest data (AC8)', async () => {
        renderTab(plannerHandlers({ plan: makePlan({ characters: [] }) }));
        expect(await screen.findByRole('button', { name: 'Create event & invite these 0' })).toBeDisabled();
        expect(screen.getByRole('link', { name: 'Create event ▸' })).toBeEnabled();
    });

    it('shows an error, not "Loading quests…", when the quest list fails', async () => {
        renderTab(plannerHandlers({ questsError: true }));
        expect(await screen.findByText("Couldn't load this dungeon's quests. Reload to try again.")).toBeInTheDocument();
        expect(screen.queryByText('Loading quests…')).toBeNull();
    });

    it('copies the link with every picked token while the roster is unavailable', async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
        renderTab([...plannerHandlers(), http.get(ROSTER_INSIGHTS_URL, () => HttpResponse.json({ message: 'x' }, { status: 500 }))]);
        fireEvent.click(await screen.findByRole('button', { name: 'Copy link' }));
        await waitFor(() => expect(writeText).toHaveBeenCalled());
        expect(writeText.mock.calls[0]?.[0]).toMatch(new RegExp(`/hubs/7\\?d=101&c=${UUID_A},${UUID_B},m12#dungeon-planner$`));
    });

    it('docks the phone Create-event bar above the bottom tab bar', async () => {
        media.desktop = false;
        renderTab();
        const bar = await screen.findByTestId('planner-mobile-actions');
        expect(bar.className).toContain('bottom-[var(--bottom-nav-clearance)]');
        expect(bar.className).toContain('md:bottom-0');
    });

    it('stops the phone Create-event bar where the planner ends, above Suggested groups', async () => {
        media.desktop = false;
        renderTab();
        const bar = await screen.findByTestId('planner-mobile-actions');
        const groups = await screen.findByTestId('suggested-groups-section');
        expect(bar.className).toContain('z-10');
        expect(bar.parentElement?.contains(groups), 'groups sit outside the bar\'s sticky containing block').toBe(false);
        expect(bar.compareDocumentPosition(groups) & Node.DOCUMENT_POSITION_FOLLOWING, 'groups follow the bar').toBeTruthy();
    });

    it('ROK-2212: Open in planner on a suggested group loads its dungeon and picks in place', async () => {
        const g = group(INSTANCE.id, INSTANCE.name, { members: [
            claimed(UUID_A, 'Tanky', 'tank', 20, 1), claimed(UUID_B, 'Blinky', 'healer', 12, 2),
            unclaimed(12, 'Lurky', 'dps', 18), unclaimed(98, 'Gone', 'dps', 18), unclaimed(99, 'Away', 'dps', 18),
        ] });
        server.use(suggestedGroupsHandler({ ...SUGGESTED_GROUPS_FIXTURE, groups: [g] }));
        renderTab(plannerHandlers(), '/hubs/7#dungeon-planner');
        const card = await screen.findByRole('article', { name: `${INSTANCE.name} group` });
        expect(screen.queryByTestId(`planner-chip-${UUID_A}`), 'nothing picked before').toBeNull();
        fireEvent.click(within(card).getByRole('button', { name: `Open in planner: ${INSTANCE.name} group` }));
        for (const key of [UUID_A, UUID_B, 'm12']) expect(await screen.findByTestId(`planner-chip-${key}`), `chip ${key} loaded`).toBeInTheDocument();
        expect(await screen.findByRole('link', { name: 'Create event ▸' }), 'the group\'s dungeon is picked')
            .toHaveAttribute('href', '/events/new?gameId=3&guildId=7&contentInstanceIds=101');
    });
});
