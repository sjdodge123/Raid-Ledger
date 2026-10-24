/**
 * ROK-1948 — Planner spoiler protection (spec §5): the copy and the pure
 * checks the tree, the shopping list and the crafting window use. The server
 * already sends only what someone on the server has discovered; the web never
 * names, counts or draws what it withheld.
 */
import type { ValheimPlanNode, ValheimRecipeCatalogResponse } from '@raid-ledger/contract';

/** Muted line under the search row while protection is on (operator ruling Q2). */
export const SPOILERS_PROTECTED_COPY = 'Showing only what someone on this server has discovered.';
/** A plan node the server withheld (D7) — no name, icon or count. */
export const UNDISCOVERED_NODE_COPY = 'Needs something nobody on the server has found yet.';
/** Shopping-list footer when any plan node is withheld. */
export const PLAN_UNDISCOVERED_COPY = 'Part of this plan needs something nobody on the server has found yet.';
/** A stored target the protected catalogue no longer lists (W5). */
export const HIDDEN_TARGET_COPY = 'Hidden item: nobody on the server has found it yet';
/** Protected, with nothing visible to craft (§4.5 empty state). */
export const SPOILERS_EMPTY_COPY = 'Nobody on this server has discovered anything to craft yet.';

const KNOWN_VIA: ReadonlySet<string> = new Set(['recipe', 'process', 'cycle', 'fuel', 'gathered']);

/** `undiscovered`, or a via this bundle doesn't know (W6: a stale tab) — never rendered as "Gathered". */
export const isUndiscoveredNode = (node: Pick<ValheimPlanNode, 'via'>): boolean => !KNOWN_VIA.has(node.via.type);

export const planHasUndiscovered = (nodes: readonly Pick<ValheimPlanNode, 'via'>[]): boolean => nodes.some(isUndiscoveredNode);

/**
 * A stored target the visible catalogue lacks while protection is on. It stays
 * in storage (it comes back once discovered) but is left out of `/plan`.
 * With protection off the catalogue is complete, so nothing is hidden.
 */
export function isHiddenTarget(
    catalog: Pick<ValheimRecipeCatalogResponse, 'entries' | 'spoilers'>,
    target: { prefab: string; kind: 'item' | 'piece' },
): boolean {
    return catalog.spoilers === 'protected' && !catalog.entries.some((e) => e.prefab === target.prefab && e.kind === target.kind);
}
