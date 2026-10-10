/**
 * ROK-1744: pure helpers for the Forever display-talents resolver — reading
 * snapshot nodes out of the raw jsonb and the D4 / origin sanity checks.
 */
import {
  TALENT_TREE_GAP,
  type ForeverTalentNodeInput,
} from './forever-talents.adapter';

/** Sub-tree origins confirmed for Warrior + Druid (2026-10-09 addon probes). */
export const KNOWN_TALENT_ORIGINS = [1020, 5020, 9080];

const NUMERIC_KEYS = [
  'maxRanks',
  'spellId',
  'posX',
  'posY',
  'tree',
  'row',
  'col',
  'entryId',
] as const;

const isNum = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v);

/**
 * Narrow one raw jsonb node. Snapshot schema 2 on main validates only
 * nodeId/rank/entryId; the optional display keys pass through when present.
 */
export function toNodeInput(raw: unknown): ForeverTalentNodeInput | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!isNum(r.nodeId) || !isNum(r.rank)) return null;
  const node: ForeverTalentNodeInput = { nodeId: r.nodeId, rank: r.rank };
  for (const key of NUMERIC_KEYS) {
    const v = r[key];
    if (isNum(v)) node[key] = v;
  }
  if (typeof r.name === 'string') node.name = r.name;
  return node;
}

/** Every well-formed node of a raw `talents.nodes` value. */
export function toNodeInputs(raw: unknown): ForeverTalentNodeInput[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((n) => {
    const node = toNodeInput(n);
    return node ? [node] : [];
  });
}

/** D4: stored (Armory) talents synced at/after the capture are kept. */
export function storedTalentsAreNewer(
  talents: unknown,
  lastSyncedAt: string | null,
  capturedAt: Date,
): boolean {
  if (talents == null || !lastSyncedAt) return false;
  const synced = Date.parse(lastSyncedAt);
  return Number.isFinite(synced) && synced >= capturedAt.getTime();
}

/** Sub-tree origins of the positioned nodes (same gap rule as the adapter). */
export function talentOrigins(nodes: ForeverTalentNodeInput[]): number[] {
  const xs = nodes.flatMap((n) => (isNum(n.posX) ? [n.posX] : []));
  const sorted = [...new Set(xs)].sort((a, b) => a - b);
  return sorted.filter(
    (x, i) => i === 0 || x - sorted[i - 1]! > TALENT_TREE_GAP,
  );
}

/** True when positions exist and their origins differ from the known set. */
export function originsDeviate(origins: number[]): boolean {
  if (origins.length === 0) return false;
  return origins.join('/') !== KNOWN_TALENT_ORIGINS.join('/');
}
