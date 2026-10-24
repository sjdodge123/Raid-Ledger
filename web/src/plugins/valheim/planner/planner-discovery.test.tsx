/** ROK-1862 — "Hide undiscovered": the funnel switch (disabled + hint), the chip, and hiding in lists and search. */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useState, type JSX } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ValheimPlanNode, ValheimRecipeCatalogEntry, ValheimRecipeCatalogResponse, ValheimRecipeDiscovery } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { renderWithProviders } from '../../../test/render-helpers';
import { recipeCatalogFixture, valheimRecipePlanHandler, valheimRecipeStockHandler, valheimRecipeTreeHandler } from '../../../test/mocks/valheim-recipes-handlers';
import { CRAFT_ENTRIES, CRAFT_STATIONS, CRAFT_TOTALS } from './crafting.test-fixture';
import { CraftingWindow } from './crafting-window';
import { DEFAULT_PLANNER_FILTERS, DISCOVERY_CHIP_TITLE, DISCOVERY_HINT, type PlannerFilters } from './planner.helpers';
import { PlannerFilterControls } from './planner-filters';
import { RecipeTree } from './recipe-tree';
import type { PlannerNames } from './use-planner-names';

vi.mock('../../../hooks/use-media-query', () => ({ useMediaQuery: () => true }));
vi.mock('../../../hooks/use-auth', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../hooks/use-auth')>()),
    getAuthToken: vi.fn(() => 'test-token'),
}));

const SWORD: ValheimRecipeCatalogEntry = {
    prefab: 'SwordBronze', kind: 'item', name: 'Bronze sword', category: 'Weapon', icon: null, maxQuality: 1, sources: { recipes: 1, processes: 0 },
    craft: { station: 'forge', stationLevel: 1, anyOneOf: false, resources: [{ prefab: 'Bronze', amount: 8 }], via: 'recipe', amount: 1 },
    upgrades: [], discovered: false,
};
const catalogOf = (discovery: ValheimRecipeDiscovery): ValheimRecipeCatalogResponse => ({
    ...recipeCatalogFixture(), entries: [...CRAFT_ENTRIES, SWORD], stations: CRAFT_STATIONS, ingredients: {}, discovery,
});
const names: PlannerNames = {
    nameOf: (p) => (p === 'SwordBronze' ? 'Bronze sword' : p),
    stationName: (p) => CRAFT_STATIONS.find((s) => s.prefab === p)?.name ?? p,
    ctxFor: () => ({ serverId: 7, items: {}, atlas: null, atlasUrl: null }),
};

function Harness({ hide }: { hide: boolean }): JSX.Element {
    const [filters, setFilters] = useState<PlannerFilters>({ ...DEFAULT_PLANNER_FILTERS, hideUndiscovered: hide });
    return <CraftingWindow serverId={7} catalog={catalogOf('known')} filters={filters} onFilters={setFilters} hasPersonal={false}
        names={names} onAdd={() => true} atCap={false} idle={<p>idle</p>} />;
}

const controls = (discovery: ValheimRecipeDiscovery, onChange = vi.fn()) =>
    render(<PlannerFilterControls filters={DEFAULT_PLANNER_FILTERS} categories={[]} hasPersonal={false} discovery={discovery} onChange={onChange} />);
const swordRow = () => screen.queryByRole('button', { name: /Bronze sword/ });

beforeEach(() => {
    server.use(valheimRecipeStockHandler([], { ...CRAFT_TOTALS }), valheimRecipeTreeHandler([]), valheimRecipePlanHandler([]));
});

describe('Hide undiscovered switch', () => {
    it.each(['no-character', 'truncated', 'outdated'] as const)('%s → disabled with its hint', (discovery) => {
        controls(discovery);
        const sw = screen.getByRole('switch', { name: 'Hide undiscovered' });
        expect(sw).toBeDisabled();
        expect(sw).toHaveAccessibleDescription(DISCOVERY_HINT[discovery]);
    });
    it('outdated (pre-0.4.2 mod) → disabled, tells the viewer to update the mod', () => {
        controls('outdated');
        const sw = screen.getByRole('switch', { name: 'Hide undiscovered' });
        expect(sw).toBeDisabled();
        expect(sw).toHaveAccessibleDescription('Update the RL Valheim Link mod (0.4.2+) and log in once to use this filter.');
    });
    it('known → enabled, no hint, toggling turns the filter on', async () => {
        const onChange = vi.fn();
        controls('known', onChange);
        const sw = screen.getByRole('switch', { name: 'Hide undiscovered' });
        expect(sw).toBeEnabled();
        expect(screen.queryByText(DISCOVERY_HINT['no-character'])).toBeNull();
        await userEvent.setup().click(sw);
        expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_PLANNER_FILTERS, hideUndiscovered: true });
    });
});

describe('Planner rows', () => {
    it('filter off → the Bronze sword shows the "Not discovered yet" chip', async () => {
        renderWithProviders(<Harness hide={false} />);
        await waitFor(() => expect(swordRow()).not.toBeNull());
        expect(swordRow()).toHaveAttribute('data-discovered', 'false');
        const chip = screen.getByTestId('valheim-undiscovered-chip');
        expect(chip).toHaveTextContent('Not discovered yet');
        expect(chip.querySelector('[title]')).toHaveAttribute('title', DISCOVERY_CHIP_TITLE);
    });
    it('filter on → the Bronze sword is gone from the Forge list and from search', async () => {
        renderWithProviders(<Harness hide />);
        await screen.findByRole('button', { name: 'Bronze' });
        expect(swordRow()).toBeNull();
        await userEvent.setup().type(screen.getByRole('searchbox', { name: 'Search an item or piece' }), 'bronze');
        // The Bronze axe matches the search too, so it must be listed — the sword must not.
        await waitFor(() => expect(screen.getByRole('button', { name: /Bronze axe/ })).toBeInTheDocument());
        expect(swordRow()).toBeNull();
    });
});

describe('plan tree rows', () => {
    const node = (id: number, prefab: string, discovered: boolean | null): ValheimPlanNode => ({
        id, parentId: null, prefab, quantity: 1, via: { type: 'gathered' }, alternatives: 0, crafts: 0, have: null, short: null, discovered,
    });
    const nodes = [node(1, 'SwordBronze', false), node(2, 'Wood', null)];
    const tree = () =>
        render(<RecipeTree nodes={nodes} truncated={false} names={names} label="What your list needs" rootKinds={['item', 'item']} />);
    const prefabs = () => screen.getAllByTestId('valheim-planner-row').map((r) => r.getAttribute('data-prefab'));
    it('the plan tree never prunes: the undiscovered node stays and carries the chip', () => {
        tree();
        expect(prefabs()).toEqual(['SwordBronze', 'Wood']);
        const chips = screen.getAllByTestId('valheim-undiscovered-chip');
        expect(chips).toHaveLength(1);
        expect(chips[0]?.closest('[data-prefab]')).toHaveAttribute('data-prefab', 'SwordBronze');
    });
});
