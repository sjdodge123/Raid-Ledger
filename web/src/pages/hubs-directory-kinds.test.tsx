/** ROK-1875 — `/hubs` lists server, community and guild hubs with a kind chip and a Kind filter. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { useLocation } from 'react-router-dom';
import type { JSX } from 'react';
import { server } from '../test/mocks/server';
import { renderWithProviders } from '../test/render-helpers';
import {
    communityHubHandlers, createMockHubDirectoryPage, createMockHubEntry, createMockServerHubEntry,
} from '../test/handlers/community-hubs';
import { mockDesktop } from '../test/handlers/media';
import { HubsDirectoryPage } from './hubs-directory-page';

const API = 'http://localhost:3000';
const SERVER = createMockServerHubEntry();
const COMMUNITY = createMockHubEntry({ id: 2, name: 'BG3 Crew', memberCount: 5 });
const GUILD = createMockHubEntry({
    id: 3, gameName: 'World of Warcraft', name: 'Iron Vanguard', leaderName: null, memberCount: 140,
    viewer: 'member', kind: 'wow_guild',
});
const MIXED = createMockHubDirectoryPage({ items: [SERVER, COMMUNITY, GUILD] });

function LocationProbe(): JSX.Element {
    const { pathname, search } = useLocation();
    return <output data-testid="location">{pathname + search}</output>;
}

function renderPage(entry = '/hubs'): void {
    renderWithProviders(<><HubsDirectoryPage /><LocationProbe /></>, { initialEntries: [entry] });
}

async function cardFor(name: string): Promise<HTMLElement> {
    const link = await screen.findByRole('link', { name });
    const card = link.closest('article');
    if (!card) throw new Error(`no card for ${name}`);
    return card;
}

const filtersButton = (): HTMLElement => screen.getByRole('button', { name: /^Filters/ });

afterEach(() => { server.resetHandlers(); vi.restoreAllMocks(); });

describe('HubsDirectoryPage — kind chips and card actions', () => {
    it('a mixed page renders one card per hub with its kind chip, in API order', async () => {
        server.use(...communityHubHandlers({ directory: MIXED }));
        renderPage();
        await screen.findByText('Valheim — Gamernight');
        const chips = screen.getAllByTestId('hub-kind-chip').map((c) => c.textContent);
        expect(chips).toEqual(['Server', 'Community', 'Guild']);
    });

    it('a server card shows View to its hub page and no Join; its meta has no leader', async () => {
        server.use(...communityHubHandlers({ directory: MIXED }));
        renderPage();
        const card = await cardFor('Valheim — Gamernight');
        expect(within(card).getByRole('link', { name: 'View Valheim — Gamernight' })).toHaveAttribute('href', '/hubs/310');
        expect(within(card).queryByRole('button', { name: /Join/ })).toBeNull();
        expect(within(card).getByText('12 members')).toBeInTheDocument();
    });

    it('a guild card shows View even for a member (no Joined chip); community keeps Join', async () => {
        server.use(...communityHubHandlers({ directory: MIXED }));
        renderPage();
        const guild = await cardFor('Iron Vanguard');
        expect(within(guild).getByRole('link', { name: 'View Iron Vanguard' })).toHaveAttribute('href', '/hubs/3');
        expect(within(guild).queryByText('Joined')).toBeNull();
        const community = await cardFor('BG3 Crew');
        expect(within(community).getByRole('button', { name: 'Join BG3 Crew' })).toBeInTheDocument();
        expect(within(community).getByText('5 members · Led by Mirelle')).toBeInTheDocument();
    });

});

describe('HubsDirectoryPage — Kind filter and empty states', () => {
    it('picking Server writes ?kind=server, refetches with kind=game_server and badges the funnel', async () => {
        const seen: URLSearchParams[] = [];
        server.use(http.get(`${API}/hubs`, ({ request }) => {
            seen.push(new URL(request.url).searchParams);
            return HttpResponse.json(MIXED);
        }));
        mockDesktop(true);
        renderPage();
        await screen.findByText('Valheim — Gamernight');
        await userEvent.click(filtersButton());
        const kind = screen.getByRole('radiogroup', { name: 'Kind' });
        expect(within(kind).getAllByRole('radio').map((r) => r.closest('label')?.textContent))
            .toEqual(['All', 'Server', 'Community', 'Guild']);
        await userEvent.click(within(kind).getByRole('radio', { name: 'Server' }));
        await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/hubs?kind=server'));
        expect(within(filtersButton()).getByText('1')).toBeInTheDocument();
        await waitFor(() => expect(seen.at(-1)?.get('kind')).toBe('game_server'));
        expect(seen[0]?.has('kind')).toBe(false);
    });

    it('hides the Kind group when only one kind is live', async () => {
        server.use(...communityHubHandlers({ directory: createMockHubDirectoryPage() }));
        mockDesktop(true);
        renderPage();
        await screen.findByText('Tavern Regulars');
        await userEvent.click(filtersButton());
        expect(screen.getByRole('radiogroup', { name: 'Membership' })).toBeInTheDocument();
        expect(screen.queryByRole('radiogroup', { name: 'Kind' })).toBeNull();
    });

    it('Clear all drops the kind filter', async () => {
        server.use(...communityHubHandlers({ directory: MIXED }));
        mockDesktop(true);
        renderPage('/hubs?kind=guild&sort=name');
        await screen.findByText('Iron Vanguard');
        await userEvent.click(filtersButton());
        await userEvent.click(screen.getByRole('button', { name: /Clear all/ }));
        await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(/^\/hubs\?sort=name$/));
    });

    it('a kind filter that matches nothing names the kind and offers Clear filters', async () => {
        server.use(...communityHubHandlers({ directory: createMockHubDirectoryPage({ items: [COMMUNITY], kinds: ['game_server', 'game_community'] }) }));
        renderPage('/hubs?kind=server');
        expect(await screen.findByText(/No server hubs match/)).toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
        await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/hubs'));
    });

    it('titles the page "Hubs" and uses the every-kind empty state', async () => {
        server.use(...communityHubHandlers({ directory: createMockHubDirectoryPage({ items: [], kinds: [] }) }));
        renderPage();
        expect(await screen.findByText("No hubs yet. Start a community hub from a game's page.")).toBeInTheDocument();
        expect(screen.getByRole('heading', { level: 1, name: 'Hubs' })).toBeInTheDocument();
        expect(screen.getByText('Game servers, guilds and community groups for the games we play.')).toBeInTheDocument();
    });
});

describe('HubsDirectoryPage — Kind radio checked state (smoke hubs-nav:194)', () => {
    it('the Kind radio reflects ?kind=server, and a new pick stays mounted + checked while its page loads', async () => {
        let release = (): void => undefined;
        const gate = new Promise<void>((resolve) => { release = resolve; });
        let calls = 0;
        server.use(http.get(`${API}/hubs`, async () => {
            calls += 1;
            if (calls > 1) await gate;
            return HttpResponse.json(MIXED);
        }));
        mockDesktop(true);
        renderPage('/hubs?kind=server');
        await screen.findByText('Valheim — Gamernight');
        await userEvent.click(filtersButton());
        expect(screen.getByRole('radio', { name: 'Server' }), '?kind=server checks the Server radio').toBeChecked();
        await userEvent.click(screen.getByRole('radio', { name: 'Community' }));
        await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/hubs?kind=community'));
        expect(screen.queryByRole('radio', { name: 'Community', checked: true }),
            'the Kind group stays mounted with Community checked while the kind=community page is in flight').not.toBeNull();
        release();
        await waitFor(() => expect(calls).toBe(2));
        expect(await screen.findByRole('radio', { name: 'Community', checked: true })).toBeInTheDocument();
    });
});

describe('HubsDirectoryPage — a pick is checked before the router transition commits (smoke hubs-nav:204)', () => {
    // React Router v7 wraps every navigation in startTransition, so a filter that reads only the URL
    // keeps the old value until a later scheduler task — and Playwright's check() reads `checked` in
    // between ("Clicking the checkbox did not change its state"). RTL's act() flushes transitions,
    // so a userEvent click never sees that window: click natively outside act and read after the
    // urgent (microtask) flush only.
    it('clicking Server leaves it checked after the urgent flush, with the URL still to follow', async () => {
        server.use(...communityHubHandlers({ directory: MIXED }));
        mockDesktop(true);
        renderPage('/hubs?membership=joined');
        await screen.findByText('Valheim — Gamernight');
        await userEvent.click(filtersButton());
        const radio = screen.getByRole('radio', { name: 'Server' });
        if (!(radio instanceof HTMLInputElement)) throw new Error('Server is not an <input>');
        const env = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean | undefined };
        const prev = env.IS_REACT_ACT_ENVIRONMENT;
        env.IS_REACT_ACT_ENVIRONMENT = false;
        let checkedAfterUrgentFlush: boolean;
        try {
            radio.click();
            await new Promise<void>((resolve) => queueMicrotask(resolve));
            checkedAfterUrgentFlush = radio.checked;
        } finally {
            env.IS_REACT_ACT_ENVIRONMENT = prev;
        }
        expect(checkedAfterUrgentFlush, 'Server must read checked once the click\'s urgent render lands, not only after the URL transition').toBe(true);
        await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/hubs?membership=joined&kind=server'));
        expect(screen.getByRole('radio', { name: 'Server' })).toBeChecked();
    });
});

describe('HubsDirectoryPage — staff Hidden chip (ROK-1883 AC19/AC23)', () => {
    it('a staff payload marks the hidden hub with a warning "Hidden" chip, and only that card', async () => {
        const items = [{ ...SERVER, hidden: true }, { ...COMMUNITY, hidden: false }, { ...GUILD, hidden: false }];
        server.use(...communityHubHandlers({ directory: createMockHubDirectoryPage({ items }) }));
        renderPage();
        const card = await cardFor('Valheim — Gamernight');
        const chip = within(card).getByText('Hidden');
        expect(chip).toHaveAttribute('data-tone', 'warning');
        expect(chip).toHaveAttribute('title', 'Hidden — only admins and operators can see this hub');
        expect(screen.getAllByText('Hidden')).toHaveLength(1);
    });

    it('a non-staff payload (no hidden key) shows no Hidden chip', async () => {
        server.use(...communityHubHandlers({ directory: MIXED }));
        renderPage();
        await cardFor('Valheim — Gamernight');
        expect(screen.queryByText('Hidden')).toBeNull();
    });
});
