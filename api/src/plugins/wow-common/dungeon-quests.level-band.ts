/**
 * ROK-1908 (operator ruling: new dungeons show the dungeon's level band). An
 * imported-only quest has no level of its own, so its card shows the level
 * band of the dungeon it is filed under, read from the variant-aware instance
 * catalogue (Forever rows carry the in-game finder spans).
 */
import {
  getAnyVariant,
  getInstance,
} from './instance-catalogue/instance-catalogue';
import type { CatalogueVariant } from './instance-catalogue/instance-catalogue.types';
import type { QuestLevelBand } from './dungeon-quests.types';

/**
 * The overlay is the Forever quest import, so a read with no variant (the
 * Forever known-quest set, chain links) uses the Forever rows.
 */
export const OVERLAY_BAND_VARIANT: CatalogueVariant = 'wow_forever';

/**
 * Only a Forever guild reads the Forever finder spans; every other variant
 * (classic_era, classic_era_sod, classic_anniversary, classic, retail) reads
 * the classic_era row, so a Classic guild never shows a Forever band.
 */
function asCatalogueVariant(v: string): CatalogueVariant {
  return v === 'wow_forever' ? 'wow_forever' : 'classic_era';
}

/**
 * The catalogue band of `instanceId` for `variant` (falling back to any
 * variant's row only for an id the variant lacks, i.e. a Forever-only
 * dungeon), or null for no dungeon / an id outside the catalogue.
 */
export function instanceLevelBand(
  instanceId: number | null,
  variant: string = OVERLAY_BAND_VARIANT,
): QuestLevelBand | null {
  if (instanceId === null) return null;
  const v = asCatalogueVariant(variant);
  const row = getInstance(instanceId, v) ?? getAnyVariant(instanceId);
  return row ? { min: row.minimumLevel, max: row.maximumLevel } : null;
}
