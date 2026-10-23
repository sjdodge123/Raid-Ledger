/** ROK-1924 — the WoW: Forever Dungeon quests hub widget (W5). */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { useQuery } from '@tanstack/react-query';
import type { JSX } from 'react';
import type { GuildEventCardDto, GuildPage, GuildRaidsDto } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { renderWithProviders } from '../../../test/render-helpers';
import {
    ALDRIC_CHARACTER_ID, contentEvent, emptyDatasetReadiness, guildRaidsHandler, questReadinessHandler,
    readinessFixture, type ReadinessReply,
} from '../../../test/handlers/forever-quests';
import { clearRegistry, registerPlugin } from '../../plugin-registry';
import { gameWidgetCells } from '../../../components/hub/hub-widget-cells';
import { WOW_FOREVER_GAME_SLUG } from '../lib/forever-identity';
import { MATRIX_MQ } from './dungeon-quests.helpers';
import { registerDungeonQuestsWidget } from './dungeon-quests.register';
import { DungeonQuestsWidget } from './dungeon-quests-widget';

const SOON = '2099-01-0';

function page(): GuildPage {
    return {
        guild: { id: 7, gameId: 1, kind: 'wow_guild', name: 'Hub', region: 'us', realmSlug: null, realmName: null, faction: null, memberCount: 1, lastSnapshotAt: null, gameSlug: WOW_FOREVER_GAME_SLUG },
        importedBy: null,
        viewer: { role: 'member', canEdit: false, canManageEditors: false },
        ranks: [],
        roleCounts: { tank: 0, healer: 0, dps: 0, unknown: 0 },
    };
}

function useRaids(): ReturnType<typeof useQuery<GuildRaidsDto, Error>> {
    return useQuery<GuildRaidsDto, Error>({
        queryKey: ['raids-harness'],
        queryFn: async () => (await fetch('http://localhost:3000/guilds/7/raids')).json() as Promise<GuildRaidsDto>,
    });
}

function WidgetHarness(): JSX.Element {
    return <DungeonQuestsWidget page={page()} raids={useRaids()} gameSlug={WOW_FOREVER_GAME_SLUG} />;
}

function CellsHarness(): JSX.Element {
    const raids = useRaids();
    const cells = gameWidgetCells({ page: page(), raids }, new Set(['blizzard']));
    return <div>{raids.isSuccess && <span data-testid="raids-ready" />}{cells.map((c) => <div key={c.key}>{c.node}</div>)}</div>;
}

function setWide(wide: boolean): void {
    vi.spyOn(window, 'matchMedia').mockImplementation((query: string): MediaQueryList => ({
        matches: query === MATRIX_MQ ? wide : false, media: query, onchange: null,
        addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(),
        dispatchEvent: () => true,
    }));
}

function serve(events: GuildEventCardDto[], byEvent: Record<number, ReadinessReply>): void {
    server.use(guildRaidsHandler(events), questReadinessHandler(byEvent));
}

beforeEach(() => setWide(true));
afterEach(() => vi.restoreAllMocks());

describe('DungeonQuestsWidget — matrix', () => {
    it('renders a chip per signup × quest with its state', async () => {
        serve([contentEvent(101, `${SOON}1T20:00:00.000Z`)], { 101: readinessFixture });
        renderWithProviders(<WidgetHarness />);
        const table = await screen.findByRole('table');
        expect(within(table).getByTitle('Aldric — Knowledge in the Deeps: Done')).toHaveAttribute('data-tone', 'success');
        expect(within(table).getByTitle('Aldric — Twilight Falls: Have it')).toHaveTextContent('Have');
        expect(within(table).getByTitle('Bryn — Knowledge in the Deeps: Missing')).toHaveAttribute('data-tone', 'warning');
        expect(within(table).getByTitle('Bryn — Twilight Falls: Unknown')).toHaveAttribute('data-tone', 'neutral');
    });

    it('marks an unmet prerequisite only where prereqsMet is false', async () => {
        serve([contentEvent(101, `${SOON}1T20:00:00.000Z`)], { 101: readinessFixture });
        renderWithProviders(<WidgetHarness />);
        await screen.findByRole('table');
        expect(screen.getAllByLabelText('Prerequisites not met')).toHaveLength(1);
    });

    it('links the event, the quest to Forever Wowhead and the signup to its character', async () => {
        serve([contentEvent(101, `${SOON}1T20:00:00.000Z`)], { 101: readinessFixture });
        renderWithProviders(<WidgetHarness />);
        await screen.findByRole('table');
        expect(screen.getByRole('link', { name: /Event 101/ })).toHaveAttribute('href', '/events/101');
        expect(screen.getByRole('link', { name: 'Knowledge in the Deeps' })).toHaveAttribute('href', 'https://www.wowhead.com/forever/quest=909');
        expect(screen.getByRole('link', { name: 'Aldric' })).toHaveAttribute('href', `/characters/${ALDRIC_CHARACTER_ID}`);
        expect(screen.queryByRole('link', { name: 'Bryn' })).toBeNull();
    });
});

