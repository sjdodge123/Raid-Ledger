/** ROK-1899 — the crafting window: greying, detail slots, search, UPGRADE add, no scan, stock error, phone sheet, keyboard. */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useState, type JSX } from 'react';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { ValheimRecipeCatalogResponse } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { renderWithProviders } from '../../../test/render-helpers';
import {
    recipeCatalogFixture,
    VALHEIM_RECIPE_STOCK_URL,
    valheimRecipePlanHandler,
    valheimRecipeStockHandler,
    valheimRecipeTreeHandler,
} from '../../../test/mocks/valheim-recipes-handlers';
import { CRAFT_ENTRIES, CRAFT_STATIONS, CRAFT_TOTALS } from './crafting.test-fixture';
import { CraftingWindow } from './crafting-window';
import { CRAFT_NO_SCAN_COPY, DEFAULT_PLANNER_FILTERS, serializeTargets, type PlannerFilters, type PlannerTarget } from './planner.helpers';
import type { PlannerNames } from './use-planner-names';

const media = vi.hoisted(() => ({ desktop: true }));
vi.mock('../../../hooks/use-media-query', () => ({ useMediaQuery: () => media.desktop }));
vi.mock('../../../hooks/use-auth', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../hooks/use-auth')>()),
    getAuthToken: vi.fn(() => 'test-token'),
}));

const catalog: ValheimRecipeCatalogResponse = { ...recipeCatalogFixture(), entries: CRAFT_ENTRIES, stations: CRAFT_STATIONS, ingredients: {} };
const byPrefab = new Map(CRAFT_ENTRIES.map((e) => [e.prefab, e.name]));
const names: PlannerNames = {
    nameOf: (p) => byPrefab.get(p) ?? p,
    stationName: (p) => CRAFT_STATIONS.find((s) => s.prefab === p)?.name ?? p,
    ctxFor: () => ({ serverId: 7, items: {}, atlas: null, atlasUrl: null }),
};
let added: PlannerTarget[];
let planHits: string[];

function Harness(): JSX.Element {
    const [filters, setFilters] = useState<PlannerFilters>(DEFAULT_PLANNER_FILTERS);
    const onAdd = (t: PlannerTarget): boolean => (added.push(t), true);
    return <CraftingWindow serverId={7} catalog={catalog} filters={filters} onFilters={setFilters} hasPersonal={false}
        names={names} onAdd={onAdd} atCap={false} idle={<p>Pick an item or piece to see what it takes.</p>} />;
}

const renderWindow = () => renderWithProviders(<Harness />);
const search = () => screen.getByRole('searchbox', { name: 'Search an item or piece' });

beforeEach(() => {
    media.desktop = true;
    added = [];
    planHits = [];
    server.use(valheimRecipeStockHandler([], { ...CRAFT_TOTALS }), valheimRecipeTreeHandler([]), valheimRecipePlanHandler(planHits));
});

