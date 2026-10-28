/**
 * ROK-1916 (W9) — the WoW: Forever "Last seen" hub widget: the "N online at
 * last export" headline, up to five online names + "+N more", the five
 * longest-away rows ("34 d", "today"), the no-export and nobody-online states,
 * the visitor probe and the registration (id, order, audience, action).
 */
import { describe, it, expect, vi } from 'vitest';
import { screen, within, waitFor, renderHook } from '@testing-library/react';
import type { JSX, ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import type { GuildPage, WowRosterInsightsDto, WowRosterLastSeenDto } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { renderWithProviders, createTestQueryClient } from '../../../test/render-helpers';
import {
    MOCK_CHAR_IDS, VISITOR_FIXTURE, createBareRosterInsights, rosterInsightsHandler,
} from '../../../test/handlers/forever-hub-widgets';
import type { HubWidgetCtx } from '../../hub-game-widgets';
import LastSeenWidget from './last-seen-widget';
import { lastSeenWidget, useLastSeenVisible } from './last-seen.register';
import { MembersSeeAll } from './see-all-actions';

vi.mock('../../../hooks/use-auth', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../hooks/use-auth')>()),
    useAuth: () => ({ user: { id: 1, role: 'member' }, isAuthenticated: true }),
}));

const ONLINE_NAMES = ['Ana', 'Brightmane', 'Corvinna', 'Dunmoor', 'Elowyn', 'Fenwick'];

const POPULATED: WowRosterLastSeenDto = {
    reported: 42,
    onlineCount: 7,
    online: ONLINE_NAMES.map((name) => ({ name, characterId: name === 'Ana' ? MOCK_CHAR_IDS.thrall : null })),
    away: [
        { name: 'Grimtusk', characterId: MOCK_CHAR_IDS.jaina, days: 94 },
        { name: 'Halvard', characterId: null, days: 34 },
        { name: 'Isolde', characterId: null, days: 21 },
        { name: 'Jorrik', characterId: null, days: 9 },
        { name: 'Kestra', characterId: null, days: 1 },
        { name: 'Lorne', characterId: null, days: 1 },
    ],
};

function insights(lastSeen: WowRosterLastSeenDto | undefined): WowRosterInsightsDto {
    return createBareRosterInsights(lastSeen === undefined ? {} : { lastSeen });
}

function ctx(lastSnapshotAt: string | null = null): Pick<HubWidgetCtx, 'page'> {
    const page: GuildPage = {
        guild: { id: 7, gameId: 3, kind: 'wow_guild', name: 'Hub', region: 'us', realmSlug: null, realmName: null, faction: null,
            memberCount: 42, lastSnapshotAt, gameSlug: 'world-of-warcraft-forever' },
        importedBy: null,
        viewer: { role: 'member', canEdit: false, canManageEditors: false },
        ranks: [],
        roleCounts: { tank: 0, healer: 0, dps: 0, unknown: 0 },
    };
    return { page };
}

async function renderWith(lastSeen: WowRosterLastSeenDto | undefined, lastSnapshotAt: string | null = null): Promise<void> {
    server.use(rosterInsightsHandler({ all: insights(lastSeen) }));
    renderWithProviders(<LastSeenWidget {...ctx(lastSnapshotAt)} />);
    await screen.findByTestId('forever-freshness');
}

