/**
 * ROK-2210: one variant-aware WoW instance catalogue. A row is unique per
 * (id, variant): the same journal id has a `classic_era` row and a
 * `wow_forever` row (built by `foreverEdition`).
 */
import type { WowGameVariant } from '@raid-ledger/contract';

/** The variants the catalogue serves; the others stay journal-served. */
export type CatalogueVariant = Extract<
  WowGameVariant,
  'classic_era' | 'wow_forever'
>;

/** Where a level range came from (`in_game` once the probe verifies it). */
export type LevelSource = 'in_game' | 'classic_era' | 'community';

export type CatalogueCategory = 'dungeon' | 'raid';

export interface CatalogueInstance {
  readonly id: number;
  /** Rows sharing an id must not share a variant. */
  readonly variants: readonly CatalogueVariant[];
  readonly name: string;
  /** Whole-dungeon name for quest views when it differs from `name`. */
  readonly questName?: string;
  readonly shortName: string;
  /** The label the event picker shows. */
  readonly expansion: 'Classic' | 'Forever';
  readonly category: CatalogueCategory;
  /** Wing parent (31601-04→316, 23201-03→232, 1276/1277→230, 1292→236, 22901→229). */
  readonly parentId: number | null;
  /** false for complex parents whose wings are listed instead (316, 232). */
  readonly listed: boolean;
  readonly minimumLevel: number;
  readonly maximumLevel: number;
  readonly levelSource: LevelSource;
  readonly maxPlayers: number;
  /** `quest/area/index` ids in static-forever-us; [] for classic_era rows. */
  readonly foreverQuestAreaIds: readonly number[];
  /** Wowhead zone id; null = no id known → no link. */
  readonly wowheadZoneId: number | null;
  readonly lootExpansion: 'classic' | 'forever';
}
