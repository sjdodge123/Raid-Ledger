/**
 * ROK-1790 (Codex P2) — the Crafters tab's `visible` predicate reads the
 * roster-insights cache, which the hub frame does not itself query. The frame
 * must still re-evaluate the tab list when that query lands elsewhere on the
 * page (here a sibling, like the Overview professions widget), with no other
 * re-render of the strip.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { Route, Routes } from 'react-router-dom';
import type { JSX } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { GuildPage as GuildPageDto, GuildRaidsDto } from '@raid-ledger/contract';
import { server } from '../../../../test/mocks/server';
import { renderWithProviders } from '../../../../test/render-helpers';
import { activateWowPlugin } from '../../../../test/activate-wow-plugin';
import { NO_PROFESSIONS_FIXTURE, PROFESSIONS_FIXTURE, rosterInsightsHandler } from '../../../../test/handlers/forever-hub-widgets';
import { queryClient } from '../../../../lib/query-client';
import type { HubCtx } from '../../../hub-module';
import { useHubTabs } from '../../../../components/hub/use-hub-tabs';
import { GuildPage } from '../../../../components/hub/hub-page';
import { visibleHubTabIds } from '../../../../components/hub/hub-tabs';
import { rosterInsightsKey, useRosterInsights } from '../../hub-widgets/use-roster-insights';
import { WOW_FOREVER_GAME_SLUG } from '../../lib/forever-identity';

vi.mock('../../../../hooks/use-auth', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../../hooks/use-auth')>()),
    useAuth: () => ({ user: { id: 1, role: 'member' }, isAuthenticated: true }),
}));

const PAGE: GuildPageDto = {
    guild: { id: 7, gameId: 3, kind: 'wow_guild', name: 'Hub', region: 'us', realmSlug: null, realmName: null, faction: null,
        memberCount: 5, lastSnapshotAt: null, gameSlug: WOW_FOREVER_GAME_SLUG },
    importedBy: null,
    viewer: { role: 'member', canEdit: false, canManageEditors: false },
    ranks: [],
    roleCounts: { tank: 0, healer: 0, dps: 0, unknown: 0 },
};

/**
 * The tab strip — re-renders only through `useHubTabs`. Its `raids` query is
 * disabled and keyed apart, so it never notifies on the roster-insights fetch.
 */
function Strip(): JSX.Element {
    const raids = useQuery<GuildRaidsDto, Error>({ queryKey: ['test', 'raids'], queryFn: () => Promise.reject(new Error('unused')), enabled: false });
    const ctx: HubCtx = { page: PAGE, raids };
    const tabs = useHubTabs(undefined, ctx, false, false);
    return <ul aria-label="Hub tabs">{visibleHubTabIds(tabs).map((id) => <li key={id}>{id}</li>)}</ul>;
}

/** Stands in for the Overview professions widget: it owns the roster-insights query. */
function InsightsConsumer(): JSX.Element {
    const q = useRosterInsights(PAGE.guild.id);
    return <p>{q.isSuccess ? 'insights:loaded' : 'insights:pending'}</p>;
}

function renderHub(): void {
    renderWithProviders(<><InsightsConsumer /><Strip /></>, { queryClient });
}

beforeEach(() => {
    activateWowPlugin();
    queryClient.clear();
    queryClient.setQueryData(['auth', 'me'], { id: 1, role: 'member' });
});

afterEach(() => {
    queryClient.clear();
});

describe('Crafters tab visibility follows the roster-insights cache', () => {
    it('shows before the query lands, then hides once it lands with no professions — no other interaction', async () => {
        server.use(rosterInsightsHandler({ all: NO_PROFESSIONS_FIXTURE }));
        renderHub();
        expect(screen.getByText('crafters')).toBeInTheDocument();
        await screen.findByText('insights:loaded');
        await waitFor(() => {
            expect(screen.queryByText('crafters'), 'Crafters tab still shown after an empty-professions payload landed').toBeNull();
        });
    });

    it('comes back when profession data appears in the cache', async () => {
        server.use(rosterInsightsHandler({ all: NO_PROFESSIONS_FIXTURE }));
        renderHub();
        await waitFor(() => expect(screen.queryByText('crafters')).toBeNull());
        act(() => {
            queryClient.setQueryData(rosterInsightsKey(PAGE.guild.id, false, 1), PROFESSIONS_FIXTURE);
        });
        expect(await screen.findByText('crafters')).toBeInTheDocument();
    });
});

/** The tab labels the REAL hub frame (`hub-page.tsx` `HubFrame`) renders. */
function frameTabLabels(): (string | null)[] {
    const nav = screen.getByRole('navigation', { name: 'Guild page sections' });
    return within(nav).getAllByRole('link').map((a) => a.textContent);
}

/**
 * Covers the wiring, not just the hook: `HubFrame` must build its strip with
 * `useHubTabs`. Every write below is a `setQueryData` on the roster-insights
 * key only, made once the page is idle. That notifies the insights observers
 * (descendants of the frame), never the page/raids/profile queries the frame
 * and its parent render from — so if `hub-page.tsx` went back to a plain
 * `hubTabs()` call, nothing would re-render the strip and the `waitFor` below
 * fails on its own message, with Crafters still listed.
 */
describe('the real hub frame re-evaluates the Crafters tab on a cache change', () => {
    const defaults = queryClient.getDefaultOptions();
    beforeEach(() => { queryClient.setDefaultOptions({ ...defaults, queries: { ...defaults.queries, retry: false } }); });
    afterEach(() => { queryClient.setDefaultOptions(defaults); window.location.hash = ''; });

    it('hides Crafters when professions vanish from the cache, and shows it when they return', async () => {
        server.use(http.get('http://localhost:3000/guilds/7', () => HttpResponse.json(PAGE)), rosterInsightsHandler({ all: PROFESSIONS_FIXTURE }));
        renderWithProviders(<Routes><Route path="/hubs/:id" element={<GuildPage />} /></Routes>, { initialEntries: ['/hubs/7'], queryClient });
        await waitFor(() => expect(frameTabLabels()).toContain('Crafters'));
        await waitFor(() => expect(queryClient.isFetching()).toBe(0), { timeout: 4000 });
        act(() => { queryClient.setQueryData(rosterInsightsKey(PAGE.guild.id, false, 1), NO_PROFESSIONS_FIXTURE); });
        await waitFor(() => {
            expect(frameTabLabels(), 'HubFrame kept Crafters after the cache lost every profession').not.toContain('Crafters');
        });
        act(() => { queryClient.setQueryData(rosterInsightsKey(PAGE.guild.id, false, 1), PROFESSIONS_FIXTURE); });
        await waitFor(() => {
            expect(frameTabLabels(), 'HubFrame did not bring Crafters back when professions returned').toContain('Crafters');
        });
    });
});