describe('DungeonQuestsWidget — phone, empty and errors', () => {
    it('shows a compact per-signup list instead of the matrix on phone', async () => {
        setWide(false);
        serve([contentEvent(101, `${SOON}1T20:00:00.000Z`)], { 101: readinessFixture });
        renderWithProviders(<WidgetHarness />);
        const list = await screen.findByRole('list', { name: 'Event 101 quest readiness' });
        expect(screen.queryByRole('table')).toBeNull();
        expect(within(list).getByTitle('Bryn — Knowledge in the Deeps: Missing')).toBeInTheDocument();
        expect(within(list).getAllByLabelText('Prerequisites not met')).toHaveLength(1);
    });

    it('explains, without an error tone, that quest data arrives after launch', async () => {
        serve([contentEvent(101, `${SOON}1T20:00:00.000Z`)], { 101: emptyDatasetReadiness });
        renderWithProviders(<WidgetHarness />);
        expect(await screen.findByText('Quest data for Forever dungeons arrives after launch')).toBeInTheDocument();
        expect(screen.queryByRole('alert')).toBeNull();
        expect(screen.queryByRole('table')).toBeNull();
    });

    it('shows a quiet "not available" line for a 403 or 404 event and still renders the others', async () => {
        serve([
            contentEvent(101, `${SOON}1T20:00:00.000Z`), contentEvent(102, `${SOON}2T20:00:00.000Z`), contentEvent(103, `${SOON}3T20:00:00.000Z`),
        ], { 101: 403, 102: 404, 103: readinessFixture });
        renderWithProviders(<WidgetHarness />);
        expect(await screen.findAllByText('Quest readiness is not available for this event.')).toHaveLength(2);
        expect(await screen.findByRole('table')).toBeInTheDocument();
    });

    it('shows only the next 3 events that have content, soonest first', async () => {
        serve([
            contentEvent(104, `${SOON}4T20:00:00.000Z`), contentEvent(102, `${SOON}2T20:00:00.000Z`),
            { ...contentEvent(100, `${SOON}1T10:00:00.000Z`), contentInstances: [] },
            contentEvent(103, `${SOON}3T20:00:00.000Z`), contentEvent(101, `${SOON}1T20:00:00.000Z`),
        ], { 101: emptyDatasetReadiness, 102: emptyDatasetReadiness, 103: emptyDatasetReadiness, 104: emptyDatasetReadiness });
        renderWithProviders(<WidgetHarness />);
        await screen.findAllByText('Quest data for Forever dungeons arrives after launch');
        const names = screen.getAllByRole('link', { name: /^Event \d+/ }).map((a) => a.getAttribute('href'));
        expect(names).toEqual(['/events/101', '/events/102', '/events/103']);
    });
});

describe('Dungeon quests registration', () => {
    beforeEach(() => {
        clearRegistry();
        registerDungeonQuestsWidget(registerPlugin('blizzard', { icon: '/x.png', color: 'blue', label: 'WoW' }));
    });

    it('hides itself when no upcoming guild event has content', async () => {
        server.use(guildRaidsHandler([{ ...contentEvent(101, `${SOON}1T20:00:00.000Z`), contentInstances: [] }]));
        renderWithProviders(<CellsHarness />);
        await screen.findByTestId('raids-ready');
        expect(screen.queryByRole('heading', { name: 'Dungeon quests' })).toBeNull();
    });

    it('shows on a Forever guild hub when an upcoming event has content', async () => {
        serve([contentEvent(101, `${SOON}1T20:00:00.000Z`)], { 101: readinessFixture });
        renderWithProviders(<CellsHarness />);
        expect(await screen.findByRole('heading', { name: 'Dungeon quests' })).toBeInTheDocument();
    });
});
