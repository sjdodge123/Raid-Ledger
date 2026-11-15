/**
 * ROK-2210: the one reader of the instance catalogue. Pure functions so
 * scripts and pure helpers can import it without DI; the Nest wrapper is
 * `InstanceCatalogueService`.
 */
import type { WowGameVariant } from '@raid-ledger/contract';
import type { WowInstance, WowInstanceDetail } from '../blizzard.constants';
import { CATALOGUE_ROWS } from './instance-catalogue.data';
import type {
  CatalogueCategory,
  CatalogueInstance,
  CatalogueVariant,
  LevelSource,
} from './instance-catalogue.types';

export { FOREVER_SEED_ID_BASE } from './forever-new.data';

/** List DTO: today's `WowInstance` plus the two catalogue fields. */
export type CatalogueListDto = WowInstance & {
  levelSource: LevelSource;
  wowheadZoneId: number | null;
};

/** Detail DTO: today's `WowInstanceDetail` plus the two catalogue fields. */
export type CatalogueDetailDto = WowInstanceDetail & {
  levelSource: LevelSource;
  wowheadZoneId: number | null;
};

/** `getAnyVariant` preference (D6). */
const ANY_VARIANT_ORDER: readonly CatalogueVariant[] = [
  'wow_forever',
  'classic_era',
];

function rowKey(id: number, variant: CatalogueVariant): string {
  return `${variant}:${id}`;
}

const BY_ID_AND_VARIANT: ReadonlyMap<string, CatalogueInstance> = new Map(
  CATALOGUE_ROWS.flatMap((row) =>
    row.variants.map((v): [string, CatalogueInstance] => [
      rowKey(row.id, v),
      row,
    ]),
  ),
);

/** Every row (all variants, listed or not) — for specs and guards. */
export function allCatalogueRows(): readonly CatalogueInstance[] {
  return CATALOGUE_ROWS;
}

/** True for the variants the catalogue serves (`classic_era`, `wow_forever`). */
export function servesVariant(v: WowGameVariant): v is CatalogueVariant {
  return v === 'classic_era' || v === 'wow_forever';
}

/** Listed rows of one variant and category, in list order (D10). */
export function listInstances(
  v: CatalogueVariant,
  c: CatalogueCategory,
): CatalogueInstance[] {
  return CATALOGUE_ROWS.filter(
    (r) => r.listed && r.category === c && r.variants.includes(v),
  );
}

/** The row for (id, variant), or null. Unlisted parents resolve too. */
export function getInstance(
  id: number,
  v: CatalogueVariant,
): CatalogueInstance | null {
  return BY_ID_AND_VARIANT.get(rowKey(id, v)) ?? null;
}

/** The row for an id in any variant, preferring `wow_forever` (D6). */
export function getAnyVariant(id: number): CatalogueInstance | null {
  for (const v of ANY_VARIANT_ORDER) {
    const row = getInstance(id, v);
    if (row) return row;
  }
  return null;
}

export function isCatalogueId(id: number): boolean {
  return getAnyVariant(id) !== null;
}

/** Wing parent id (e.g. 31601 → 316, 1276 → 230), or null. */
export function parentIdOf(id: number): number | null {
  return getAnyVariant(id)?.parentId ?? null;
}

/** Quest-view name: `questName ?? name`, else `Instance <id>`. */
export function instanceName(id: number): string {
  const row = getAnyVariant(id);
  return row ? (row.questName ?? row.name) : `Instance ${id}`;
}

/** The row a Wowhead zone id stands for, preferring a non-wing (parent) row. */
export function byWowheadZoneId(
  zoneId: number,
  v: CatalogueVariant,
): CatalogueInstance | null {
  const hits = CATALOGUE_ROWS.filter(
    (r) => r.wowheadZoneId === zoneId && r.variants.includes(v),
  );
  return hits.find((r) => r.parentId === null) ?? hits[0] ?? null;
}

/** Every Forever row carrying a Forever quest-area id (wings included). */
export function byForeverQuestAreaId(areaId: number): CatalogueInstance[] {
  return CATALOGUE_ROWS.filter(
    (r) =>
      r.variants.includes('wow_forever') &&
      r.foreverQuestAreaIds.includes(areaId),
  );
}

/** Lowest `minimumLevel` among a variant's listed dungeons. */
export function lowestDungeonLevel(v: CatalogueVariant): number {
  return Math.min(...listInstances(v, 'dungeon').map((r) => r.minimumLevel));
}

export function toListDto(r: CatalogueInstance): CatalogueListDto {
  return {
    id: r.id,
    name: r.name,
    shortName: r.shortName,
    expansion: r.expansion,
    minimumLevel: r.minimumLevel,
    maximumLevel: r.maximumLevel,
    levelSource: r.levelSource,
    wowheadZoneId: r.wowheadZoneId,
  };
}

export function toDetailDto(r: CatalogueInstance): CatalogueDetailDto {
  return {
    ...toListDto(r),
    minimumLevel: r.minimumLevel,
    maxPlayers: r.maxPlayers,
    category: r.category,
  };
}
