/** ROK-1854 — the hub Planner tab: pick → tree, quality, funnel → plan key, shopping list + storage, empty + no-stock. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { server } from '../../../test/mocks/server';
import { renderWithProviders } from '../../../test/render-helpers';
import { materialsFixture, valheimMaterialsHandler } from '../../../test/mocks/valheim-materials-handlers';
import {
    recipeCatalogEmpty,
    valheimRecipeCatalogHandler,
    valheimRecipePlanHandler,
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
let treeHits: string[];
let planHits: string[];

const renderTab = () => renderWithProviders(<ValheimPlannerTab serverId={7} />);

async function pickIronSword(user: ReturnType<typeof userEvent.setup>): Promise<void> {
    await user.type(await screen.findByRole('combobox', { name: 'Search an item or piece' }), 'iron s');
    await user.click(await screen.findByRole('option', { name: /Iron sword/ }));
}

beforeEach(() => {
    media.desktop = true;
    localStorage.clear();
    treeHits = [];
    planHits = [];
    server.use(
        valheimRecipeCatalogHandler(),
        valheimRecipeTreeHandler(treeHits),
        valheimRecipePlanHandler(planHits),
        valheimMaterialsHandler(materialsFixture()),
    );
});
afterEach(() => vi.restoreAllMocks());

describe('ValheimPlannerTab', () => {
    it('picks a target and renders its Iron branch from the tree route', async () => {
        const user = userEvent.setup();
        renderTab();
        expect(await screen.findByTestId('valheim-planner-header')).toHaveTextContent('Recipes from 0.220.5');
        await pickIronSword(user);
        const tree = await screen.findByRole('list', { name: 'What Iron sword needs' });
        const rows = within(tree).getAllByTestId('valheim-planner-row').map((r) => r.textContent ?? '');
        const names = within(tree).getAllByTestId('valheim-planner-row-name').map((n) => n.textContent);
        // The tree route carries no `items` record (contract), so leaves outside the catalogue fall back to the prefab.
        expect(names).toEqual(['Iron sword', 'Iron', 'IronScrap', 'Coal', 'Wood', 'LeatherScraps']);
        expect(rows[0]).toContain('Forge · lvl 1');
        expect(rows[1]).toContain('Smelter · 31 s');
        expect(rows[2]).toContain('Gathered');
        expect(rows[1]).toContain('Need 20 · Have —');
        expect(treeHits).toEqual(['SwordIron?quality=1&kind=item']);
    });

    it('re-requests the tree when the quality changes', async () => {
        const user = userEvent.setup();
        renderTab();
        await pickIronSword(user);
        await user.selectOptions(await screen.findByRole('combobox', { name: 'Quality' }), '3');
        await waitFor(() => expect(treeHits).toContain('SwordIron?quality=3&kind=item'));
        const tree = await screen.findByRole('list', { name: 'What Iron sword needs' });
        await waitFor(() => expect(within(tree).getAllByTestId('valheim-planner-row')[1]).toHaveTextContent('Need 40'));
    });

    it('adds to the shopping list, persists it, and removes it', async () => {
        const user = userEvent.setup();
        renderTab();
        await pickIronSword(user);
        const amount = screen.getByRole('spinbutton', { name: 'Amount' });
        await user.clear(amount);
        await user.type(amount, '2');
        await user.click(screen.getByRole('button', { name: 'Add to list' }));
        await waitFor(() => expect(planHits[0]).toContain('targets=SwordIron%3A1%3A2'));
        const list = await screen.findByRole('region', { name: 'Shopping list' });
        expect(await within(list).findByRole('cell', { name: 'Leather scraps' })).toBeInTheDocument();
        await waitFor(() => expect(screen.getByTestId('valheim-planner-header')).toHaveTextContent(/Chests scanned [67] min ago/));
        expect(localStorage.getItem(KEY)).toBe(STORED);
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
});
