/** ROK-1854 / ROK-1899 — the hub Planner tab: row pick → tree, UPGRADE step, funnel → plan + stock keys, shopping list + storage, empty + no-stock. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../../test/mocks/server';
import { renderWithProviders } from '../../../test/render-helpers';
import { materialsFixture, valheimMaterialsHandler } from '../../../test/mocks/valheim-materials-handlers';
import {
    VALHEIM_RECIPE_PLAN_URL,
    recipeCatalogEmpty,
    recipeCatalogFixture,
    valheimRecipeCatalogHandler,
    valheimRecipePlanHandler,
    valheimRecipeStockHandler,
    valheimRecipeTreeHandler,
} from '../../../test/mocks/valheim-recipes-handlers';
import { PLANNER_NO_SET_COPY, PLANNER_NO_STOCK_COPY } from './planner.helpers';
import { plannerStorageKey } from './planner-storage';
import { ValheimPlannerTab } from './valheim-planner-tab';

const media = vi.hoisted(() => ({ desktop: true }));
vi.mock('../../../hooks/use-media-query', () => ({ useMediaQuery: () => media.desktop }));
vi.mock('../../../hooks/use-auth', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../hooks/use-auth')>()),
    getAuthToken: vi.fn(() => 'test-token'),
}));

const KEY = plannerStorageKey(7);
const STORED = JSON.stringify([{ prefab: 'SwordIron', kind: 'item', quality: 1, amount: 2 }]);
/** What a fresh add saves (ROK-1899: fromQuality persisted; STORED is the older shape, still loaded). */
const SAVED = JSON.stringify([{ prefab: 'SwordIron', kind: 'item', quality: 1, fromQuality: 0, amount: 2 }]);
let treeHits: string[];
let planHits: string[];
let stockHits: string[];

const renderTab = () => renderWithProviders(<ValheimPlannerTab serverId={7} />);

const searchBox = () => screen.getByRole('searchbox', { name: 'Search an item or piece' });

/** ROK-1899: the crafting window's Forge list replaces the combobox. */
async function pickIronSword(user: ReturnType<typeof userEvent.setup>): Promise<void> {
    const list = await screen.findByRole('list', { name: 'Forge recipes' });
    await user.click(within(list).getByRole('button', { name: /^Iron sword/ }));
}

beforeEach(() => {
    media.desktop = true;
    localStorage.clear();
    treeHits = [];
    planHits = [];
    stockHits = [];
    server.use(
        valheimRecipeStockHandler(stockHits),
        valheimRecipeCatalogHandler(),
        valheimRecipeTreeHandler(treeHits),
        valheimRecipePlanHandler(planHits),
        valheimMaterialsHandler(materialsFixture()),
    );
});
afterEach(() => vi.restoreAllMocks());

