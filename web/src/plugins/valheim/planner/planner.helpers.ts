/**
 * ROK-1854 — pure helpers for the hub Planner tab: fold the flat plan nodes
 * into a tree, serialise targets for `?targets=`, format counts and via
 * chips, and (de)serialise the stored shopping list behind a schema guard.
 */
import { z } from 'zod';
import { VALHEIM_PLAN_TARGETS_MAX, type ValheimPlanNode, type ValheimPlanVia } from '@raid-ledger/contract';

export type PlannerKind = 'item' | 'piece';

export interface PlannerTarget {
    prefab: string;
    kind: PlannerKind;
    quality: number;
    amount: number;
}

export interface PlanTreeNode {
    node: ValheimPlanNode;
    children: PlanTreeNode[];
}

export interface PlannerFilters {
    kind: 'both' | 'item' | 'piece';
    category: string | null;
    includePersonal: boolean;
    includeVehicles: boolean;
}

export const DEFAULT_PLANNER_FILTERS: PlannerFilters = {
    kind: 'both',
    category: null,
    includePersonal: false,
    includeVehicles: true,
};

export const activePlannerFilters = (f: PlannerFilters): number =>
    (f.kind === 'both' ? 0 : 1) +
    (f.category === null ? 0 : 1) +
    (f.includePersonal ? 1 : 0) +
    (f.includeVehicles ? 0 : 1);

export const PLANNER_AMOUNT_MAX = 10_000;
export const PLANNER_NO_SET_COPY =
    'Recipes arrive when an admin with the mod joins the server.';
export const PLANNER_NO_STOCK_COPY =
    'No chest data yet — showing what each recipe costs.';

/** Rebuild the hierarchy from `parentId` links; orphans become roots. */
export function foldNodes(nodes: readonly ValheimPlanNode[]): PlanTreeNode[] {
    const byId = new Map<number, PlanTreeNode>();
    for (const node of nodes) byId.set(node.id, { node, children: [] });
    const roots: PlanTreeNode[] = [];
    for (const entry of byId.values()) {
        const parent =
            entry.node.parentId === null
                ? undefined
                : byId.get(entry.node.parentId);
        if (parent === undefined || parent === entry) roots.push(entry);
        else parent.children.push(entry);
    }
    return roots;
}

/** `prefab:quality:amount:0:kind` joined by commas — the plan route's `targets=` (kind kept end to end). */
export function serializeTargets(targets: readonly PlannerTarget[]): string {
    return targets.map((t) => `${t.prefab}:${t.quality}:${t.amount}:0:${t.kind}`).join(',');
}

/** The plan route's target cap — the list never grows past it. */
export const PLANNER_TARGETS_MAX = VALHEIM_PLAN_TARGETS_MAX;

/**
 * Adds `add` to the list: the same prefab + kind + quality merges amounts
 * (capped); a new target past PLANNER_TARGETS_MAX returns null (refused).
 */
export function addPlannerTarget(list: readonly PlannerTarget[], add: PlannerTarget): PlannerTarget[] | null {
    const i = list.findIndex((t) => t.prefab === add.prefab && t.kind === add.kind && t.quality === add.quality);
    if (i >= 0) return list.map((t, j) => (j === i ? { ...t, amount: Math.min(PLANNER_AMOUNT_MAX, t.amount + add.amount) } : t));
    return list.length >= PLANNER_TARGETS_MAX ? null : [...list, add];
}

const PLANNER_KINDS: readonly string[] = ['both', 'item', 'piece'];

/** Narrows a Select value to the kind filter. */
export function isPlannerKindFilter(v: string): v is PlannerFilters['kind'] {
    return PLANNER_KINDS.includes(v);
}

/** `null` (no chest scan) renders as an em dash. */
export function formatAmount(n: number | null): string {
    return n === null ? '—' : n.toLocaleString('en-US');
}

/** 30 → "30 s", 2400 → "40 min", 7200 → "2 h". */
export function formatSeconds(seconds: number): string {
    if (seconds < 60) return `${Math.round(seconds)} s`;
    if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
    return `${Math.round(seconds / 360) / 10} h`;
}