describe('LastSeenWidget', () => {
    it('shows the online count of the export and the reporting total', async () => {
        await renderWith(POPULATED);
        const headline = screen.getByTestId('last-seen-headline');
        expect(headline).toHaveTextContent('7');
        expect(headline).toHaveTextContent('online at last export');
        expect(screen.getByText('of 42 members in the export')).toBeInTheDocument();
        expect(document.body).not.toHaveTextContent(/online now|\blive\b/i);
    });

    it('lists at most five online names, linking linked characters, then "+N more"', async () => {
        await renderWith(POPULATED);
        const list = screen.getByRole('list', { name: 'Online at last export' });
        expect(within(list).getAllByRole('listitem')).toHaveLength(5);
        expect(within(list).getByRole('link', { name: 'Ana' })).toHaveAttribute('href', `/characters/${MOCK_CHAR_IDS.thrall}`);
        expect(within(list).queryByRole('link', { name: 'Brightmane' })).toBeNull();
        expect(within(list).queryByText('Fenwick')).toBeNull();
        expect(screen.getByText('+2 more')).toBeInTheDocument();
    });

    it('lists the five longest away with day counts and an explaining tooltip', async () => {
        await renderWith(POPULATED);
        const rows = within(screen.getByRole('list', { name: 'Longest away' })).getAllByRole('listitem');
        expect(rows).toHaveLength(5);
        expect(rows[0]).toHaveTextContent('Grimtusk');
        expect(rows[0]).toHaveTextContent('94 d');
        expect(within(rows[1] ?? document.body).getByText('34 d')).toHaveAttribute('title', 'Last online 34 days before the export');
        expect(within(rows[4] ?? document.body).getByText('1 d')).toHaveAttribute('title', 'Last online 1 day before the export');
        expect(screen.queryByText('Lorne')).toBeNull();
    });

    it('says "today" for a member offline under a day', async () => {
        await renderWith({ ...POPULATED, away: [{ name: 'Mereth', characterId: null, days: 0 }] });
        const today = screen.getByText('today');
        expect(today).toHaveAttribute('title', 'Offline less than a day before the export');
    });

    it('says nobody was online and still lists Longest away', async () => {
        await renderWith({ ...POPULATED, onlineCount: 0, online: [] });
        expect(screen.getByTestId('last-seen-headline')).toHaveTextContent('0');
        expect(screen.getByText('Nobody was online at the last export.')).toBeInTheDocument();
        expect(screen.queryByRole('list', { name: 'Online at last export' })).toBeNull();
        expect(screen.getByRole('list', { name: 'Longest away' })).toBeInTheDocument();
    });

    it('is one quiet line, no bare "0" headline, when nobody was online and no day counts came in', async () => {
        await renderWith({ reported: 3, onlineCount: 0, online: [], away: [] });
        expect(screen.getByTestId('last-seen-nobody')).toHaveTextContent('Nobody was online at the last export.');
        expect(screen.queryByTestId('last-seen-headline')).toBeNull();
        expect(screen.queryByRole('list', { name: 'Longest away' })).toBeNull();
    });

    it('shows the no-export state before any presence-bearing import', async () => {
        await renderWith({ reported: 0, onlineCount: 0, online: [], away: [] });
        const empty = screen.getByTestId('last-seen-empty');
        expect(empty).toHaveTextContent('No online data yet.');
        expect(empty).toHaveTextContent('Shows up when an officer exports the roster from LedgerLink.');
        expect(screen.queryByTestId('last-seen-headline')).toBeNull();
    });
});

describe('LastSeenWidget footer', () => {
    it('dates the footer by the guild snapshot time, not the roster fact freshness', async () => {
        // Roster facts are fresh ("just now"); the presence export is 20 days old.
        const snapshot = new Date(Date.now() - 20 * 86_400_000).toISOString();
        await renderWith(POPULATED, snapshot);
        const footer = screen.getByTestId('forever-freshness');
        expect(footer).toHaveTextContent('via LedgerLink · as of 20 days ago');
        expect(footer).toHaveAttribute('data-stale', 'true');
        expect(footer).toHaveAttribute('title', `Roster exported ${new Date(snapshot).toLocaleString()}`);
    });

    it('shows no date in the footer before any guild snapshot, even with fresh roster facts', async () => {
        await renderWith(POPULATED, null);
        expect(screen.getByTestId('forever-freshness')).toHaveTextContent(/^via LedgerLink$/);
    });
});

describe('useLastSeenVisible', () => {
    function wrapper({ children }: { children: ReactNode }): JSX.Element {
        return <QueryClientProvider client={createTestQueryClient()}>{children}</QueryClientProvider>;
    }

    it('hides the card for a visitor payload (no lastSeen key)', async () => {
        let served = false;
        server.use(rosterInsightsHandler({ all: VISITOR_FIXTURE, onRequest: () => { served = true; } }));
        const { result } = renderHook(() => useLastSeenVisible(ctx()), { wrapper });
        await waitFor(() => expect(served).toBe(true));
        await waitFor(() => expect(result.current).toBe(false));
    });

    it('shows the card for a member payload, even before any presence export', async () => {
        server.use(rosterInsightsHandler({ all: insights({ reported: 0, onlineCount: 0, online: [], away: [] }) }));
        const { result } = renderHook(() => useLastSeenVisible(ctx()), { wrapper });
        await waitFor(() => expect(result.current).toBe(true));
    });
});

describe('lastSeenWidget registration', () => {
    it('is the Forever guild "Last seen" card at order 87 with the Members see-all action', () => {
        expect(lastSeenWidget).toMatchObject({
            id: 'forever-last-seen', title: 'Last seen', order: 87, span: 1, audience: 'everyone',
            games: ['world-of-warcraft-forever'], kinds: ['wow_guild'],
        });
        expect(lastSeenWidget.action).toBe(MembersSeeAll);
    });
});
