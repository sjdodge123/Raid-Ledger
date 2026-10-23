/** ROK-1870 W1/W2 + ROK-1883 — the game page's one "Hubs" card. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { HubDirectoryEntry } from '@raid-ledger/contract';
import { server } from '../../test/mocks/server';
import { renderWithProviders } from '../../test/render-helpers';
import {
    communityHubHandlers, createMockGameHubs, createMockGameHubsAllKinds, createMockGuildHubEntry,
    createMockHubEntry, createMockHubProposal, createMockServerHubEntry,
} from '../../test/handlers/community-hubs';
import { toast } from '../../lib/toast';
import { GameHubsSection } from './game-hubs-section';
import { LazyGameHubsSection } from './game-hubs-section-lazy';

const API = 'http://localhost:3000';
const FOUR_HUBS = [1, 2, 3, 4].map((id) => createMockHubEntry({ id, name: `Hub ${id}`, memberCount: 10 }));

function renderCard(): void {
    renderWithProviders(<GameHubsSection gameId={5} gameName="Baldur's Gate 3" />);
}

function serveHubs(hubs: HubDirectoryEntry[]): void {
    server.use(...communityHubHandlers({ gameHubs: createMockGameHubs({ hubs }) }));
}

/** The card row whose name link is `name`. */
async function rowFor(name: string): Promise<HTMLElement> {
    const link = await screen.findByRole('link', { name });
    const row = link.closest('li');
    if (!row) throw new Error(`no row for ${name}`);
    return row;
}

const rowIds = (): Array<string | null> => screen.getAllByTestId('game-hub-row').map((r) => r.getAttribute('data-hub-id'));

afterEach(() => { server.resetHandlers(); vi.restoreAllMocks(); });

describe('GameHubsSection — ROK-1870 behaviour kept', () => {
    it('W1: lists three hubs, links to all four and shows the pending proposal', async () => {
        server.use(...communityHubHandlers({ gameHubs: createMockGameHubs({ hubs: FOUR_HUBS, myProposals: [createMockHubProposal()] }) }));
        renderCard();
        expect(await screen.findByText('Hub 1')).toBeInTheDocument();
        expect(screen.getByText('Hub 3')).toBeInTheDocument();
        expect(screen.queryByText('Hub 4')).not.toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'See all 4 hubs' })).toHaveAttribute('href', '/hubs?game=5');
        expect(screen.getByText('Late-Night Larian')).toBeInTheDocument();
        expect(screen.getByText('Pending review')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Withdraw' })).toBeInTheDocument();
    });

    it('W2: a blocked viewer sees the Start button disabled with the reason', async () => {
        server.use(...communityHubHandlers({ gameHubs: createMockGameHubs({ canPropose: false, proposeBlockedReason: 'limit-reached' }) }));
        renderCard();
        const start = await screen.findByRole('button', { name: 'Start a community hub' });
        expect(start).toBeDisabled();
        expect(screen.getByText('You already have two proposals waiting for review.')).toBeInTheDocument();
    });

    it('AC9: the empty state names the game and keeps the Start CTA', async () => {
        server.use(...communityHubHandlers());
        renderCard();
        expect(await screen.findByText("No hubs for Baldur's Gate 3 yet — start the first community hub.")).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Start a community hub' })).toBeEnabled();
        expect(screen.queryByText('Your proposals')).not.toBeInTheDocument();
    });

    it('joins inline: the row flips to Joined and the count rises', async () => {
        serveHubs([createMockHubEntry({ memberCount: 14 })]);
        renderCard();
        await userEvent.click(await screen.findByRole('button', { name: 'Join Tavern Regulars' }));
        expect(await screen.findByText('Joined')).toBeInTheDocument();
        expect(screen.getByText(/^15 members/)).toBeInTheDocument();
    });

    it('withdraws a proposal after the inline confirm', async () => {
        let deleted = 0;
        server.use(
            http.delete(`${API}/hubs/proposals/:id`, () => { deleted += 1; return new HttpResponse(null, { status: 204 }); }),
            ...communityHubHandlers({ gameHubs: createMockGameHubs({ myProposals: [createMockHubProposal()] }) }),
        );
        renderCard();
        await userEvent.click(await screen.findByRole('button', { name: 'Withdraw' }));
        expect(deleted).toBe(0);
        await userEvent.click(screen.getByRole('button', { name: 'Yes, withdraw' }));
        await waitFor(() => expect(deleted).toBe(1));
    });

});

