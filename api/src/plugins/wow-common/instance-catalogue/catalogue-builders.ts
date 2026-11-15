/**
 * ROK-2210: row builders for the instance catalogue data files. A Classic
 * definition yields a `classic_era` row (`classicEraRow`) and its Forever
 * edition (`foreverEdition`), so the two stay in step without copy-paste.
 */
import type {
  CatalogueCategory,
  CatalogueInstance,
} from './instance-catalogue.types';

/** [minimumLevel, maximumLevel, maxPlayers]. */
export type LevelTriple = readonly [number, number, number];

export interface ClassicExtras {
  readonly parent?: number;
  readonly unlisted?: true;
  readonly questName?: string;
}

export interface ClassicDef {
  readonly id: number;
  readonly name: string;
  readonly shortName: string;
  readonly category: CatalogueCategory;
  readonly levels: LevelTriple;
  /** Forever `quest/area/index` ids (applied to the Forever edition only). */
  readonly areas: readonly number[];
  readonly zone: number | null;
  readonly extras: ClassicExtras;
}

function classicDef(
  category: CatalogueCategory,
  head: readonly [number, string, string],
  levels: LevelTriple,
  where: readonly [readonly number[], number | null],
  extras: ClassicExtras,
): ClassicDef {
  const [id, name, shortName] = head;
  const [areas, zone] = where;
  return { id, name, shortName, category, levels, areas, zone, extras };
}

/** A Classic dungeon definition: `dungeon([id, name, short], levels, [areas, zone])`. */
export function dungeon(
  head: readonly [number, string, string],
  levels: LevelTriple,
  where: readonly [readonly number[], number | null],
  extras: ClassicExtras = {},
): ClassicDef {
  return classicDef('dungeon', head, levels, where, extras);
}

/** A Classic raid definition (same shape as `dungeon`). */
export function raid(
  head: readonly [number, string, string],
  levels: LevelTriple,
  where: readonly [readonly number[], number | null],
): ClassicDef {
  return classicDef('raid', head, levels, where, {});
}

/** The `classic_era` row of a Classic definition. */
export function classicEraRow(def: ClassicDef): CatalogueInstance {
  const [minimumLevel, maximumLevel, maxPlayers] = def.levels;
  const { questName } = def.extras;
  return {
    id: def.id,
    variants: ['classic_era'],
    name: def.name,
    ...(questName !== undefined ? { questName } : {}),
    shortName: def.shortName,
    expansion: 'Classic',
    category: def.category,
    parentId: def.extras.parent ?? null,
    listed: def.extras.unlisted !== true,
    minimumLevel,
    maximumLevel,
    levelSource: 'classic_era',
    maxPlayers,
    foreverQuestAreaIds: [],
    wowheadZoneId: def.zone,
    lootExpansion: 'classic',
  };
}

/** The Forever version of a Classic row: same id/name/levels, Forever loot. */
export function foreverEdition(
  row: CatalogueInstance,
  areas: readonly number[],
): CatalogueInstance {
  return {
    ...row,
    variants: ['wow_forever'],
    expansion: 'Forever',
    lootExpansion: 'forever',
    foreverQuestAreaIds: areas,
  };
}

/** A Forever-new instance (no Classic counterpart; community levels). */
export function foreverNew(
  head: readonly [number, string, string],
  category: CatalogueCategory,
  levels: LevelTriple,
  where: readonly [readonly number[], number | null],
): CatalogueInstance {
  const [id, name, shortName] = head;
  const [minimumLevel, maximumLevel, maxPlayers] = levels;
  const [foreverQuestAreaIds, wowheadZoneId] = where;
  return {
    id,
    variants: ['wow_forever'],
    name,
    shortName,
    expansion: 'Forever',
    category,
    parentId: null,
    listed: true,
    minimumLevel,
    maximumLevel,
    levelSource: 'community',
    maxPlayers,
    foreverQuestAreaIds,
    wowheadZoneId,
    lootExpansion: 'forever',
  };
}