describe('CraftingWindow', () => {
    it('greys a short Forge row with the glyph and the full shortfall', async () => {
        renderWindow();
        expect(screen.getByRole('radio', { name: 'Forge' })).toBeChecked();
        const bronze = await screen.findByRole('button', { name: 'Bronze' });
        await waitFor(() => expect(bronze).toHaveAttribute('aria-description', "Can't craft yet: need 1 more Tin"));
        expect(bronze).toHaveTextContent('⊘');
        expect(bronze).toHaveAttribute('data-afford', 'short');
    });

    it('selecting a row shows the accent title, the star slot and a short Tin slot', async () => {
        const user = userEvent.setup();
        renderWindow();
        const bronze = await screen.findByRole('button', { name: 'Bronze' });
        await waitFor(() => expect(bronze).toHaveAttribute('data-afford', 'short'));
        await user.click(bronze);
        expect(bronze).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('heading', { name: 'Bronze' })).toBeInTheDocument();
        expect(screen.getByTestId('valheim-craft-meta')).toHaveTextContent('Material · Forge lvl 1 · max quality 1');
        expect(screen.getByRole('listitem', { name: 'Forge, level 1' })).toHaveTextContent('lvl 1');
        const tin = screen.getByRole('listitem', { name: 'Tin: need 1, you have 0, 1 short' });
        expect(tin).toHaveTextContent('you have 0 · 1 short');
        expect(tin).toHaveAttribute('data-short', 'true');
        expect(screen.getByRole('listitem', { name: 'Copper: need 2, you have 40' })).toHaveTextContent('you have 40');
        expect(screen.getByText('Full breakdown').closest('details')).toHaveAttribute('open');
    });

    it('search spans stations with a station suffix; a pick never writes into the box', async () => {
        const user = userEvent.setup();
        renderWindow();
        await user.type(search(), 'bro');
        const list = await screen.findByRole('list', { name: 'Matches from every station' });
        expect(within(list).getByRole('button', { name: /^Bronze buckler/ })).toHaveTextContent('Workbench');
        expect(within(list).getByRole('button', { name: /^Bronze axe/ })).toHaveTextContent('Forge');
        const stations = screen.getByRole('radiogroup', { name: 'Crafting station' });
        expect(within(stations).getAllByRole('radio').filter((r) => (r as HTMLInputElement).checked)).toEqual([]);
        await user.click(within(list).getByRole('button', { name: /^Bronze buckler/ }));
        expect(search()).toHaveValue('bro');
        expect(screen.getByRole('heading', { name: 'Bronze buckler' })).toBeInTheDocument();
    });

    it('nothing matching offers "Clear search and filters"', async () => {
        const user = userEvent.setup();
        renderWindow();
        await user.type(search(), 'zzz');
        expect(await screen.findByText('No recipes match.')).toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'Clear search and filters' }));
        expect(search()).toHaveValue('');
        expect(await screen.findByRole('list', { name: 'Forge recipes' })).toBeInTheDocument();
    });

    it('UPGRADE: "Upgrade to quality 3" changes the slots and adds the 2→3 step', async () => {
        const user = userEvent.setup();
        renderWindow();
        await user.click(screen.getByRole('radio', { name: /UPGRADE/ }));
        const list = await screen.findByRole('list', { name: 'Forge upgrades' });
        await user.click(within(list).getByRole('button', { name: /^Bronze axe/ }));
        expect(screen.getByRole('heading', { name: 'Bronze axe — quality 2' })).toBeInTheDocument();
        expect(screen.getByRole('listitem', { name: /^Bronze: need 4,/ })).toBeInTheDocument();
        await user.selectOptions(screen.getByRole('combobox', { name: 'Upgrade to quality' }), '3');
        expect(screen.getByRole('heading', { name: 'Bronze axe — quality 3' })).toBeInTheDocument();
        expect(screen.getByRole('listitem', { name: /^Bronze: need 6,/ })).toBeInTheDocument();
        expect(screen.getByRole('listitem', { name: 'Forge, level 3' })).toBeInTheDocument();
        await waitFor(() => expect(planHits.join('|')).toContain('targets=AxeBronze%3A3%3A1%3A2%3Aitem'));
        await user.click(screen.getByRole('button', { name: 'Add to list' }));
        expect(added).toEqual([{ prefab: 'AxeBronze', kind: 'item', quality: 3, fromQuality: 2, amount: 1 }]);
    });

    it('with no chest scan: the status line, no greying, slots read "no scan"', async () => {
        server.use(valheimRecipeStockHandler([], null));
        const user = userEvent.setup();
        renderWindow();
        expect(await screen.findByText(CRAFT_NO_SCAN_COPY)).toBeInTheDocument();
        const bronze = screen.getByRole('button', { name: 'Bronze' });
        expect(bronze).not.toHaveAttribute('aria-description');
        await user.click(bronze);
        expect(screen.getByRole('listitem', { name: 'Tin: need 1, no chest scan' })).toHaveTextContent('no scan');
    });

    it('a stock error keeps rows neutral and offers Retry', async () => {
        server.use(http.get(VALHEIM_RECIPE_STOCK_URL, () => HttpResponse.json({ message: 'boom' }, { status: 500 })));
        renderWindow();
        expect(await screen.findByRole('button', { name: 'Retry' })).toBeInTheDocument();
        expect(screen.getByRole('alert')).toHaveTextContent('Couldn’t check your chests.');
        expect(screen.getByRole('button', { name: 'Bronze' })).toHaveAttribute('data-afford', 'unknown');
    });

    it('slots read "checking…" while stock loads, never "no scan"', async () => {
        server.use(http.get(VALHEIM_RECIPE_STOCK_URL, () => new Promise<never>(() => undefined)));
        const user = userEvent.setup();
        renderWindow();
        await user.click(await screen.findByRole('button', { name: 'Bronze' }));
        expect(screen.getByRole('listitem', { name: 'Tin: need 1, checking your chests' })).toHaveTextContent('checking…');
    });

    it('slots read "unavailable" on a stock error, never "no scan"', async () => {
        server.use(http.get(VALHEIM_RECIPE_STOCK_URL, () => HttpResponse.json({ message: 'boom' }, { status: 500 })));
        const user = userEvent.setup();
        renderWindow();
        await screen.findByRole('button', { name: 'Retry' });
        await user.click(screen.getByRole('button', { name: 'Bronze' }));
        expect(screen.getByRole('listitem', { name: 'Tin: need 1, chest count unavailable' })).toHaveTextContent('unavailable');
    });

    it('the CRAFT breakdown reads the plan route for the pick at q1 × amount, so nodes carry real haves', async () => {
        const user = userEvent.setup();
        renderWindow();
        await user.click(await screen.findByRole('button', { name: 'Bronze' }));
        const sent = (): (string | null)[] => planHits.map((h) => new URLSearchParams(h).get('targets'));
        const q1 = (amount: number): string => serializeTargets([{ prefab: 'Bronze', kind: 'item', quality: 1, fromQuality: 0, amount }]);
        await waitFor(() => expect(sent()).toContain(q1(1)));
        const amount = screen.getByRole('spinbutton', { name: 'Amount' });
        await user.clear(amount);
        await user.type(amount, '3');
        await waitFor(() => expect(sent()).toContain(q1(3)));
    });

    it('a desktop pick does not pop the sheet when the viewport later narrows', async () => {
        const user = userEvent.setup();
        renderWindow();
        await user.click(await screen.findByRole('button', { name: 'Bronze' }));
        media.desktop = false;
        await user.type(search(), 'b');
        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('the phone sheet\'s collapsed breakdown fetches nothing until it is expanded', async () => {
        media.desktop = false;
        const user = userEvent.setup();
        renderWindow();
        await user.click(await screen.findByRole('button', { name: 'Bronze' }));
        const sheet = await screen.findByRole('dialog');
        const details = within(sheet).getByText('Full breakdown').closest('details');
        // Collapsed: neither the loading line nor a tree is mounted, so no request has fired.
        expect(details?.querySelector('summary + div')?.childElementCount).toBe(0);
        expect(planHits).toEqual([]);
        await user.click(within(sheet).getByText('Full breakdown'));
        await waitFor(() => expect(planHits).toHaveLength(1));
    });

    it('below DESKTOP_MQ a row opens the sheet; Escape returns focus to the row; an add closes it', async () => {
        media.desktop = false;
        const user = userEvent.setup();
        renderWindow();
        const bronze = await screen.findByRole('button', { name: 'Bronze' });
        await user.click(bronze);
        const sheet = await screen.findByRole('dialog');
        expect(within(sheet).getByRole('listitem', { name: /^Tin: need 1/ })).toBeInTheDocument();
        expect(screen.queryByRole('region', { name: 'Recipe detail' })).toBeNull();
        await user.keyboard('{Escape}');
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
        await waitFor(() => expect(bronze).toHaveFocus());
        await user.click(bronze);
        await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Add to list' }));
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
        expect(added).toEqual([{ prefab: 'Bronze', kind: 'item', quality: 1, fromQuality: 0, amount: 1 }]);
    });

    it('the list is one tab stop: Down/End/Home move focus, Enter selects', async () => {
        const user = userEvent.setup();
        renderWindow();
        const list = await screen.findByRole('list', { name: 'Forge recipes' });
        const rows = within(list).getAllByRole('button');
        expect(rows.filter((r) => r.tabIndex === 0)).toHaveLength(1);
        rows[0]?.focus();
        await user.keyboard('{ArrowDown}');
        expect(rows[1]).toHaveFocus();
        await user.keyboard('{End}');
        expect(rows[rows.length - 1]).toHaveFocus();
        await user.keyboard('{Home}');
        expect(rows[0]).toHaveFocus();
        await user.keyboard('{Enter}');
        expect(rows[0]).toHaveAttribute('aria-pressed', 'true');
    });

    it('desktop: Escape on the selected row clears the selection and the idle pane returns', async () => {
        const user = userEvent.setup();
        renderWindow();
        const bronze = await screen.findByRole('button', { name: 'Bronze' });
        await user.click(bronze);
        expect(await screen.findByRole('region', { name: 'Recipe detail' })).toBeInTheDocument();
        await user.keyboard('{Escape}');
        expect(screen.queryByRole('region', { name: 'Recipe detail' })).toBeNull();
        expect(screen.getByText('Pick an item or piece to see what it takes.')).toBeInTheDocument();
        expect(bronze).toHaveAttribute('aria-pressed', 'false');
    });

    it('desktop: "Back to your list" clears the selection and returns focus to the row', async () => {
        const user = userEvent.setup();
        renderWindow();
        const bronze = await screen.findByRole('button', { name: 'Bronze' });
        await user.click(bronze);
        const pane = await screen.findByRole('region', { name: 'Recipe detail' });
        const back = within(pane).queryByRole('button', { name: 'Back to your list' });
        expect(back, 'the pane header offers "Back to your list"').not.toBeNull();
        if (back === null) return;
        await user.click(back);
        expect(screen.queryByRole('region', { name: 'Recipe detail' })).toBeNull();
        expect(screen.getByText('Pick an item or piece to see what it takes.')).toBeInTheDocument();
        expect(bronze).toHaveAttribute('aria-pressed', 'false');
        expect(bronze).toHaveFocus();
    });

    it('desktop: Escape inside the pane clears the selection and focus lands back on the list', async () => {
        const user = userEvent.setup();
        renderWindow();
        const bronze = await screen.findByRole('button', { name: 'Bronze' });
        await user.click(bronze);
        const pane = await screen.findByRole('region', { name: 'Recipe detail' });
        await user.click(within(pane).getByRole('spinbutton', { name: 'Amount' }));
        await user.keyboard('{Escape}');
        expect(screen.queryByRole('region', { name: 'Recipe detail' })).toBeNull();
        expect(bronze).toHaveFocus();
    });

    it('desktop: "Back to your list" with no rows listed puts focus in the search box, not <body>', async () => {
        const user = userEvent.setup();
        renderWindow();
        await user.click(await screen.findByRole('button', { name: 'Bronze' }));
        await user.type(search(), 'zzz');
        await screen.findByRole('button', { name: 'Clear search and filters' });
        const pane = screen.getByRole('region', { name: 'Recipe detail' });
        await user.click(within(pane).getByRole('button', { name: 'Back to your list' }));
        expect(screen.queryByRole('region', { name: 'Recipe detail' })).toBeNull();
        expect(search(), 'focus falls back to the search box').toHaveFocus();
    });
});
