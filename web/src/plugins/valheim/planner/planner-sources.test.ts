/** ROK-1860 D9 / AC7 — source picks: storage round trip, corrupt data, pruning against the catalogue. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { VALHEIM_PLAN_SOURCES_MAX, type ValheimRecipeCatalogEntry, type ValheimRecipeSourceOption, type ValheimRecipeSourceRef } from '@raid-ledger/contract';
import {
    loadSourceOverrides,
    plannerSourcesKey,
    pruneSourceOverrides,
    saveSourceOverrides,
    type SourceOverrides,
} from './planner-sources';
import { usePlannerSources } from './use-planner-state';

const KILN: ValheimRecipeSourceRef = { type: 'process', processor: 'charcoal_kiln', index: 0 };
const RECIPE: ValheimRecipeSourceRef = { type: 'recipe', recipeId: 'Recipe_Coal' };

const option = (ref: ValheimRecipeSourceRef): ValheimRecipeSourceOption => ({
    ref, station: null, stationLevel: 0, outputAmount: 1, upgradeOnly: false, resources: [], default: false,
});
const entry = (prefab: string, kind: 'item' | 'piece', refs?: ValheimRecipeSourceRef[]): ValheimRecipeCatalogEntry => ({
    prefab, kind, name: prefab, category: '', icon: null, maxQuality: 1,
    sources: { recipes: 1, processes: 1 }, craft: null, upgrades: [],
    ...(refs === undefined ? {} : { sourceOptions: refs.map(option) }),
});

afterEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
});

describe('source overrides storage', () => {
    it('round-trips both ref kinds under the per-server sources key', () => {
        const picks: SourceOverrides = new Map<string, ValheimRecipeSourceRef>([['Coal', KILN], ['Bronze', RECIPE]]);
        saveSourceOverrides(7, picks);
        expect(plannerSourcesKey(7)).toBe('rl.valheim.planner.7.sources');
        expect(JSON.parse(window.localStorage.getItem('rl.valheim.planner.7.sources') ?? 'null')).toEqual([
            { prefab: 'Coal', ref: KILN }, { prefab: 'Bronze', ref: RECIPE },
        ]);
        expect([...loadSourceOverrides(7)]).toEqual([['Coal', KILN], ['Bronze', RECIPE]]);
        expect(loadSourceOverrides(8).size).toBe(0);
    });

    it('removes the key when the last pick is cleared', () => {
        saveSourceOverrides(7, new Map([['Coal', KILN]]));
        saveSourceOverrides(7, new Map());
        expect(window.localStorage.getItem('rl.valheim.planner.7.sources')).toBeNull();
    });

    it('reads corrupt JSON or an off-schema ref as no picks', () => {
        window.localStorage.setItem('rl.valheim.planner.7.sources', '{not json');
        expect(loadSourceOverrides(7).size).toBe(0);
        window.localStorage.setItem('rl.valheim.planner.7.sources', JSON.stringify([{ prefab: 'Coal', ref: { type: 'process', processor: 'charcoal_kiln', index: -1 } }]));
        expect(loadSourceOverrides(7).size).toBe(0);
    });

    it('survives a throwing storage', () => {
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
        expect(loadSourceOverrides(7).size).toBe(0);
        expect(() => saveSourceOverrides(7, new Map([['Coal', KILN]]))).not.toThrow();
    });
});

describe('pruneSourceOverrides', () => {
    it('keeps offered picks and drops unknown prefabs, stale refs, pieces and entries without options', () => {
        const catalog = {
            entries: [
                entry('Coal', 'item', [RECIPE, KILN]),
                entry('Bronze', 'item', [RECIPE]),
                entry('Chest', 'piece', [RECIPE]),
                entry('Wood', 'item'),
            ],
        };
        const picks: SourceOverrides = new Map<string, ValheimRecipeSourceRef>([
            ['Coal', KILN],
            ['Bronze', { type: 'process', processor: 'smelter', index: 0 }],
            ['Chest', RECIPE],
            ['Wood', RECIPE],
            ['Gone', RECIPE],
        ]);
        expect([...pruneSourceOverrides(picks, catalog)]).toEqual([['Coal', KILN]]);
        expect(pruneSourceOverrides(new Map([['Coal', { ...KILN, index: 1 }]]), catalog).size).toBe(0);
    });
});

describe('usePlannerSources cap (ROK-1860 review #2 / Codex P2)', () => {
    const recipeRef = (i: number): ValheimRecipeSourceRef => ({ type: 'recipe', recipeId: `Recipe_P${i}` });
    const prefabs = Array.from({ length: VALHEIM_PLAN_SOURCES_MAX + 1 }, (_, i) => `P${i}`);
    const catalog = { entries: prefabs.map((p, i) => entry(p, 'item', [recipeRef(i), RECIPE])) };

    it(`refuses a new prefab past ${VALHEIM_PLAN_SOURCES_MAX} picks, still re-picks a stored one, and every pick survives a reload`, () => {
        const { result, unmount } = renderHook(() => usePlannerSources(7, catalog));
        prefabs.slice(0, VALHEIM_PLAN_SOURCES_MAX).forEach((p, i) => act(() => { result.current[1](p, recipeRef(i)); }));
        let refused = true;
        act(() => { refused = result.current[1](`P${VALHEIM_PLAN_SOURCES_MAX}`, RECIPE); });
        expect({ refused, size: result.current[0].size }).toEqual({ refused: false, size: VALHEIM_PLAN_SOURCES_MAX });
        let repicked = false;
        act(() => { repicked = result.current[1]('P0', RECIPE); });
        expect({ repicked, p0: result.current[0].get('P0') }).toEqual({ repicked: true, p0: RECIPE });
        unmount();
        const reloaded = renderHook(() => usePlannerSources(7, catalog)).result.current[0];
        expect({ size: reloaded.size, p0: reloaded.get('P0'), last: reloaded.has(`P${VALHEIM_PLAN_SOURCES_MAX}`) })
            .toEqual({ size: VALHEIM_PLAN_SOURCES_MAX, p0: RECIPE, last: false });
    });
});
