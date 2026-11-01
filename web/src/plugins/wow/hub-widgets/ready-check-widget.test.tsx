/** ROK-1926 — the WoW: Forever "Ready for next run" hub widget (W11 ★). */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useQuery } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import type { JSX } from 'react';
import { GuildRaidsSchema, type EventRaidReadiness, type GuildPage, type GuildRaidsDto } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { renderWithProviders } from '../../../test/render-helpers';
import { ALDRIC_CHARACTER_ID, contentEvent, guildRaidsHandler } from '../../../test/handlers/forever-hub-widgets';
import { clearRegistry, registerPlugin } from '../../plugin-registry';
import { gameWidgetCells } from '../../../components/hub/hub-widget-cells';
import { WOW_FOREVER_GAME_SLUG } from '../lib/forever-identity';
import { MATRIX_MQ } from './dungeon-quests.helpers';
import { registerReadyCheckWidget } from './ready-check.register';
import { ReadyCheckWidget } from './ready-check-widget';
import { requirementsLine, rowCells, sortSignups, summaryCounts, type ReadySignup } from './ready-check.helpers';

const auth = vi.hoisted((): { role: string } => ({ role: 'member' }));

vi.mock('../../../hooks/use-auth', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../hooks/use-auth')>()),
    useAuth: () => ({ user: { id: 1, role: auth.role }, isAuthenticated: true }),
    useViewerCacheScope: () => `user:1:${auth.role}`,
}));

const READINESS_URL = 'http://localhost:3000/plugins/wow-classic/events/:eventId/raid-readiness';
const START = '2099-01-03T20:00:00.000Z';
const RESET = '2099-01-06T15:00:00.000Z';
const MC = [{ id: 409, name: 'Molten Core' }];

type Viewer = GuildPage['viewer']['role'];

function page(role: Viewer = 'member'): GuildPage {
    return {
        guild: { id: 7, gameId: 1, kind: 'wow_guild', name: 'Hub', region: 'us', realmSlug: null, realmName: null, faction: null, memberCount: 1, lastSnapshotAt: null, gameSlug: WOW_FOREVER_GAME_SLUG },
        importedBy: null,
        viewer: { role, canEdit: false, canManageEditors: false },
        ranks: [],
        roleCounts: { tank: 0, healer: 0, dps: 0, unknown: 0 },
    };
}

function signup(name: string, userId: number, over: Partial<ReadySignup> = {}): ReadySignup {
    return {
        userId, characterId: null, name,
        level: { state: 'pass', value: 60, source: 'roster' },
        quests: { state: 'na', ready: 0, total: 0 },
        saved: { state: 'pass', instanceName: null, resetAt: null },
        ilvl: { state: 'pass', value: 58, source: 'addon' },
        overall: 'pass',
        ...over,
    };
}

const BRANNOCH = signup('Brannoch', 1, { level: { state: 'fail', value: 52, source: 'roster' }, ilvl: { state: 'fail', value: 41, source: 'addon' }, overall: 'fail' });
const MIRELLE = signup('Mirelle', 2, { saved: { state: 'fail', instanceName: 'Molten Core', resetAt: RESET }, overall: 'fail' });
const TORVALD = signup('Torvald', 3, { saved: { state: 'unknown', instanceName: null, resetAt: null }, ilvl: { state: 'unknown', value: null, source: null }, overall: 'unknown' });
const ALDRIC = signup('Aldric', 4, { characterId: ALDRIC_CHARACTER_ID, ilvl: { state: 'pass', value: 61, source: 'addon' } });

function readiness(signups: ReadySignup[], over: Partial<EventRaidReadiness> = {}): EventRaidReadiness {
    return {
        event: { id: 101, title: 'Molten Core Night', startTime: START },
        requirements: { minLevel: 60, ilvlFloor: 55, raidNames: ['Molten Core'], questCount: 0 },
        signups,
        freshness: { source: 'addon', asOf: new Date(Date.now() - 2 * 86_400_000).toISOString() },
        ...over,
    };
}

const RAID = readiness([ALDRIC, TORVALD, MIRELLE, BRANNOCH]);

type Reply = EventRaidReadiness | 403 | 404;
const calls = { count: 0 };

function serve(reply: Reply, instances = MC): void {
    server.use(
        guildRaidsHandler([{ ...contentEvent(101, START, instances), title: 'Molten Core Night' }]),
        http.get(READINESS_URL, () => {
            calls.count += 1;
            if (typeof reply === 'number') return HttpResponse.json({ message: 'nope' }, { status: reply });
            return HttpResponse.json(reply);
        }),
    );
}

function useRaids(): ReturnType<typeof useQuery<GuildRaidsDto, Error>> {
    return useQuery<GuildRaidsDto, Error>({
        queryKey: ['raids-harness'],
        queryFn: async () => GuildRaidsSchema.parse(await (await fetch('http://localhost:3000/guilds/7/raids')).json()),
    });
}