describe('ValheimPlannerTab', () => {
    it('picks a target and renders its Iron branch from the plan route, with the viewer\'s haves', async () => {
        const user = userEvent.setup();
        renderTab();
        expect(await screen.findByTestId('valheim-planner-header')).toHaveTextContent('Recipes from 0.220.5');
        await pickIronSword(user);
        const tree = await screen.findByRole('list', { name: 'What Iron sword needs' });
        const rows = within(tree).getAllByTestId('valheim-planner-row').map((r) => r.textContent ?? '');
        const names = within(tree).getAllByTestId('valheim-planner-row-name').map((n) => n.textContent);
        // Gathered leaves sit outside the recipe catalogue; the tree's own `items` record names them.
        expect(names).toEqual(['Iron sword', 'Iron', 'Iron scrap', 'Coal', 'Wood', 'Leather scraps']);
        expect(rows[0]).toContain('Forge · lvl 1');
        expect(rows[1]).toContain('Smelter · 31 s');
        expect(rows[2]).toContain('Gathered');
        // The plan route carries stock, so the breakdown shows real haves (the tree route had "Have —").
        expect(rows[1]).toContain('Need 20 · Have 0 · Short 20');
        expect(planHits).toContain('?targets=SwordIron%3A1%3A1%3A0%3Aitem&includePersonal=false&includeVehicles=true');
        expect(treeHits).toEqual([]);
    });

    it('UPGRADE: the chosen step re-requests the breakdown, and the list stores and labels it q2→3', async () => {
        const user = userEvent.setup();
        renderTab();
        await user.click(await screen.findByRole('radio', { name: /UPGRADE/ }));
        const list = await screen.findByRole('list', { name: 'Forge upgrades' });
        await user.click(within(list).getByRole('button', { name: /^Iron sword/ }));
        await user.selectOptions(screen.getByRole('combobox', { name: 'Upgrade to quality' }), '3');
        await waitFor(() => expect(planHits).toContain('?targets=SwordIron%3A3%3A1%3A2%3Aitem&includePersonal=false&includeVehicles=true'));
        expect(await screen.findByRole('list', { name: 'What Iron sword needs' })).toBeInTheDocument();
        expect(treeHits).toEqual([]);
        await user.click(screen.getByRole('button', { name: 'Add to list' }));
        expect(await screen.findByRole('list', { name: 'Planned items' })).toHaveTextContent('Iron sword · q2→3 × 1');
        expect(localStorage.getItem(KEY)).toBe(JSON.stringify([{ prefab: 'SwordIron', kind: 'item', quality: 3, fromQuality: 2, amount: 1 }]));
    });

    it('adds to the shopping list, persists it, and removes it', async () => {
        const user = userEvent.setup();
        renderTab();
        await pickIronSword(user);
        const amount = screen.getByRole('spinbutton', { name: 'Amount' });
        await user.clear(amount);
        await user.type(amount, '2');
        await user.click(screen.getByRole('button', { name: 'Add to list' }));
        // The breakdown (q1 × 2) and the list plan share this target, so either may have sent it.
        await waitFor(() => expect(planHits.join(' ')).toContain('targets=SwordIron%3A1%3A2'));
        const list = await screen.findByRole('region', { name: 'Shopping list' });
        expect(await within(list).findByRole('cell', { name: 'Leather scraps' })).toBeInTheDocument();
        await waitFor(() => expect(screen.getByTestId('valheim-planner-header')).toHaveTextContent(/Chests scanned [67] min ago/));
        expect(localStorage.getItem(KEY)).toBe(SAVED);
        await user.click(within(list).getByRole('button', { name: 'Remove Iron sword' }));
        expect(screen.queryByRole('region', { name: 'Shopping list' })).toBeNull();
        expect(localStorage.getItem(KEY)).toBeNull();
    });

    it('restores the stored list on mount', async () => {
        localStorage.setItem(KEY, STORED);
        renderTab();
        const planned = await screen.findByRole('list', { name: 'Planned items' });
        expect(planned).toHaveTextContent('Iron sword · q1 × 2');
        await waitFor(() => expect(planHits).toHaveLength(1));
    });

    it('still works when storage throws', async () => {
        const { getItem, setItem } = Storage.prototype;
        // Only the planner key throws — auth reads storage too.
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, k: string) {
            if (k === KEY) throw new Error('blocked');
            return getItem.call(this, k);
        });
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k: string, v: string) {
            if (k === KEY) throw new Error('blocked');
            setItem.call(this, k, v);
        });
        const user = userEvent.setup();
        renderTab();
        await pickIronSword(user);
        await user.click(screen.getByRole('button', { name: 'Add to list' }));
        expect(await screen.findByRole('list', { name: 'Planned items' })).toHaveTextContent('Iron sword');
    });

    it('the carts-and-ships switch changes the plan request; no personal switch without personal chests', async () => {
        localStorage.setItem(KEY, STORED);
        const user = userEvent.setup();
        renderTab();
        await waitFor(() => expect(planHits).toHaveLength(1));
        expect(planHits[0]).toContain('includeVehicles=true');
        await user.click(screen.getByRole('button', { name: /Filters/ }));
        expect(screen.queryByRole('switch', { name: 'Include my personal chests' })).toBeNull();
        await user.click(screen.getByRole('switch', { name: 'Include carts and ships' }));
        await waitFor(() => expect(planHits).toHaveLength(2));
        expect(planHits[1]).toContain('includeVehicles=false');
        expect(planHits[1]).toContain('includePersonal=false');
        await waitFor(() => expect(stockHits.at(-1)).toContain('includeVehicles=false'));
    });

    it('shows the empty state while the server has sent no recipes', async () => {
        server.use(valheimRecipeCatalogHandler(recipeCatalogEmpty));
        renderTab();
        expect(await screen.findByText(PLANNER_NO_SET_COPY)).toBeInTheDocument();
    });

    it('says so when there is no chest scan, with have as a dash', async () => {
        server.use(valheimRecipePlanHandler(planHits, null));
        localStorage.setItem(KEY, STORED);
        renderTab();
        expect(await screen.findByText(PLANNER_NO_STOCK_COPY)).toBeInTheDocument();
        const tree = screen.getByRole('list', { name: 'What your list needs' });
        expect(within(tree).getAllByTestId('valheim-planner-row')[1]).toHaveTextContent('Need 40 · Have —');
    });
    it('remounts per server: a cached second hub never shows or saves the first hub\'s list', async () => {
        localStorage.setItem(KEY, STORED);
        const view = renderWithProviders(<ValheimPlannerTab serverId={7} />);
        expect(await screen.findByRole('list', { name: 'Planned items' })).toHaveTextContent('Iron sword');
        view.rerender(<ValheimPlannerTab serverId={8} />);
        await screen.findByRole('searchbox', { name: 'Search an item or piece' });
        view.rerender(<ValheimPlannerTab serverId={7} />);
        expect(await screen.findByRole('list', { name: 'Planned items' })).toHaveTextContent('Iron sword');
        view.rerender(<ValheimPlannerTab serverId={8} />); // both catalogues cached now
        await waitFor(() => expect(screen.queryByRole('list', { name: 'Planned items' })).toBeNull());
        expect(localStorage.getItem(plannerStorageKey(8))).toBeNull();
        expect(localStorage.getItem(KEY)).toBe(STORED);
    });

    it('removing the last target clears the plan tree back to the idle prompt', async () => {
        localStorage.setItem(KEY, STORED);
        const user = userEvent.setup();
        renderTab();
        expect(await screen.findByRole('list', { name: 'What your list needs' })).toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'Remove Iron sword' }));
        await waitFor(() => expect(screen.queryByRole('list', { name: 'What your list needs' })).toBeNull());
        expect(screen.getByText('Pick an item or piece to see what it takes.')).toBeInTheDocument();
    });

    it('editing the search after a pick keeps the pick and never writes into the box (ROK-1899 §3.1.4)', async () => {
        const user = userEvent.setup();
        renderTab();
        await pickIronSword(user);
        expect(await screen.findByRole('list', { name: 'What Iron sword needs' })).toBeInTheDocument();
        expect(searchBox()).toHaveValue('');
        await user.type(searchBox(), 'x');
        expect(await screen.findByText('No recipes match.')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Add to list' })).toBeEnabled();
        expect(screen.getByRole('list', { name: 'What Iron sword needs' })).toBeInTheDocument();
    });

    it('clearing the search restores the last station', async () => {
        const user = userEvent.setup();
        renderTab();
        await user.click(await screen.findByRole('radio', { name: 'Workbench' }));
        await user.type(searchBox(), 'iron');
        expect(await screen.findByRole('list', { name: 'Matches from every station' })).toBeInTheDocument();
        expect(screen.getByRole('radio', { name: 'Workbench' })).not.toBeChecked();
        await user.clear(searchBox());
        expect(screen.getByRole('radio', { name: 'Workbench' })).toBeChecked();
        expect(screen.getByRole('list', { name: 'Workbench recipes' })).toBeInTheDocument();
    });

    it('a failed plan shows an error with Retry, not the idle prompt; Retry recovers', async () => {
        server.use(http.get(VALHEIM_RECIPE_PLAN_URL, () => HttpResponse.json({ message: 'boom' }, { status: 500 })));
        localStorage.setItem(KEY, STORED);
        const user = userEvent.setup();
        renderTab();
        await waitFor(() => expect(screen.queryByRole('alert')?.textContent ?? 'no alert').toContain('Couldn’t load your list’s plan.'));
        expect(screen.queryByText('Pick an item or piece to see what it takes.')).toBeNull();
        server.use(valheimRecipePlanHandler(planHits));
        await user.click(screen.getByRole('button', { name: 'Retry' }));
        expect(await screen.findByRole('list', { name: 'What your list needs' })).toBeInTheDocument();
    });

    it('a failed breakdown plan shows an error naming the pick', async () => {
        server.use(http.get(VALHEIM_RECIPE_PLAN_URL, () => HttpResponse.json({ message: 'boom' }, { status: 500 })));
        const user = userEvent.setup();
        renderTab();
        await pickIronSword(user);
        await waitFor(() => expect(screen.queryByRole('alert')?.textContent ?? 'no alert').toContain('Couldn’t load what Iron sword needs.'));
        expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    });

    it('an item and a piece sharing a prefab keep their own names', async () => {
        const base = recipeCatalogFixture();
        const shared = { prefab: 'Shared', category: 'Misc', icon: null, maxQuality: 1, sources: { recipes: 1, processes: 0 }, craft: null, upgrades: [] };
        server.use(valheimRecipeCatalogHandler({
            ...base,
            entries: [...base.entries, { ...shared, kind: 'item', name: 'Shared item' }, { ...shared, kind: 'piece', name: 'Shared piece' }],
        }));
        localStorage.setItem(KEY, JSON.stringify([
            { prefab: 'Shared', kind: 'item', quality: 1, amount: 1 },
            { prefab: 'Shared', kind: 'piece', quality: 1, amount: 1 },
        ]));
        renderTab();
        const planned = await screen.findByRole('list', { name: 'Planned items' });
        expect(within(planned).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
            expect.stringContaining('Shared item · q1 × 1'),
            expect.stringContaining('Shared piece × 1'),
        ]);
        const tree = await screen.findByRole('list', { name: 'What your list needs' });
        expect(within(tree).getAllByTestId('valheim-planner-row-name').map((n) => n.textContent)).toEqual(['Shared item', 'Shared piece']);
    });
});
