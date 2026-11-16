/**
 * ROK-2209: which loot expansions a boss-loot read may return. For the
 * catalogue-served variants (`classic_era`, `wow_forever`) the instance
 * catalogue's `lootExpansion` decides — a Forever read never falls back to
 * Classic loot. An instance the catalogue does not know fails closed to the
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
