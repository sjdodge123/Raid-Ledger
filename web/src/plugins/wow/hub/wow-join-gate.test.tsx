/**
 * ROK-2132 — a non-member opening a WoW: Forever guild hub gets the join gate
 * (core asks the `wow_guild` module's `nonMemberGate` on a `HUB_NOT_MEMBER`
 * 403) instead of the notice; every other 403 keeps today's notice (AC 7).
 * The Add character modal is stubbed to its props: L4 owns its tabs/filter.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Route, Routes, useLocation } from 'react-router-dom';
import type { JSX } from 'react';
import { HUB_NOT_MEMBER, type GuildPage as GuildPageDto, type WowGuildJoinGateDto } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { renderWithProviders } from '../../../test/render-helpers';
import { activateWowPlugin } from '../../../test/activate-wow-plugin';
import { GuildPage } from '../../../components/hub/hub-page';
import { HUB_PLUGIN_INACTIVE } from '../../../components/hub/hub-plugin-inactive.helpers';
import { usePluginStore } from '../../../stores/plugin-store';
import { NOT_LINKED_WARNING } from './wow-join-gate.helpers';

/**
 * The viewer's characters come through a real query (so `['me', 'characters']`
 * invalidation refetches them), and `charsReady` can hold the first load back
 * so a test can open the modal before the list has arrived (AC 8).
 */
let myChars: { id: string }[] = [];
let charsReady: Promise<void> = Promise.resolve();
let charsServed = 0;
vi.mock('../../../hooks/use-characters', async () => {
    const { useQuery } = await import('@tanstack/react-query');
    return {
        useMyCharacters: (gameId?: number, enabled = true) => useQuery({
            queryKey: ['me', 'characters', gameId ?? null],
            queryFn: async () => {
                await charsReady;
                charsServed += 1;
                return { data: [...myChars], meta: { total: myChars.length } };
            },
            enabled,
        }),
    };
});

interface StubProps { onClose: () => void; initialTab?: string; rosterGuildId?: number; gameSlug?: string }
vi.mock('../../../components/profile/AddCharacterModal', () => ({
    AddCharacterModal: (p: StubProps): JSX.Element => (
        <div data-testid="add-character-modal" data-tab={p.initialTab} data-guild={String(p.rosterGuildId)} data-slug={p.gameSlug}>
            <button type="button" onClick={() => { myChars = [...myChars, { id: 'claimed-char' }]; p.onClose(); }}>stub-claim</button>
        </div>
    ),
}));

const API = 'http://localhost:3000';
const NOT_MEMBER_COPY = "You're not a member of this guild. Link a character in the guild to see its page.";
const GATE: WowGuildJoinGateDto = {
    guild: { id: 7, gameId: 4, name: 'Iron Remnant', region: 'us', realmName: 'Thunderfury', memberCount: 142, crest: null },
    viewer: { isMember: false, hasForeverCharacter: false },
};
const PAGE_DTO: GuildPageDto = {
    guild: { id: 7, gameId: 4, kind: 'wow_guild', name: 'Iron Remnant', region: 'us', realmSlug: null, realmName: 'Thunderfury', faction: 'Horde', memberCount: 142, lastSnapshotAt: null },
    importedBy: null,
    viewer: { role: 'member', canEdit: false, canManageEditors: false },
    ranks: [],
    roleCounts: { tank: 0, healer: 0, dps: 0, unknown: 0 },
};

const forbidden = (body: Record<string, unknown>) => HttpResponse.json({ statusCode: 403, message: 'Forbidden', ...body }, { status: 403 });
const notMember = (kind = 'wow_guild') => forbidden({ message: 'Not a member of this guild', code: HUB_NOT_MEMBER, kind });

let pageIsMember = false;
/** The page answers 200 from this request number on (1-based) — a deterministic "membership arrived". */
let pageOkFrom = Number.POSITIVE_INFINITY;
let pageCalls = 0;
let requested: string[] = [];

