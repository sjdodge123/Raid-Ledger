/**
 * ROK-1790 — the WoW: Forever Crafters tab: one card per profession, search,
 * the `FilterEntry` funnel (desktop toolbar panel here), and both empty states.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { GuildPage } from '@raid-ledger/contract';
import { server } from '../../../../test/mocks/server';
import { renderWithProviders } from '../../../../test/render-helpers';
import {
    MOCK_CHAR_IDS, NO_PROFESSIONS_FIXTURE, PROFESSIONS_FIXTURE, myCharactersHandler, rosterInsightsHandler,
} from '../../../../test/handlers/forever-hub-widgets';
import CraftersTab from './crafters-tab';

const media = vi.hoisted(() => ({ desktop: true }));
vi.mock('../../../../hooks/use-media-query', () => ({ useMediaQuery: () => media.desktop }));
vi.mock('../../../../hooks/use-auth', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../../hooks/use-auth')>()),
    useAuth: () => ({ user: { id: 1, role: 'member' }, isAuthenticated: true }),
}));

const PAGE: GuildPage = {
    guild: { id: 7, gameId: 3, kind: 'wow_guild', name: 'Hub', region: 'us', realmSlug: null, realmName: null, faction: null,
        memberCount: 5, lastSnapshotAt: null, gameSlug: 'world-of-warcraft-forever' },
    importedBy: null,
    viewer: { role: 'member', canEdit: false, canManageEditors: false },
    ranks: [],
    roleCounts: { tank: 0, healer: 0, dps: 0, unknown: 0 },
};

function renderTab(): void {
    renderWithProviders(<CraftersTab page={PAGE} />);
}

/** The profession card titles, in render order. */
async function cardTitles(): Promise<string[]> {
    const list = await screen.findByRole('list', { name: 'Crafters by profession' });
    return within(list).getAllByRole('heading', { level: 3 }).map((h) => h.textContent ?? '');
}

beforeEach(() => {
    media.desktop = true;
});

describe('CraftersTab', () => {
    it('shows one card per profession, each crafter linking to their character with skill and source', async () => {
        server.use(rosterInsightsHandler({ all: PROFESSIONS_FIXTURE }));
        renderTab();
        expect(await cardTitles()).toEqual(['Alchemy', 'Mining']);
        const alchemy = screen.getByRole('list', { name: 'Alchemy crafters' });
        expect(within(alchemy).getByRole('link', { name: 'Brewa' })).toHaveAttribute('href', `/characters/${MOCK_CHAR_IDS.thrall}`);
        expect(within(alchemy).getByText('225/300')).toBeInTheDocument();
        expect(within(alchemy).getByText('manual')).toBeInTheDocument();
        expect(within(alchemy).getByRole('meter', { name: 'Brewa Alchemy skill' })).toHaveAttribute('aria-valuenow', '75');
    });

    it('search by character name narrows each card to the matching crafters', async () => {
        server.use(rosterInsightsHandler({ all: PROFESSIONS_FIXTURE }));
        renderTab();
        await cardTitles();
        await userEvent.type(screen.getByRole('searchbox', { name: 'Search professions or crafters' }), 'brew');
        expect(await cardTitles()).toEqual(['Alchemy']);
        const alchemy = screen.getByRole('list', { name: 'Alchemy crafters' });
        expect(within(alchemy).queryByRole('link', { name: 'Mixer' })).toBeNull();
    });

    it('the Profession filter narrows the cards and the funnel badge counts it', async () => {
        server.use(rosterInsightsHandler({ all: PROFESSIONS_FIXTURE }));
        renderTab();
        await cardTitles();
        await userEvent.click(screen.getByRole('button', { name: /^Filters/ }));
        await userEvent.click(screen.getByRole('button', { name: 'Mining', pressed: false }));
        expect(await cardTitles()).toEqual(['Mining']);
        expect(screen.getByRole('button', { name: 'Mining', pressed: true })).toBeInTheDocument();
    });

    it('a minimum skill above everyone shows the no-match state, whose action restores the cards', async () => {
        server.use(rosterInsightsHandler({ all: PROFESSIONS_FIXTURE }));
        renderTab();
        await cardTitles();
        await userEvent.click(screen.getByRole('button', { name: /^Filters/ }));
        await userEvent.click(screen.getByRole('button', { name: '300', pressed: false }));
        expect(screen.getByText('No crafter matches these filters.')).toBeInTheDocument();
        expect(screen.queryByRole('list', { name: 'Crafters by profession' })).toBeNull();
        await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
        expect(await cardTitles()).toEqual(['Alchemy', 'Mining']);
    });

    it('a search that matches nobody names the query', async () => {
        server.use(rosterInsightsHandler({ all: PROFESSIONS_FIXTURE }));
        renderTab();
        await cardTitles();
        await userEvent.type(screen.getByRole('searchbox', { name: 'Search professions or crafters' }), 'zzz');
        expect(screen.getByText('No crafter matches “zzz”.')).toBeInTheDocument();
    });

    it('shows the professions empty state when nobody has professions', async () => {
        server.use(rosterInsightsHandler({ all: NO_PROFESSIONS_FIXTURE }), myCharactersHandler([]));
        renderTab();
        expect(await screen.findByText('No one has set their professions yet.')).toBeInTheDocument();
        expect(screen.queryByRole('searchbox')).toBeNull();
    });
});
