/**
 * ROK-2209: which loot expansions a boss-loot read may return. For the
 * catalogue-served variants (`classic_era`, `wow_forever`) the instance
 * catalogue's `lootExpansion` decides (ROK-2270: a labelled per-boss Classic
 * fallback is `lootFallbackExpansionFor`, below). An instance the catalogue does not know fails closed to the
 * variant's own expansion. Every other variant keeps its expansion set.
 */
import { getInstance } from './instance-catalogue/instance-catalogue';
import type {
  CatalogueInstance,
  CatalogueVariant,
} from './instance-catalogue/instance-catalogue.types';

type LootExpansion = CatalogueInstance['lootExpansion'];

/** The expansion an uncatalogued instance reads, per catalogue variant. */
const CATALOGUE_DEFAULT: Readonly<Record<CatalogueVariant, LootExpansion>> = {
  classic_era: 'classic',
  wow_forever: 'forever',
};

function isCatalogueVariant(variant: string): variant is CatalogueVariant {
  return Object.hasOwn(CATALOGUE_DEFAULT, variant);
}

/**
 * Loot expansions for a boss on `instanceId` under `variant`. `fallback` is
 * the variant's expansion set for non-catalogue variants (passed in so this
 * module does not import the service).
 */
export function lootExpansionsFor(
  variant: string,
  instanceId: number,
  fallback: (variant: string) => string[],
): string[] {
  if (!isCatalogueVariant(variant)) return fallback(variant);
  const row = getInstance(instanceId, variant);
  return [row?.lootExpansion ?? CATALOGUE_DEFAULT[variant]];
}

/**
 * ROK-2270 (operator 2026-11-20, partially reverses ROK-2209): the expansion
 * a read falls back to when a boss has no rows of its own expansion. Only a
 * WoW: Forever read of an instance that has a Classic edition falls back, to
 * the Classic rows — the web labels them as Classic. Real Forever rows always
 * win (the caller falls back on an empty read only), and Forever-new dungeons
 * (no Classic edition) get no fallback, so they keep reading as `[]`.
 */
export function lootFallbackExpansionFor(
  variant: string,
  instanceId: number,
): LootExpansion | null {
  if (variant !== 'wow_forever') return null;
  return getInstance(instanceId, 'classic_era') ? 'classic' : null;
}
