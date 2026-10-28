/** ROK-1930 — the hub Overview Deaths card: bars, links, Show all, counted-since, and the hide rules. */
import { beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { renderHook } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { JSX, ReactNode } from 'react';
import { Route, Routes, useLocation } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import type { GuildPage } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { createTestQueryClient, renderWithProviders } from '../../../test/render-helpers';
import { valheimDeathPlayer, valheimDeathsFixture, valheimDeathsHandler } from '../../../test/mocks/valheim-deaths-handlers';
import { useTimezoneStore } from '../../../stores/timezone-store';
import type { HubWidgetCtx } from '../../hub-game-widgets';
import { useDeathsWidgetVisible, useValheimDeaths } from '../hooks/use-valheim-deaths';
import ValheimDeathsWidget from './valheim-deaths-widget';
import { ValheimDeathsShowAll } from './valheim-deaths-show-all';

function ctx(): HubWidgetCtx {
    const page = {
        guild: { id: 5 },
        server: { pelicanServerId: 7, gameSlug: 'valheim', gameIconUrl: null, state: 'running', viewerJoined: false },
        viewer: { role: 'member', canEdit: false, canManageEditors: false },
    } as GuildPage;
    // The widget reads only `page.guild.id` and `page.server`; the rest of the hub ctx is never touched (register.test idiom).
    return { page, gameSlug: 'valheim' } as HubWidgetCtx;
}

const Widget = (): JSX.Element => <ValheimDeathsWidget {...ctx()} />;
const rows = (): HTMLElement[] => screen.getAllByTestId('valheim-deaths-row');

function must<T>(value: T | null | undefined, label: string): T {
    if (value === null || value === undefined) throw new Error(`missing: ${label}`);
    return value;
}

/** The character route's stand-in: prints the router state the name link sent. */
function StateProbe(): JSX.Element {
    return <pre data-testid="state-probe">{JSON.stringify(useLocation().state)}</pre>;
}

function probe() {
    const client = createTestQueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    // The same query key as the probe, so `query` reports when the response has landed.
    return renderHook(() => ({ visible: useDeathsWidgetVisible(ctx()), query: useValheimDeaths(7) }), { wrapper });
}

beforeEach(() => {
    useTimezoneStore.setState({ resolved: 'UTC' });
});

describe('ValheimDeathsWidget', () => {
    it('draws one bar per player in served order, scaled to the top player', async () => {
        server.use(valheimDeathsHandler());
        renderWithProviders(<Widget />);
        await waitFor(() => expect(rows()).toHaveLength(3));
        expect(rows().map((r) => r.dataset.key)).toEqual(['c11', 'c12', 'nLeft-the-hub']);
        const values = screen.getAllByRole('meter').map((m) => m.getAttribute('aria-valuenow'));
        expect(values).toEqual(['100', '50', '25']);
    });

    it('shows at most 8 bars', async () => {
        const players = Array.from({ length: 10 }, (_, i) => valheimDeathPlayer({ name: `P${i}`, deaths: 20 - i, characterId: i + 1 }));
        server.use(valheimDeathsHandler({ players, since: null }));
        renderWithProviders(<Widget />);
        await waitFor(() => expect(rows()).toHaveLength(8));
        expect(screen.queryByTestId('valheim-deaths-since')).toBeNull();
    });

    it('shows a muted "Counted since" line in the viewer timezone', async () => {
        server.use(valheimDeathsHandler());
        renderWithProviders(<Widget />);
        const since = await screen.findByTestId('valheim-deaths-since');
        expect(since.textContent).toMatch(/^Counted since .*Oct.*2026$/);
        expect(since.className).toContain('text-muted');
    });

    it('renders nothing for a visitor (the route 404s) — no error card', async () => {
        server.use(valheimDeathsHandler(valheimDeathsFixture, 404));
        const { container } = renderWithProviders(<Widget />);
        const { result } = probe();
        await waitFor(() => expect(result.current.query.isError).toBe(true));
        expect(result.current.visible).toBe(false);
        await waitFor(() => expect(screen.queryByTestId('valheim-deaths-row')).toBeNull());
        expect(container.innerHTML).toBe('');
        expect(screen.queryByRole('alert')).toBeNull();
    });
});

describe('ValheimDeathsWidget — row links (ROK-2029)', () => {
    it('ROK-2029: the name opens the character page; the count + pin opens their death pins on the Map tab', async () => {
        server.use(valheimDeathsHandler());
        renderWithProviders(<Widget />);
        const name = await screen.findByRole('link', { name: "Open Ragnhild's character page" });
        expect(name.getAttribute('href')).toBe('/valheim/characters/11');
        expect(name.textContent).toBe('Ragnhild');
        const map = screen.getByRole('link', { name: "Show Ragnhild's 12 deaths on the map" });
        expect(map.getAttribute('href')).toBe('/?pins=death&vc=11#map');
        expect(map.textContent).toBe('12');
        // Two separate links per claimed row, neither inside the other.
        const row = must(rows()[0], 'first row');
        expect(within(row).getAllByRole('link')).toHaveLength(2);
        expect(name.contains(map) || map.contains(name)).toBe(false);
    });

    it('ROK-2029: both links are 44px touch targets', async () => {
        server.use(valheimDeathsHandler());
        renderWithProviders(<Widget />);
        const name = await screen.findByRole('link', { name: "Open Hrafn's character page" });
        const map = screen.getByRole('link', { name: "Show Hrafn's 6 deaths on the map" });
        expect(name.className).toContain('min-h-[44px]');
        expect(map.className).toContain('min-h-[44px]');
        expect(name.className).toContain('min-w-[44px]');
        expect(map.className).toContain('min-w-[44px]');
    });

    it('ROK-2029: a row without a character has no links — plain name and count', async () => {
        server.use(valheimDeathsHandler());
        renderWithProviders(<Widget />);
        await waitFor(() => expect(rows()).toHaveLength(3));
        const unlinked = must(rows()[2], 'third row');
        expect(within(unlinked).queryByRole('link')).toBeNull();
        expect(within(unlinked).getByText('Left-the-hub')).toBeTruthy();
        expect(within(unlinked).getByText('3')).toBeTruthy();
    });

    it('ROK-2029: the name link sends the hub Characters tab (search kept) as the crumb target', async () => {
        server.use(valheimDeathsHandler());
        renderWithProviders(
            <Routes>
                <Route path="/hubs/:id" element={<Widget />} />
                <Route path="/valheim/characters/:id" element={<StateProbe />} />
            </Routes>,
            { initialEntries: ['/hubs/5?tab=overview'] },
        );
        await userEvent.click(await screen.findByRole('link', { name: "Open Ragnhild's character page" }));
        const probe = await screen.findByTestId('state-probe');
        expect(JSON.parse(probe.textContent ?? 'null')).toEqual({ hubPath: '/hubs/5?tab=overview#characters' });
    });
});

describe('useDeathsWidgetVisible', () => {
    it('is false while pending, true once a death is served', async () => {
        server.use(valheimDeathsHandler());
        const { result } = probe();
        expect(result.current.visible).toBe(false);
        await waitFor(() => expect(result.current.visible).toBe(true));
    });

    it('is false when nobody has died', async () => {
        server.use(valheimDeathsHandler({ players: [], since: null }));
        const { result } = probe();
        // Wait for the response to land before asserting it stays hidden.
        await waitFor(() => expect(result.current.query.isSuccess).toBe(true));
        expect(result.current.query.data?.players).toEqual([]);
        expect(result.current.visible).toBe(false);
    });
});

describe('ValheimDeathsShowAll', () => {
    it('links to the server-wide death layer on the Map tab', () => {
        renderWithProviders(<ValheimDeathsShowAll />);
        expect(screen.getByRole('link', { name: 'Show all' }).getAttribute('href')).toBe('/?pins=death&players=all#map');
    });
});