function WidgetHarness(): JSX.Element {
    return <ReadyCheckWidget page={page()} raids={useRaids()} gameSlug={WOW_FOREVER_GAME_SLUG} />;
}

function CellsHarness({ role }: { role: Viewer }): JSX.Element {
    const raids = useRaids();
    const cells = gameWidgetCells({ page: page(role), raids }, new Set(['blizzard']));
    return <div>{raids.isSuccess && <span data-testid="raids-ready" />}{cells.map((c) => <div key={c.key}>{c.node}</div>)}</div>;
}

function setWide(wide: boolean): void {
    vi.spyOn(window, 'matchMedia').mockImplementation((query: string): MediaQueryList => ({
        matches: query === MATRIX_MQ ? wide : false, media: query, onchange: null,
        addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(),
        dispatchEvent: () => true,
    }));
}

beforeEach(() => { setWide(true); auth.role = 'member'; calls.count = 0; });
afterEach(() => vi.restoreAllMocks());

describe('ready-check helpers', () => {
    it('sorts not ready, then unknown, then ready, by name within each', () => {
        const abe = signup('Abe', 8, { overall: 'unknown' });
        expect(sortSignups([...RAID.signups, abe]).map((s) => s.name)).toEqual(['Brannoch', 'Mirelle', 'Abe', 'Torvald', 'Aldric']);
    });

    it('counts the summary and leaves n/a requirements out of the line', () => {
        expect(summaryCounts(RAID.signups)).toEqual({ pass: 1, fail: 2, unknown: 1 });
        expect(requirementsLine(RAID.requirements)).toBe('Level 60+ · item level 55+ · not saved to Molten Core');
        expect(requirementsLine({ minLevel: 24, ilvlFloor: 15, raidNames: [], questCount: 3 })).toBe('Level 24+ · item level 15+ · quests: 3 known');
        expect(requirementsLine({ minLevel: null, ilvlFloor: null, raidNames: [], questCount: 0 })).toBe('');
    });

    it('makes a failed quest check amber (warning), never danger, with ready/total', () => {
        const pip = signup('Pip', 9, { quests: { state: 'fail', ready: 2, total: 3 }, overall: 'fail' });
        expect(rowCells(pip, RAID.requirements).quests).toEqual({ label: '✗ 2/3', title: 'Pip — 2 of 3 quests ready', tone: 'warning' });
    });

    it('shows an unknown as a neutral "?" without a value and an n/a check as no chip', () => {
        const cells = rowCells(TORVALD, RAID.requirements);
        expect(cells.ilvl).toEqual({ label: '?', title: 'Torvald — item level unknown', tone: 'neutral' });
        expect(cells.quests).toBeNull();
    });
});

describe('ReadyCheckWidget — desktop table', () => {
    it('renders the header, requirements, summary and the rows in fail → unknown → pass order', async () => {
        serve(RAID);
        renderWithProviders(<WidgetHarness />);
        const table = await screen.findByRole('table', { name: 'Molten Core Night readiness' });
        expect(screen.getByRole('link', { name: 'Molten Core Night' })).toHaveAttribute('href', '/events/101');
        expect(screen.getByTestId('ready-check-requirements')).toHaveTextContent('Level 60+ · item level 55+ · not saved to Molten Core');
        expect(within(screen.getByTestId('ready-check-summary')).getByTitle('2 not ready')).toHaveAttribute('data-tone', 'warning');
        const names = within(table).getAllByRole('rowheader').map((h) => h.textContent);
        expect(names).toEqual(['Brannoch', 'Mirelle', 'Torvald', 'Aldric']);
        expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Character', 'Level', 'Quests', 'Saved', 'Item level', 'Ready']);
    });

    it('titles every chip, uses the warning tone for fails and "—" for an n/a check', async () => {
        serve(RAID);
        renderWithProviders(<WidgetHarness />);
        const table = await screen.findByRole('table');
        expect(within(table).getByTitle('Brannoch — level 52, needs 60')).toHaveTextContent('✗ 52');
        expect(within(table).getByTitle('Brannoch — item level 41, needs 55')).toHaveAttribute('data-tone', 'warning');
        expect(within(table).getByTitle(/^Mirelle — saved to Molten Core, resets \w+$/)).toHaveAttribute('data-tone', 'warning');
        expect(within(table).getByTitle('Torvald — lockouts unknown')).toHaveTextContent('?');
        expect(within(table).getByTitle('Aldric — ready')).toHaveAttribute('data-tone', 'success');
        expect(within(table).getAllByTitle('Not applicable to this event')).toHaveLength(4);
        expect(table.querySelectorAll('[data-tone="danger"]')).toHaveLength(0);
        for (const chip of table.querySelectorAll('[data-tone]')) expect(chip.getAttribute('title')).toBeTruthy();
    });

    it('links a character name to its page and leaves a name without a character as text', async () => {
        serve(RAID);
        renderWithProviders(<WidgetHarness />);
        await screen.findByRole('table');
        expect(screen.getByRole('link', { name: 'Aldric' })).toHaveAttribute('href', `/characters/${ALDRIC_CHARACTER_ID}`);
        expect(screen.queryByRole('link', { name: 'Brannoch' })).toBeNull();
    });

    it('explains the empty quest dataset on the Quests header and shows the freshness footer', async () => {
        serve(RAID);
        renderWithProviders(<WidgetHarness />);
        const table = await screen.findByRole('table');
        expect(within(table).getByRole('columnheader', { name: 'Quests' })).toHaveAttribute('title', 'Quest data for Forever dungeons arrives after launch');
        expect(screen.getByTestId('ready-check-freshness')).toHaveTextContent(/via LedgerLink · as of 2 days ago/);
    });

    it('shows the first 10 rows and a "N more" disclosure for the rest', async () => {
        const many = Array.from({ length: 12 }, (_, i) => signup(`Raider ${String(i).padStart(2, '0')}`, i + 1));
        serve(readiness(many));
        renderWithProviders(<WidgetHarness />);
        const table = await screen.findByRole('table');
        expect(within(table).getAllByRole('rowheader')).toHaveLength(10);
        const more = screen.getByRole('button', { name: /2 more/ });
        expect(more).toHaveAttribute('aria-expanded', 'false');
        await userEvent.click(more);
        expect(within(table).getAllByRole('rowheader')).toHaveLength(12);
    });
});

