/**
 * ROK-1854 — MSW fixtures for the hub Planner routes (catalogue, one tree,
 * a plan), DERIVED from the contract's golden `recipes-vanilla.json` mod
 * message rather than hand-typed: an Iron sword (forge) needs Iron, smelted
 * from Iron scrap with Coal fuel. Specs `server.use()` them. A separate
 * file: `valheim-armory-handlers.ts` is near the 300-line cap.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { http, HttpResponse } from 'msw';
import type {
    ValheimPlanNode,
    ValheimRecipeCatalogResponse,
    ValheimRecipePlanResponse,
    ValheimRecipePlanTarget,
    ValheimRecipeTreeResponse,
} from '@raid-ledger/contract';

const API_BASE = 'http://localhost:3000';
const RECIPES = `${API_BASE}/plugins/valheim/armory/servers/:serverId/recipes`;
export const VALHEIM_RECIPES_URL = RECIPES;
export const VALHEIM_RECIPE_TREE_URL = `${RECIPES}/:prefab/tree`;
export const VALHEIM_RECIPE_PLAN_URL = `${RECIPES}/plan`;

interface Res { prefab: string; amount: number; amountPerLevel?: number }
interface FixtureRecipe { id: string; result: string; station: string | null; minStationLevel: number; resources: Res[] }
interface FixtureProcess { processor: string; inputs: Res[]; output: Res; seconds: number }
interface RecipesFixture {
    capturedAt: string;
    gameVersion: string;
    stations: { prefab: string; name: string; maxLevel: number }[];
    recipes: FixtureRecipe[];
    pieces: { prefab: string; name: string; category: string; station: string; resources: Res[] }[];
    processors: { prefab: string; type: 'smelter'; fuel: string | null; fuelPerProduct: number }[];
    processes: FixtureProcess[];
}

// vitest runs from web/.
export const recipesVanilla = JSON.parse(
    readFileSync(
        resolve(process.cwd(), '../packages/contract/valheim-link/v1/fixtures/recipes-vanilla.json'),
        'utf8',
    ),
) as RecipesFixture;

/** Display names — the fixture is the mod message, which carries prefabs only for items. */
const NAMES: Record<string, string> = {
    SwordIron: 'Iron sword', Club: 'Club', Iron: 'Iron', IronScrap: 'Iron scrap',
    Coal: 'Coal', Wood: 'Wood', LeatherScraps: 'Leather scraps',
};
export const nameOf = (prefab: string): string => NAMES[prefab] ?? prefab;

const entry = (prefab: string, category: string) => ({ name: nameOf(prefab), category, icon: null });

export function recipeCatalogFixture(
    over: Partial<ValheimRecipeCatalogResponse> = {},
): ValheimRecipeCatalogResponse {
    const f = recipesVanilla;
    const crafted = f.recipes.map((r) => ({
        prefab: r.result, kind: 'item' as const, name: nameOf(r.result), category: 'Weapon',
        icon: null, maxQuality: 4, sources: { recipes: 1, processes: 0 },
    }));
    const smelted = f.processes.map((p) => ({
        prefab: p.output.prefab, kind: 'item' as const, name: nameOf(p.output.prefab),
        category: 'Material', icon: null, maxQuality: 1, sources: { recipes: 0, processes: 1 },
    }));
    const pieces = f.pieces.map((p) => ({
        prefab: p.prefab, kind: 'piece' as const, name: p.name, category: p.category,
        icon: null, maxQuality: 1, sources: { recipes: 1, processes: 0 },
    }));
    return {
        gameVersion: f.gameVersion, capturedAt: f.capturedAt, catalogFallback: false,
        entries: [...crafted, ...smelted, ...pieces],
        stations: f.stations.map((s) => ({ prefab: s.prefab, name: s.name, maxLevel: s.maxLevel, upgrader: false, icon: null })),
        itemAtlas: null, recipeAtlas: null, ...over,
    };
}

export const recipeCatalogEmpty: ValheimRecipeCatalogResponse = {
    ...recipeCatalogFixture(), gameVersion: null, capturedAt: null, entries: [], stations: [],
};

type Stock = Record<string, number> | null;

