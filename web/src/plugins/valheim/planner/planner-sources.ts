/**
 * ROK-1860 D9 — the viewer's per-prefab source picks, kept per browser per
 * server beside the shopping list (`planner-storage.ts`). Storage can be
 * missing or throw: every access is guarded and the planner renders without
 * it. A pick the catalogue no longer offers is pruned on load.
 */
import { z } from 'zod';
import {
    VALHEIM_PLAN_SOURCES_MAX,
    ValheimRecipeSourceRefSchema,
    type ValheimRecipeCatalogResponse,
    type ValheimRecipeSourceRef,
} from '@raid-ledger/contract';
import { plannerStorageKey } from './planner-storage';

/** prefab → the source the viewer picked for it. */
export type SourceOverrides = Map<string, ValheimRecipeSourceRef>;

const StoredSourcesSchema = z
    .array(z.object({ prefab: z.string().min(1).max(128), ref: ValheimRecipeSourceRefSchema }))
    .max(VALHEIM_PLAN_SOURCES_MAX);

export const plannerSourcesKey = (serverId: number): string => `${plannerStorageKey(serverId)}.sources`;

/** Anything missing, unparseable or off-schema reads as no picks; duplicates → last wins. */
export function loadSourceOverrides(serverId: number): SourceOverrides {
    try {
        const raw = window.localStorage.getItem(plannerSourcesKey(serverId));
        if (raw === null) return new Map();
        const parsed = StoredSourcesSchema.safeParse(JSON.parse(raw));
        return parsed.success ? new Map(parsed.data.map((e) => [e.prefab, e.ref])) : new Map();
    } catch {
        return new Map();
    }
}

export function saveSourceOverrides(serverId: number, sources: ReadonlyMap<string, ValheimRecipeSourceRef>): void {
    try {
        const key = plannerSourcesKey(serverId);
        if (sources.size === 0) window.localStorage.removeItem(key);
        else window.localStorage.setItem(key, JSON.stringify([...sources].map(([prefab, ref]) => ({ prefab, ref }))));
    } catch {
        // Storage unavailable — the picks live for this visit only.
    }
}

const sameRef = (a: ValheimRecipeSourceRef, b: ValheimRecipeSourceRef): boolean =>
    a.type === 'recipe'
        ? b.type === 'recipe' && a.recipeId === b.recipeId
        : b.type === 'process' && a.processor === b.processor && a.index === b.index;

/** Keeps only picks whose prefab is a catalogue item still offering that exact ref in `sourceOptions`. */
export function pruneSourceOverrides(
    sources: ReadonlyMap<string, ValheimRecipeSourceRef>,
    catalog: Pick<ValheimRecipeCatalogResponse, 'entries'>,
): SourceOverrides {
    const kept: SourceOverrides = new Map();
    for (const [prefab, ref] of sources) {
        const entry = catalog.entries.find((e) => e.kind === 'item' && e.prefab === prefab);
        if (entry?.sourceOptions?.some((o) => sameRef(o.ref, ref)) === true) kept.set(prefab, ref);
    }
    return kept;
}