describe('ReadyCheckWidget — phone, states and errors', () => {
    it('shows a list with labelled mini chips and no n/a chip on phone', async () => {
        setWide(false);
        serve(RAID);
        renderWithProviders(<WidgetHarness />);
        const list = await screen.findByRole('list', { name: 'Molten Core Night readiness' });
        expect(screen.queryByRole('table')).toBeNull();
        expect(within(list).getByTitle('Brannoch — level 52, needs 60')).toHaveTextContent('Lvl ✗ 52');
        expect(within(list).getByTitle('Brannoch — not ready')).toHaveTextContent('✗ Not ready');
        expect(within(list).queryByText(/^Quests/)).toBeNull();
    });

    it('shows pulse rows while loading', async () => {
        server.use(guildRaidsHandler([contentEvent(101, START, MC)]), http.get(READINESS_URL, () => new Promise(() => undefined)));
        renderWithProviders(<WidgetHarness />);
        expect(await screen.findByTestId('ready-check-loading')).toBeInTheDocument();
    });

    it.each([403, 404] as const)('shows a quiet line for a %i', async (status) => {
        serve(status);
        renderWithProviders(<WidgetHarness />);
        expect(await screen.findByText("Readiness isn't available for this event.")).toBeInTheDocument();
        expect(screen.queryByRole('table')).toBeNull();
    });

    it('says no one has signed up yet and keeps the event link', async () => {
        serve(readiness([]));
        renderWithProviders(<WidgetHarness />);
        expect(await screen.findByText('No one has signed up yet.')).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Molten Core Night' })).toHaveAttribute('href', '/events/101');
        expect(screen.queryByTestId('ready-check-summary')).toBeNull();
    });
});

describe('Ready for next run registration', () => {
    beforeEach(() => {
        clearRegistry();
        registerReadyCheckWidget(registerPlugin('blizzard', { icon: '/x.png', color: 'blue', label: 'WoW' }));
    });

    it('hides itself when no upcoming guild event has content', async () => {
        serve(RAID, []);
        renderWithProviders(<CellsHarness role="member" />);
        await screen.findByTestId('raids-ready');
        expect(screen.queryByRole('heading', { name: 'Ready for next run' })).toBeNull();
        expect(calls.count).toBe(0);
    });

    it('shows for a member when an upcoming event has content', async () => {
        serve(RAID);
        renderWithProviders(<CellsHarness role="member" />);
        expect(await screen.findByRole('heading', { name: 'Ready for next run' })).toBeInTheDocument();
        expect(await screen.findByRole('table')).toBeInTheDocument();
    });

    it('never mounts the body (no request) for a visitor', async () => {
        serve(RAID);
        renderWithProviders(<CellsHarness role="visitor" />);
        await screen.findByTestId('raids-ready');
        expect(screen.queryByRole('heading', { name: 'Ready for next run' })).toBeNull();
        expect(calls.count).toBe(0);
    });

    it('shows for staff who are not in the guild (the API lets them in)', async () => {
        auth.role = 'admin';
        serve(RAID);
        renderWithProviders(<CellsHarness role="visitor" />);
        expect(await screen.findByRole('heading', { name: 'Ready for next run' })).toBeInTheDocument();
    });
});