/** Known processor prefabs first; otherwise the processor type. */
const PROCESSOR_LABEL: Record<string, string> = {
    smelter: 'Smelter',
    blastfurnace: 'Blast furnace',
    charcoal_kiln: 'Charcoal kiln',
    windmill: 'Windmill',
    piece_spinningwheel: 'Spinning wheel',
    fermenter: 'Fermenter',
    incinerator: 'Obliterator',
};
const PROCESSOR_TYPE_LABEL: Record<string, string> = {
    smelter: 'Smelter',
    fermenter: 'Fermenter',
    cooking: 'Cooking',
    incinerator: 'Obliterator',
};

function processChip(via: Extract<ValheimPlanVia, { type: 'process' }>): string {
    const name =
        PROCESSOR_LABEL[via.processor] ??
        PROCESSOR_TYPE_LABEL[via.processorType] ??
        via.processor;
    return via.seconds === null ? name : `${name} · ${formatSeconds(via.seconds)}`;
}

function recipeChips(
    via: Extract<ValheimPlanVia, { type: 'recipe' }>,
    stationName: (prefab: string) => string,
): string[] {
    const chips: string[] = [];
    if (via.station !== null)
        chips.push(`${stationName(via.station)} · lvl ${via.stationLevel}`);
    if (via.upgraderStation) chips.push('Upgrade station');
    if (via.formula === 'custom') chips.push('Cost may differ in game');
    return chips;
}

/** The row's via-chips, plus "+N other ways" when alternatives exist. */
export function viaChips(
    node: ValheimPlanNode,
    stationName: (prefab: string) => string,
): string[] {
    const { via } = node;
    const chips =
        via.type === 'recipe'
            ? recipeChips(via, stationName)
            : via.type === 'process'
              ? [processChip(via)]
              : via.type === 'cycle'
                ? ['Loops back']
                : via.type === 'fuel'
                  ? ['Fuel']
                  : ['Gathered'];
    if (node.alternatives > 0) chips.push(`+${node.alternatives} other ways`);
    return chips;
}

/** Fill ratio for the have/need meter, 0–100. */
export function havePct(have: number, need: number): number {
    if (need <= 0) return 100;
    return (Math.min(have, need) / need) * 100;
}

const StoredTargetsSchema = z
    .array(
        z.object({
            prefab: z.string().min(1).max(128),
            kind: z.enum(['item', 'piece']),
            quality: z.number().int().min(1).max(10),
            amount: z.number().int().min(1).max(PLANNER_AMOUNT_MAX),
        }),
    )
    .max(VALHEIM_PLAN_TARGETS_MAX);

/** Anything unparseable or off-schema reads as an empty list. */
export function parseStoredTargets(raw: string | null): PlannerTarget[] {
    if (raw === null) return [];
    try {
        const parsed = StoredTargetsSchema.safeParse(JSON.parse(raw));
        return parsed.success ? parsed.data : [];
    } catch {
        return [];
    }
}

export interface ShoppingLine {
    prefab: string;
    need: number;
    have: number | null;
    short: number | null;
}

/** The plain-text list "Copy list" puts on the clipboard. */
export function shoppingListText(
    lines: readonly ShoppingLine[],
    nameOf: (prefab: string) => string,
): string {
    return lines
        .map((l) => {
            const left = l.short === null ? l.need : l.short;
            return `${nameOf(l.prefab)}: ${formatAmount(left)}`;
        })
        .join('\n');
}

/** "Chests scanned 7 min ago" — the plan's stock age. */
export function stockAgeLabel(capturedAt: string, now: number): string {
    const mins = Math.max(0, Math.floor((now - Date.parse(capturedAt)) / 60_000));
    if (mins < 1) return 'Chests scanned just now';
    if (mins < 60) return `Chests scanned ${mins} min ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `Chests scanned ${hours} h ago`;
    const days = Math.floor(hours / 24);
    return `Chests scanned ${days} ${days === 1 ? 'day' : 'days'} ago`;
}