describe('GameHubsSection — error and counts', () => {
    it('AC12: a failed read keeps the card with an error line and a Retry that refetches', async () => {
        let calls = 0;
        server.use(http.get(`${API}/hubs/by-game/5`, () => { calls += 1; return HttpResponse.json({ message: 'boom' }, { status: 500 }); }));
        renderCard();
        expect(await screen.findByTestId('game-hubs-error')).toHaveTextContent('Couldn’t load hubs');
        expect(screen.getByRole('heading', { name: 'Hubs' })).toBeInTheDocument();
        const before = calls;
        await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
        await waitFor(() => expect(calls).toBeGreaterThan(before));
    });

    it('AC8: says "1 member" in the singular', async () => {
        serveHubs([createMockHubEntry({ memberCount: 1, blurb: null })]);
        renderCard();
        expect(await screen.findByText('1 member')).toBeInTheDocument();
    });
});

describe('GameHubsSection — one card for every kind (ROK-1883)', () => {
    it('AC1: one section headed "Hubs", labelled by game-hubs-heading; no "Community hubs" heading', async () => {
        server.use(...communityHubHandlers({ gameHubs: createMockGameHubsAllKinds() }));
        renderCard();
        const heading = await screen.findByRole('heading', { name: 'Hubs' });
        expect(heading).toHaveAttribute('id', 'game-hubs-heading');
        expect(screen.getByRole('region', { name: 'Hubs' })).toBeInTheDocument();
        expect(screen.queryByText('Community hubs')).toBeNull();
        expect(screen.queryByText('Guilds')).toBeNull();
    });

    it('AC2/AC5: three kinds → three rows with Guild / Server / Community chips; View for guild + server, Join for community', async () => {
        server.use(...communityHubHandlers({ gameHubs: createMockGameHubsAllKinds() }));
        renderCard();
        const guild = await rowFor('Lantern Watch');
        expect(within(guild).getByTestId('hub-kind-chip')).toHaveTextContent('Guild');
        expect(within(guild).getByRole('link', { name: 'View Lantern Watch' })).toHaveAttribute('href', '/hubs/420');
        const srv = await rowFor('Forever Test Realm');
        expect(within(srv).getByTestId('hub-kind-chip')).toHaveTextContent('Server');
        expect(within(srv).getByRole('link', { name: 'View Forever Test Realm' })).toHaveAttribute('href', '/hubs/310');
        const community = await rowFor('Dungeon Night Crew');
        expect(within(community).getByTestId('hub-kind-chip')).toHaveTextContent('Community');
        expect(within(community).getByRole('button', { name: 'Join Dungeon Night Crew' })).toBeEnabled();
        expect(rowIds()).toEqual(['420', '310', '1']);
    });

    it('AC5: community rows say Joined (member/officer), Leader (leader) and Banned (banned, no Join)', async () => {
        serveHubs([
            createMockHubEntry({ id: 1, name: 'Officers Club', viewer: 'officer' }),
            createMockHubEntry({ id: 2, name: 'My Own Hub', viewer: 'leader' }),
            createMockHubEntry({ id: 3, name: 'Kicked Out', viewer: 'banned' }),
        ]);
        renderCard();
        expect(within(await rowFor('Officers Club')).getByText('Joined')).toBeInTheDocument();
        expect(within(await rowFor('My Own Hub')).getByText('Leader')).toBeInTheDocument();
        const banned = await rowFor('Kicked Out');
        expect(within(banned).getByText('Banned')).toBeInTheDocument();
        expect(within(banned).queryByRole('button', { name: /Join/ })).toBeNull();
    });

});

