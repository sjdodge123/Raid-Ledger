/** ROK-1860 AC6 / D10 — picking a source in the list's plan tree or the breakdown re-requests the plan with `sources=`. */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { ValheimRecipeSourceOption } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { renderWithProviders } from '../../../test/render-helpers';
import { materialsFixture, valheimMaterialsHandler } from '../../../test/mocks/valheim-materials-handlers';
import {
    VALHEIM_RECIPE_PLAN_URL,
    parseTargetsParam,
    recipeCatalogFixture,
    recipePlanFixture,
    valheimRecipeCatalogHandler,
    valheimRecipeStockHandler,
    valheimRecipeTreeHandler,
} from '../../../test/mocks/valheim-recipes-handlers';
import { plannerStorageKey } from './planner-storage';
import { ValheimPlannerTab } from './valheim-planner-tab';

const media = vi.hoisted(() => ({ desktop: true }));
vi.mock('../../../hooks/use-media-query', () => ({ useMediaQuery: () => media.desktop }));
vi.mock('../../../hooks/use-auth', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../hooks/use-auth')>()),
    getAuthToken: vi.fn(() => 'test-token'),
}));

const DEFAULT_WAY: ValheimRecipeSourceOption = {
    ref: { type: 'recipe', recipeId: 'Recipe_SwordIron' }, station: 'forge', stationLevel: 1, outputAmount: 1, upgradeOnly: false,
    resources: [{ prefab: 'Iron', amount: 20 }], default: true,
};
const BY_HAND: ValheimRecipeSourceOption = {
    ref: { type: 'recipe', recipeId: 'Recipe_SwordIronHand' }, station: null, stationLevel: 0, outputAmount: 1, upgradeOnly: false,
    resources: [{ prefab: 'Iron', amount: 30 }], default: false,
};
const PICKED = 'sources=SwordIron%3Ar%3ARecipe_SwordIronHand';

function catalogWithSources() {
    const c = recipeCatalogFixture();
    const entries = c.entries.map((e) => (e.prefab === 'SwordIron' && e.kind === 'item' ? { ...e, sourceOptions: [DEFAULT_WAY, BY_HAND] } : e));
    return { ...c, entries };
}

/** The fixture plan, with "+1 other ways" on the Iron sword root. */
const planHandler = (hits: string[]) =>
    http.get(VALHEIM_RECIPE_PLAN_URL, ({ request }) => {
        const url = new URL(request.url);
        hits.push(url.search);
        const plan = recipePlanFixture(parseTargetsParam(url.searchParams.get('targets') ?? ''));
        return HttpResponse.json({ ...plan, nodes: plan.nodes.map((n) => (n.prefab === 'SwordIron' ? { ...n, alternatives: 1 } : n)) });
    });

let planHits: string[];

beforeEach(() => {
    media.desktop = true;
    localStorage.clear();
    planHits = [];
    server.use(
        valheimRecipeStockHandler([]),
        valheimRecipeCatalogHandler(catalogWithSources()),
        valheimRecipeTreeHandler([]),
        planHandler(planHits),
        valheimMaterialsHandler(materialsFixture()),
    );
});

async function pickByHand(user: ReturnType<typeof userEvent.setup>, tree: HTMLElement): Promise<void> {
    await user.click(within(tree).getByRole('button', { name: 'Choose how to make Iron sword (1 other ways)' }));
    const dialog = await screen.findByRole('dialog', { name: 'How to make Iron sword' });
    expect(within(dialog).getByRole('radio', { name: /Use the default/ })).toBeChecked();
    await user.click(within(dialog).getByRole('radio', { name: /By hand/ }));
}

describe('Planner source picker (ROK-1860)', () => {
    it('the list plan: picking a source re-requests /plan with sources= and shows it selected next time', async () => {
        localStorage.setItem(plannerStorageKey(7), JSON.stringify([{ prefab: 'SwordIron', kind: 'item', quality: 1, amount: 1 }]));
        const user = userEvent.setup();
        renderWithProviders(<ValheimPlannerTab serverId={7} />);
        const tree = await screen.findByRole('list', { name: 'What your list needs' });
        expect(planHits.some((h) => h.includes('sources='))).toBe(false);
        await pickByHand(user, tree);
        await waitFor(() => expect(planHits.at(-1)).toContain(PICKED));
        expect(screen.queryByRole('dialog')).toBeNull();
        await user.click(await within(await screen.findByRole('list', { name: 'What your list needs' })).findByRole('button', { name: /Choose how to make Iron sword/ }));
        expect(await screen.findByRole('radio', { name: /By hand/ })).toBeChecked();
    });

    it('the crafting-window breakdown honours the pick in its own /plan call (D10)', async () => {
        const user = userEvent.setup();
        renderWithProviders(<ValheimPlannerTab serverId={7} />);
        const list = await screen.findByRole('list', { name: 'Forge recipes' });
        await user.click(within(list).getByRole('button', { name: /^Iron sword/ }));
        const tree = await screen.findByRole('list', { name: 'What Iron sword needs' });
        await pickByHand(user, tree);
        await waitFor(() => expect(planHits.some((h) => h.includes('targets=SwordIron%3A1%3A1%3A0%3Aitem') && h.includes(PICKED))).toBe(true));
    });
});