function serve(gate: WowGuildJoinGateDto | null = GATE, pageBody = notMember): void {
    server.use(
        http.get(`${API}/guilds/7`, () => {
            pageCalls += 1;
            return pageIsMember || pageCalls >= pageOkFrom ? HttpResponse.json(PAGE_DTO) : pageBody();
        }),
        http.get(`${API}/plugins/wow/guilds/7/join-gate`, () => (gate ? HttpResponse.json(gate) : HttpResponse.json({ message: 'Hub not found' }, { status: 404 }))),
    );
}

function Search(): JSX.Element {
    return <span data-testid="search">{useLocation().search}</span>;
}

function renderPage(path = '/hubs/7') {
    return renderWithProviders(
        <Routes><Route path="/hubs/:id" element={<><GuildPage /><Search /></>} /></Routes>,
        { initialEntries: [path] },
    );
}

beforeEach(() => {
    activateWowPlugin();
    myChars = [];
    charsReady = Promise.resolve();
    charsServed = 0;
    pageIsMember = false;
    pageOkFrom = Number.POSITIVE_INFINITY;
    pageCalls = 0;
    requested = [];
    server.events.on('request:start', ({ request }) => { requested.push(new URL(request.url).pathname); });
});
afterEach(() => { server.events.removeAllListeners(); });

