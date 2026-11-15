/**
 * ROK-2210: every catalogue row, in list order (D10): Classic rows in
 * journal order, then the Forever editions (finder levels from
 * `forever-levels.data.ts`), then Forever-new. Read ONLY by
 * `instance-catalogue.ts`.
 */
import { classicEraRow, foreverEdition } from './catalogue-builders';
import { CLASSIC_DUNGEON_DEFS } from './classic-era-dungeons.data';
import { CLASSIC_RAID_DEFS } from './classic-era-raids.data';
import { FOREVER_FINDER_LEVELS } from './forever-levels.data';
import { FOREVER_NEW_ROWS } from './forever-new.data';
import type { CatalogueInstance } from './instance-catalogue.types';

const CLASSIC_DEFS = [...CLASSIC_DUNGEON_DEFS, ...CLASSIC_RAID_DEFS];

export const CATALOGUE_ROWS: readonly CatalogueInstance[] = [
  ...CLASSIC_DEFS.map(classicEraRow),
  ...CLASSIC_DEFS.map((def) =>
    foreverEdition(
      classicEraRow(def),
      def.areas,
      FOREVER_FINDER_LEVELS.get(def.id),
    ),
  ),
  ...FOREVER_NEW_ROWS,
];
