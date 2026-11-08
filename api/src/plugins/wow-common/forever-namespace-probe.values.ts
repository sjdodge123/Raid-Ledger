/**
 * ROK-2143: value-flattening shape summary for PUBLIC static game data —
 * quests, quest areas and items. Unlike the profile shapes (keys only), these
 * record values: every leaf as a dotted / indexed path (`rewards.experience`,
 * `rewards.items[0].item.name`). Links and hrefs are dropped, a localized
 * object collapses to its `en_US` string. Never used for profile endpoints.
 * Pure — no NestJS imports (the CI canary reaches this through the helpers).
 */
import type { ShapeSummary } from './forever-namespace-probe.helpers';

/** Leaf values kept per shape (matches the contract's intent, ~120). */
export const MAX_VALUE_ENTRIES = 120;
/** Longest string value kept (matches the contract's per-value cap). */
export const MAX_VALUE_LENGTH = 200;
/** Deepest nesting walked — Blizzard bodies are a handful of levels deep. */
const MAX_DEPTH = 12;
/** Keys never recorded: API navigation, not game data. */
const DROPPED_KEYS: ReadonlySet<string> = new Set(['_links', 'href']);

/** One recorded leaf value. */
export type ProbeLeaf = string | number | boolean | null;

/** A shape summary carrying flattened leaf values. */
export type ValuesShapeSummary = ShapeSummary & {
  values: Record<string, ProbeLeaf>;
};

interface Walk {
  values: Record<string, ProbeLeaf>;
  kept: number;
  count: number;
}

/** Record one leaf: always counted, kept while under the cap. */
function addLeaf(walk: Walk, path: string, leaf: ProbeLeaf): void {
  walk.count += 1;
  if (walk.kept >= MAX_VALUE_ENTRIES) return;
  walk.values[path] =
    typeof leaf === 'string' ? leaf.slice(0, MAX_VALUE_LENGTH) : leaf;
  walk.kept += 1;
}

/** A localized object's `en_US` string, else null. */
function localized(node: object): string | null {
  const en: unknown = Reflect.get(node, 'en_US');
  return typeof en === 'string' ? en : null;
}

/** `parent.key`, or `key` at the root. */
function join(path: string, key: string): string {
  return path ? `${path}.${key}` : key;
}

/** Walk one node, folding its leaves into `walk`. */
function walkNode(
  walk: Walk,
  node: unknown,
  path: string,
  depth: number,
): void {
  if (node === null || typeof node === 'string')
    return addLeaf(walk, path, node);
  if (typeof node === 'number' || typeof node === 'boolean')
    return addLeaf(walk, path, node);
  if (typeof node !== 'object' || depth > MAX_DEPTH) return;
  if (Array.isArray(node)) {
    node.forEach((v: unknown, i) =>
      walkNode(walk, v, `${path}[${i}]`, depth + 1),
    );
    return;
  }
  const en = localized(node);
  if (en !== null) return addLeaf(walk, path, en);
  for (const [key, value] of Object.entries(node)) {
    if (DROPPED_KEYS.has(key)) continue;
    walkNode(walk, value, join(path, key), depth + 1);
  }
}

/** Sorted top-level keys, leaf count and up to 120 flattened leaf values. */
export function flattenValues(body: unknown): ValuesShapeSummary {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { topLevelKeys: [], entryCount: 0, sample: [], values: {} };
  }
  const walk: Walk = { values: {}, kept: 0, count: 0 };
  walkNode(walk, body, '', 0);
  const topLevelKeys = Object.keys(body).sort();
  return {
    topLevelKeys,
    entryCount: walk.count,
    sample: [],
    values: walk.values,
  };
}
