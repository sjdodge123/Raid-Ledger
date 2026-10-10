/**
 * ROK-1744: pure helpers for the Forever display-talents resolver — reading
 * typed snapshot nodes into adapter input and the D4 / origin sanity checks.
 */
import type { AddonTalentNode } from '@raid-ledger/contract';
import {
  clusterOrigins,
  type ForeverTalentNodeInput,
} from './forever-talents.adapter';

/** Sub-tree origins confirmed for Warrior + Druid (2026-10-09 addon probes). */
export const KNOWN_TALENT_ORIGINS = [1020, 5020, 9080];

const isNum = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v);

/** One typed snapshot node (schema 2, ROK-1742) as adapter input. */
export function toNodeInput(node: AddonTalentNode): ForeverTalentNodeInput {
  return { ...node };
}

/**
 * The typed `talents.nodes` of a snapshot. Schema-1 rows predate the display
 * keys and simply lack them; the only fallback is a row with no node array.
 */
export function toNodeInputs(
  nodes: readonly AddonTalentNode[] | undefined,
): ForeverTalentNodeInput[] {
  return Array.isArray(nodes) ? nodes.map(toNodeInput) : [];
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
  return clusterOrigins(nodes.flatMap((n) => (isNum(n.posX) ? [n.posX] : [])));
}

/** True when positions exist and their origins differ from the known set. */
export function originsDeviate(origins: number[]): boolean {
  if (origins.length === 0) return false;
  return origins.join('/') !== KNOWN_TALENT_ORIGINS.join('/');
}
