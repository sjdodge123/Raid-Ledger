/**
 * ROK-1836 D4 — pure projection of the item catalogue into a character
 * detail: ONLY the prefabs the sheet references (equipment + inventory +
 * trophies), icons mapped to the member shape. A `file` icon exposes the
 * blob sha256 only — the mod's file NAME never leaves the server (R6).
 */
import type {
  ValheimCatalogEntry,
  ValheimCatalogIcon,
  ValheimMapBaseMap,
} from '@raid-ledger/contract';
import type { ValheimItemCatalogEntryRow } from '../../../../drizzle/schema';
import type { ArmoryDetailReadRow } from './valheim-armory-read.mappers';

/** The catalogue row as the detail read loads it (items already subset). */
export interface ArmoryCatalogReadRow {
  items: Record<string, ValheimItemCatalogEntryRow>;
  atlasSha256: string | null;
  atlasWidth: number | null;
  atlasHeight: number | null;
  atlasReady: boolean;
}

/** The two additive detail fields. */
export interface ArmoryCatalogProjection {
  items: Record<string, ValheimCatalogEntry>;
  atlas: ValheimMapBaseMap | null;
}

type Sheet = Pick<ArmoryDetailReadRow, 'equipment' | 'inventory' | 'trophies'>;

/** Distinct prefab ids the sheet references, sorted. */
export function referencedPrefabs(sheet: Sheet): string[] {
  const set = new Set<string>();
  for (const e of sheet.equipment) set.add(e.item.prefab);
  for (const s of sheet.inventory.items) set.add(s.item.prefab);
  for (const t of sheet.trophies) set.add(t);
  return [...set].sort();
}

/** Stored icon → member icon; a file icon without a blob is unresolved. */
export function toCatalogIcon(
  icon: ValheimItemCatalogEntryRow['icon'],
): ValheimCatalogIcon | null {
  if (icon === null) return null;
  if (icon.kind === 'atlas') {
    return { kind: 'atlas', x: icon.x, y: icon.y, w: icon.w, h: icon.h };
  }
  return icon.sha256 === null ? null : { kind: 'file', sha256: icon.sha256 };
}

function toEntry(row: ValheimItemCatalogEntryRow): ValheimCatalogEntry {
  return {
    name: row.name,
    category: row.category,
    icon: toCatalogIcon(row.icon),
  };
}

function toAtlas(row: ArmoryCatalogReadRow): ValheimMapBaseMap | null {
  const { atlasSha256: sha256, atlasWidth: width } = row;
  const height = row.atlasHeight;
  if (sha256 === null || width === null || height === null) return null;
  return { sha256, width, height, ready: row.atlasReady };
}

/** `items` (referenced prefabs only) + `atlas`; no catalogue → `{}`/null. */
export function projectCatalog(
  prefabs: readonly string[],
  catalog: ArmoryCatalogReadRow | null,
): ArmoryCatalogProjection {
  if (!catalog) return { items: {}, atlas: null };
  // Own-property lookup: `constructor` / `toString` / `__proto__` are valid
  // prefab ids and must read as "not in catalogue", never an inherited
  // Object member. `fromEntries` defines own keys (no `__proto__` setter).
  const pairs: [string, ValheimCatalogEntry][] = [];
  for (const prefab of prefabs) {
    if (!Object.hasOwn(catalog.items, prefab)) continue;
    const entry = catalog.items[prefab];
    if (entry) pairs.push([prefab, toEntry(entry)]);
  }
  return { items: Object.fromEntries(pairs), atlas: toAtlas(catalog) };
}