describe('WoW join gate — render (AC 1, 6)', () => {
    it('shows the 7 facts and the two actions, and asks for no member data', async () => {
        serve();
        renderPage();
        const gate = await screen.findByTestId('wow-join-gate');
        expect(gate).toHaveTextContent('Iron Remnant');
        expect(gate).toHaveTextContent('Thunderfury · US · WoW: Forever');
        expect(gate).toHaveTextContent('142 members');
        expect(gate).toHaveTextContent('This guild page is for members. Find your character on the roster to join.');
        expect(screen.getByRole('button', { name: 'Pick my character' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Import from Armory' })).toBeInTheDocument();
        expect(screen.queryByTestId('guild-not-member'), 'the gate replaces the 403 notice').toBeNull();
        const memberData = requested.filter((p) => /\/(raids|roster-insights|profile|editors|posts|content)\b/.test(p));
        expect(memberData, 'a non-member gate must not request member-only data').toEqual([]);
    });

    it('shows the not-on-roster hint only when the viewer owns a Forever character', async () => {
        serve();
        const first = renderPage();
        await screen.findByTestId('wow-join-gate');
        expect(screen.queryByTestId('wow-join-gate-hint')).toBeNull();
        first.unmount();
        serve({ ...GATE, viewer: { isMember: false, hasForeverCharacter: true } });
        renderPage();
        expect(await screen.findByTestId('wow-join-gate-hint')).toHaveTextContent('Already added your character?');
    });
});

describe('WoW join gate — actions (AC 2, 3)', () => {
    it('Pick my character opens Add character on the roster tab, filtered to this guild', async () => {
        serve();
        renderPage();
        await userEvent.click(await screen.findByRole('button', { name: 'Pick my character' }));
        const modal = screen.getByTestId('add-character-modal');
        expect(modal).toHaveAttribute('data-tab', 'roster');
        expect(modal).toHaveAttribute('data-guild', '7');
        expect(modal).toHaveAttribute('data-slug', 'world-of-warcraft-forever');
    });

    it('Import from Armory opens Add character on the Import tab', async () => {
        serve();
        renderPage();
        await userEvent.click(await screen.findByRole('button', { name: 'Import from Armory' }));
        expect(screen.getByTestId('add-character-modal')).toHaveAttribute('data-tab', 'import');
    });

});

describe('WoW join gate — after the modal (AC 4, 8, Ruling 9)', () => {
    it('a claim that confers membership lands on the guild page without a reload', async () => {
        serve();
        renderPage();
        await userEvent.click(await screen.findByRole('button', { name: 'Pick my character' }));
        pageIsMember = true;
        await userEvent.click(screen.getByRole('button', { name: 'stub-claim' }));
        expect(await screen.findByRole('navigation', { name: 'Guild page sections' })).toBeInTheDocument();
        expect(screen.queryByTestId('wow-join-gate')).toBeNull();
    });

    it('a claim that leaves the page 403 shows the warning banner instead of looping', async () => {
        serve();
        renderPage();
        await userEvent.click(await screen.findByRole('button', { name: 'Pick my character' }));
        await userEvent.click(screen.getByRole('button', { name: 'stub-claim' }));
        expect(await screen.findByTestId('wow-join-gate-warning')).toHaveTextContent(NOT_LINKED_WARNING);
        expect(screen.getByTestId('wow-join-gate')).toBeInTheDocument();
    });

    it('?claim=roster opens the roster tab on arrival and strips the param', async () => {
        serve();
        renderPage('/hubs/7?claim=roster');
        expect(await screen.findByTestId('add-character-modal')).toHaveAttribute('data-tab', 'roster');
        await waitFor(() => expect(screen.getByTestId('search')).toHaveTextContent(/^$/));
    });

    it('a claim before the characters have loaded (the ?claim=roster landing) still warns', async () => {
        let release: () => void = () => undefined;
        charsReady = new Promise<void>((resolve) => { release = resolve; });
        serve();
        renderPage('/hubs/7?claim=roster');
        await screen.findByTestId('add-character-modal');
        expect(charsServed, 'the modal must open before the characters load').toBe(0);
        release();
        await waitFor(() => expect(charsServed, 'the first character load').toBe(1));
        await userEvent.click(screen.getByRole('button', { name: 'stub-claim' }));
        await waitFor(() => expect(
            screen.queryByTestId('wow-join-gate-warning'),
            'a new character with the page still 403 must show the warning',
        ).toHaveTextContent(NOT_LINKED_WARNING));
    });

    it('a viewer who is already a member is sent on to the page', async () => {
        // The first page request is the 403 that shows the gate; the gate's re-ask is answered 200.
        pageOkFrom = 2;
        serve({ ...GATE, viewer: { isMember: true, hasForeverCharacter: true } });
        renderPage();
        expect(await screen.findByRole('navigation', { name: 'Guild page sections' })).toBeInTheDocument();
        expect(screen.queryByTestId('wow-join-gate')).toBeNull();
    });
});

describe('Other 403s keep today’s notices (AC 7)', () => {
    it('a community hub 403 keeps the not-a-member notice', async () => {
        serve(GATE, () => notMember('game_community'));
        renderPage();
        expect(await screen.findByTestId('guild-not-member')).toBeInTheDocument();
        expect(screen.queryByTestId('wow-join-gate')).toBeNull();
    });

    it('a WoW guild the gate refuses (Retail/Classic) keeps the WoW notice', async () => {
        serve(null);
        renderPage();
        expect(await screen.findByTestId('guild-not-member')).toHaveTextContent(NOT_MEMBER_COPY);
        expect(screen.queryByTestId('wow-join-gate')).toBeNull();
    });

    it('a plain membership 403 (no code) keeps the notice and never asks for the gate', async () => {
        serve(GATE, () => forbidden({ message: 'Not a member of this guild' }));
        renderPage();
        expect(await screen.findByTestId('guild-not-member')).toHaveTextContent(NOT_MEMBER_COPY);
        expect(requested.some((p) => p.endsWith('/join-gate'))).toBe(false);
    });

    it('the plugin-off 403 keeps the plugin-inactive notice', async () => {
        serve(GATE, () => forbidden({ code: HUB_PLUGIN_INACTIVE, pluginSlug: 'blizzard' }));
        renderPage();
        expect(await screen.findByTestId('guild-plugin-inactive')).toBeInTheDocument();
        expect(screen.queryByTestId('wow-join-gate')).toBeNull();
    });

    it('with the WoW plugin off, a HUB_NOT_MEMBER 403 falls back to the notice', async () => {
        usePluginStore.setState({ activeSlugs: new Set<string>() });
        serve();
        renderPage();
        expect(await screen.findByTestId('guild-not-member')).toBeInTheDocument();
        expect(screen.queryByTestId('wow-join-gate')).toBeNull();
    });
});
