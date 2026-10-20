/**
 * ROK-1853 L3 — pure mapping for the Materials read routes: query params,
 * stored rows → member DTOs, the empty state. Nothing here may emit a row
 * id, `creatorPlayerId` or a SteamID (design §3.2).
 */
import { BadRequestException } from '@nestjs/common';
import type {
  ValheimContainerSummary,
  ValheimMaterialStack,
  ValheimMaterialsResponse,
} from '@raid-ledger/contract';
import type { ValheimContainerPrivacyRow } from '../../../../drizzle/schema';

/** A container row as the materials repository selects it. */
export interface MaterialsContainerRow {
  key: string;
  prefab: string;
  x: number;
  y: number;
  z: number;
  privacy: ValheimContainerPrivacyRow;
  vehicle: boolean;
  slots: number;
  usedSlots: number;
  unreadable: boolean;
  omittedEntries: number;
  stackCount: number;
}

/** One `SUM … GROUP BY (prefab, quality)` row (bigint arrives as string). */
export interface MaterialsTotalRow {
  prefab: string;
  quality: number;
  total: string | number;
  chests: string | number;
}

const KEY_RE = /^[A-Za-z0-9_-]{22}$/;

/** D10: `includeVehicles` — absent or `true` → true, `false` → false, else 400. */
export function parseIncludeVehicles(raw: unknown): boolean {
  if (raw === undefined || raw === 'true') return true;
  if (raw === 'false') return false;
  throw new BadRequestException('Invalid includeVehicles');
}

/** D7 key shape (22 base64url chars), else 400. */
export function parseContainerKey(raw: string): string {
  if (!KEY_RE.test(raw)) throw new BadRequestException('Invalid key');
  return raw;
}

/** ISO at minute precision — the scan age carries no finer side channel. */
export function toMinuteIso(at: Date): string {
  const d = new Date(at.getTime());
  d.setUTCSeconds(0, 0);
  return d.toISOString();
}

/** Read-side privacy: `group` is shared, `private` is personal. */
export function toVisibility(
  privacy: ValheimContainerPrivacyRow,
): ValheimContainerSummary['privacy'] {
  return privacy === 'private' ? 'personal' : 'shared';
}

/**
 * Postgres count/sum → number. Safe as a double by the caps: stack totals
 * ≤ 4096 × 256 × 1e9 ≈ 1e15, omitted entries ≤ 4096 × 1e8 ≈ 4e11.
 */
export function toCount(value: string | number): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n)) throw new Error(`unsafe count: ${value}`);
  return n;
}

/** Counts over one scope's containers (warnings, chest count). */
export interface MaterialsCountsRow {
  chestCount: number;
  unreadable: number;
  omittedEntries: number;
}

/** The counts query's bigint strings → numbers; no row → all zero. */
export function toCountsRow(
  row:
    | {
        chestCount: string | number;
        unreadable: string | number;
        omittedEntries: string | number;
      }
    | undefined,
): MaterialsCountsRow {
  if (!row) return { chestCount: 0, unreadable: 0, omittedEntries: 0 };
  return {
    chestCount: toCount(row.chestCount),
    unreadable: toCount(row.unreadable),
    omittedEntries: toCount(row.omittedEntries),
  };
}

export function toMaterialStack(row: MaterialsTotalRow): ValheimMaterialStack {
  return {
    prefab: row.prefab,
    quality: row.quality,
    total: toCount(row.total),
    chests: toCount(row.chests),
  };
}

/** Explicit field list: an extra selected column can never leak. */
export function toContainerSummary(
  row: MaterialsContainerRow,
): ValheimContainerSummary {
  return {
    key: row.key,
    prefab: row.prefab,
    x: row.x,
    y: row.y,
    z: row.z,
    privacy: toVisibility(row.privacy),
    vehicle: row.vehicle,
    slots: row.slots,
    usedSlots: row.usedSlots,
    unreadable: row.unreadable,
    omittedEntries: row.omittedEntries,
    stackCount: toCount(row.stackCount),
  };
}

/** Distinct prefabs across stacks/containers, sorted (catalogue subset). */
export function distinctPrefabs(
  ...lists: ReadonlyArray<ReadonlyArray<{ prefab: string }>>
): string[] {
  const set = new Set<string>();
  for (const list of lists) for (const r of list) set.add(r.prefab);
  return [...set].sort();
}

/** R16: before the first scan — 200 with nulls and empty arrays. */
export function emptyMaterials(): ValheimMaterialsResponse {
  return {
    worldUid: null,
    capturedAt: null,
    gameVersion: null,
    catalogFallback: false,
    shared: {
      totals: [],
      chestCount: 0,
      warnings: { unreadable: 0, omittedEntries: 0, omittedShared: 0 },
    },
    personal: null,
    items: {},
    atlas: null,
  };
}
