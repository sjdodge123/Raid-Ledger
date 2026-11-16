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

function asCatalogueVariant(v: string): CatalogueVariant | null {
  return v === 'classic_era' || v === 'wow_forever' ? v : null;
}

/**
 * The catalogue band of `instanceId` for `variant` (falling back to any
 * variant's row when the variant has none), or null for no dungeon / an id
 * outside the catalogue.
 */
export function instanceLevelBand(
  instanceId: number | null,
  variant: string = OVERLAY_BAND_VARIANT,
): QuestLevelBand | null {
  if (instanceId === null) return null;
  const v = asCatalogueVariant(variant);
  const row =
    (v ? getInstance(instanceId, v) : null) ?? getAnyVariant(instanceId);
  return row ? { min: row.minimumLevel, max: row.maximumLevel } : null;
}