/** Walks the fixture: recipe > smelter process > gathered; Coal under a smelter is `fuel`. */
function walk(out: ValheimPlanNode[], prefab: string, qty: number, quality: number, parentId: number | null, stock: Stock): void {
    const id = out.length;
    const have = stock === null ? null : (stock[prefab] ?? 0);
    const base = { id, parentId, prefab, quantity: qty, alternatives: 0, crafts: qty, have, short: have === null ? null : Math.max(0, qty - have) };
    const recipe = recipesVanilla.recipes.find((r) => r.result === prefab);
    const proc = recipesVanilla.processes.find((p) => p.output.prefab === prefab);
    if (recipe !== undefined) {
        out.push({ ...base, via: { type: 'recipe', recipeId: recipe.id, station: recipe.station, stationLevel: recipe.minStationLevel + quality - 1, quality, upgradeOnly: false, formula: 'vanilla', anyOneOf: false, upgraderStation: false } });
        for (const r of recipe.resources) walk(out, r.prefab, (r.amount + (r.amountPerLevel ?? 0) * (quality - 1)) * qty, 1, id, stock);
    } else if (proc !== undefined) {
        const p = recipesVanilla.processors.find((x) => x.prefab === proc.processor);
        out.push({ ...base, via: { type: 'process', processor: proc.processor, processorType: p?.type ?? 'smelter', seconds: proc.seconds, windPowered: false, fuel: p?.fuel ?? null } });
        for (const i of proc.inputs) walk(out, i.prefab, i.amount * qty, 1, id, stock);
        if (p?.fuel) out.push({ ...base, id: out.length, parentId: id, prefab: p.fuel, quantity: qty * p.fuelPerProduct, crafts: 0, via: { type: 'fuel' }, have: stock === null ? null : (stock[p.fuel] ?? 0), short: stock === null ? null : Math.max(0, qty * p.fuelPerProduct - (stock[p.fuel] ?? 0)) });
    } else {
        out.push({ ...base, crafts: 0, via: { type: 'gathered' } });
    }
}

/** The catalogue subset plan and tree responses carry for their nodes. */
const responseItems = () => Object.fromEntries(Object.keys(NAMES).map((p) => [p, entry(p, 'Material')]));

export function recipeTreeFixture(prefab: string, quality: number): ValheimRecipeTreeResponse {
    const nodes: ValheimPlanNode[] = [];
    walk(nodes, prefab, 1, quality, null, null);
    return { target: { prefab, quality }, nodes, truncated: false, items: responseItems(), itemAtlas: null, recipeAtlas: null };
}

export const STOCK: Record<string, number> = { Wood: 5, IronScrap: 8, Coal: 100 };

export function recipePlanFixture(targets: ValheimRecipePlanTarget[], stock: Stock = STOCK): ValheimRecipePlanResponse {
    const nodes: ValheimPlanNode[] = [];
    for (const t of targets) walk(nodes, t.prefab, t.amount, t.quality, null, stock);
    const leaves = new Map<string, number>();
    for (const n of nodes) if (n.via.type === 'gathered' || n.via.type === 'fuel') leaves.set(n.prefab, (leaves.get(n.prefab) ?? 0) + n.quantity);
    const shoppingList = [...leaves].map(([prefab, need]) => {
        const have = stock === null ? null : (stock[prefab] ?? 0);
        return { prefab, need, have, short: have === null ? null : Math.max(0, need - have) };
    });
    const items = responseItems();
    return {
        targets, nodes, truncated: false, stock: stock === null ? 'none' : 'scan',
        capturedAt: stock === null ? null : new Date(Date.now() - 7 * 60_000).toISOString(),
        shoppingList, fuelEstimates: [], items, itemAtlas: null, recipeAtlas: null,
    };
}

/** `targets=prefab:q:n[:fromQ],…` → typed targets. */
export function parseTargetsParam(raw: string): ValheimRecipePlanTarget[] {
    return raw.split(',').filter(Boolean).map((t) => {
        const [prefab = '', q = '1', n = '1', from = '0'] = t.split(':');
        return { prefab, quality: Number(q), amount: Number(n), fromQuality: Number(from) };
    });
}

export const valheimRecipeCatalogHandler = (body: ValheimRecipeCatalogResponse = recipeCatalogFixture()) =>
    http.get(VALHEIM_RECIPES_URL, () => HttpResponse.json(body));

/** `hits` collects `prefab?search` for each tree request. */
export const valheimRecipeTreeHandler = (hits: string[] = []) =>
    http.get(VALHEIM_RECIPE_TREE_URL, ({ request, params }) => {
        const url = new URL(request.url);
        hits.push(`${String(params['prefab'])}${url.search}`);
        return HttpResponse.json(recipeTreeFixture(String(params['prefab']), Number(url.searchParams.get('quality') ?? '1')));
    });

/** `hits` collects the search string of each plan request. */
export const valheimRecipePlanHandler = (hits: string[] = [], stock: Stock = STOCK) =>
    http.get(VALHEIM_RECIPE_PLAN_URL, ({ request }) => {
        const url = new URL(request.url);
        hits.push(url.search);
        return HttpResponse.json(recipePlanFixture(parseTargetsParam(url.searchParams.get('targets') ?? ''), stock));
    });