describe('GameHubsSection — rows shown (ROK-1883)', () => {
    it('AC15: the operator case — BG3 with "Gamer bois" (2 members, joined) renders exactly one row', async () => {
        serveHubs([createMockHubEntry({ id: 77, name: 'Gamer bois', blurb: null, memberCount: 2, viewer: 'member' })]);
        renderCard();
        const row = await rowFor('Gamer bois');
        expect(rowIds()).toEqual(['77']);
        expect(within(row).getByText('2 members')).toBeInTheDocument();
        expect(within(row).getByTestId('hub-kind-chip')).toHaveTextContent('Community');
        expect(within(row).getByText('Joined')).toBeInTheDocument();
        expect(screen.getAllByRole('link', { name: 'Gamer bois' })).toHaveLength(1);
        expect(screen.queryByRole('link', { name: /^See all/ })).toBeNull();
    });

    it('AC3: a hub id repeated in the payload renders once', async () => {
        const dup = createMockGuildHubEntry();
        serveHubs([dup, { ...dup }, createMockHubEntry()]);
        renderCard();
        await rowFor('Lantern Watch');
        expect(rowIds()).toEqual(['420', '1']);
        expect(screen.queryByRole('link', { name: /^See all/ })).toBeNull();
    });

    it('AC7: every joined hub is shown (never truncated), then See all when more exist', async () => {
        const joined = [11, 12, 13, 14, 15].map((id) => createMockServerHubEntry({ id, name: `Joined ${id}`, viewer: 'member' }));
        const others = [21, 22].map((id) => createMockHubEntry({ id, name: `Other ${id}` }));
        serveHubs([...others, ...joined]);
        renderCard();
        await rowFor('Joined 11');
        expect(rowIds()).toEqual(['11', '12', '13', '14', '15']);
        expect(screen.getByRole('link', { name: 'See all 7 hubs' })).toHaveAttribute('href', '/hubs?game=5');
    });

    it('Codex P2: 50 joined rows returned of 73 visible → all 50 shown and See all 73 still links', async () => {
        const joined = Array.from({ length: 50 }, (_, i) => createMockServerHubEntry({ id: 100 + i, name: `Joined ${100 + i}`, viewer: 'member' }));
        server.use(...communityHubHandlers({ gameHubs: createMockGameHubs({ hubs: joined, total: 73 }) }));
        renderCard();
        await rowFor('Joined 100');
        expect(rowIds()).toHaveLength(50);
        expect(screen.getByRole('link', { name: 'See all 73 hubs' })).toHaveAttribute('href', '/hubs?game=5');
    });

    it('AC7: one joined hub is topped up with others to three rows, joined first', async () => {
        serveHubs([
            createMockHubEntry({ id: 1, name: 'A' }), createMockHubEntry({ id: 2, name: 'B' }),
            createMockHubEntry({ id: 3, name: 'C' }), createMockHubEntry({ id: 4, name: 'Mine', viewer: 'member' }),
        ]);
        renderCard();
        await rowFor('Mine');
        expect(rowIds()).toEqual(['4', '1', '2']);
        expect(screen.getByRole('link', { name: 'See all 4 hubs' })).toBeInTheDocument();
    });

});

describe('GameHubsSection — staff Hidden chip (ROK-1883)', () => {
    it('AC19: staff see a warning "Hidden" chip on a hidden hub, and only there', async () => {
        server.use(...communityHubHandlers({ gameHubs: createMockGameHubsAllKinds({ staff: true }) }));
        renderCard();
        const hidden = await rowFor('Valheim Dedicated');
        const chip = within(hidden).getByText('Hidden');
        expect(chip).toHaveAttribute('data-tone', 'warning');
        expect(chip).toHaveAttribute('title', 'Hidden — only admins and operators can see this hub');
        expect(screen.getAllByText('Hidden')).toHaveLength(1);
    });

    it('AC20/21: a non-staff payload (no hidden key) shows no Hidden chip', async () => {
        server.use(...communityHubHandlers({ gameHubs: createMockGameHubsAllKinds() }));
        renderCard();
        await rowFor('Lantern Watch');
        expect(screen.queryByText('Hidden')).toBeNull();
    });
});

describe('GameHubsSection — Join failure, loading (ROK-1883 review)', () => {
    it('AC6: a failed Join shows Joined optimistically, then rolls back and toasts the error', async () => {
        const toastError = vi.spyOn(toast, 'error').mockImplementation(() => 0);
        let release: () => void = () => undefined;
        const gate = new Promise<void>((resolve) => { release = resolve; });
        serveHubs([createMockHubEntry({ memberCount: 14 })]);
        server.use(http.post(`${API}/hubs/:id/join`, async () => {
            await gate;
            return HttpResponse.json({ message: 'Hub is full' }, { status: 500 });
        }));
        renderCard();
        await userEvent.click(await screen.findByRole('button', { name: 'Join Tavern Regulars' }));
        expect(await screen.findByText('Joined')).toBeInTheDocument();
        expect(screen.getByText(/^15 members/)).toBeInTheDocument();
        release();
        expect(await screen.findByRole('button', { name: 'Join Tavern Regulars' })).toBeEnabled();
        expect(screen.queryByText('Joined')).toBeNull();
        expect(screen.getByText(/^14 members/)).toBeInTheDocument();
        await waitFor(() => expect(toastError).toHaveBeenCalledWith('Hub is full'));
    });

    it('AC12: the lazy card shows its skeleton first, then the card replaces it', async () => {
        serveHubs([createMockHubEntry()]);
        renderWithProviders(<LazyGameHubsSection gameId={5} gameName="Baldur's Gate 3" />);
        expect(screen.getByTestId('game-hubs-loading')).toHaveAttribute('aria-busy', 'true');
        expect(await screen.findByRole('heading', { name: 'Hubs' })).toBeInTheDocument();
        expect(screen.queryByTestId('game-hubs-loading')).toBeNull();
    });
});
