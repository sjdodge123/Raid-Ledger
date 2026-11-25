/**
 * ROK-2352 §2.1 / §3.4 — the WoW LFG group catalogue: which dungeons and
 * raids a WoW game slug offers, and the opaque `dungeon:<id>` / `raid:<id>`
 * keys that name them. Pure: no DI, no DB.
 *
 * Variant source (§8, L5): `world-of-warcraft-classic` is Classic ERA
 * (`classic_era`, the local catalogue), `world-of-warcraft-forever` is
 * `wow_forever` (local catalogue); retail / TBC / Wrath / Anniversary are
 * journal-served through `BlizzardService.fetchAllInstances`.
 */
import {
  wowRosterShapeForSize,
  type WowGameVariant,
} from '@raid-ledger/contract';
import type { LfgGroupDescriptor } from '../../plugin-host/lfg-grouping.adapter';
import {
  listInstances,
  servesVariant,
} from '../instance-catalogue/instance-catalogue';
import type { CatalogueCategory } from '../instance-catalogue/instance-catalogue.types';

/** Slug → the instance variant (same table as web `slugToContentVariant`). */
const SLUG_VARIANT: ReadonlyMap<string, WowGameVariant> = new Map([
  ['world-of-warcraft', 'retail'],
  ['world-of-warcraft-classic', 'classic_era'],
  [
    'world-of-warcraft-burning-crusade-classic-anniversary-edition',
    'classic_anniversary',
  ],
  ['world-of-warcraft-burning-crusade-classic', 'classic'],
  ['world-of-warcraft-wrath-of-the-lich-king', 'classic'],
  ['world-of-warcraft-forever', 'wow_forever'],
]);

/** Catalogue region when the caller names none (mirrors `/blizzard/instances`). */
export const WOW_LFG_DEFAULT_REGION = 'us';

/** One dungeon or raid an LFG group can be about. */
export interface WowLfgInstance {
  id: number;
  name: string;
  shortName?: string;
  expansion: string;
  category: CatalogueCategory;
  /** null → the category default size (§3.4). */
  maxPlayers: number | null;
  minimumLevel: number | null;
  maximumLevel: number | null;
}

/**
 * The instance variant of a WoW slug, or null for a non-WoW slug.
 *
 * @param slug - Game slug.
 */
export function wowVariantForSlug(slug: string): WowGameVariant | null {
  return SLUG_VARIANT.get(slug) ?? null;
}

/**
 * The group key for an instance (`dungeon:<id>` / `raid:<id>`).
 *
 * @param inst - The instance.
 */
export function wowGroupKey(inst: Pick<WowLfgInstance, 'category' | 'id'>): string {
  return `${inst.category}:${inst.id}`;
}

/**
 * `dungeon:<id>` / `raid:<id>` → its parts, or null for any other key.
 *
 * @param key - An opaque LFG group key.
 */
export function parseWowGroupKey(
  key: string,
): { category: CatalogueCategory; id: number } | null {
  const m = /^(dungeon|raid):([1-9]\d{0,8})$/.exec(key);
  const category = m?.[1];
  const id = m?.[2];
  if (category !== 'dungeon' && category !== 'raid') return null;
  return id === undefined ? null : { category, id: Number(id) };
}

/**
 * The listed catalogue dungeons then raids of a catalogue-served variant,
 * or null when the variant is journal-served.
 *
 * @param variant - The game's instance variant.
 */
export function catalogueInstancesFor(
  variant: WowGameVariant,
): WowLfgInstance[] | null {
  if (!servesVariant(variant)) return null;
  const rows = [
    ...listInstances(variant, 'dungeon'),
    ...listInstances(variant, 'raid'),
  ];
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    shortName: r.shortName,
    expansion: r.expansion,
    category: r.category,
    maxPlayers: r.maxPlayers,
    minimumLevel: r.minimumLevel,
    maximumLevel: r.maximumLevel,
  }));
}

/**
 * The size an instance's group is shaped for: its `maxPlayers`, else the
 * category default (dungeon 5, raid 10).
 *
 * @param inst - The instance.
 */
export function wowInstanceSize(inst: WowLfgInstance): number {
  const shape = wowRosterShapeForSize(inst.maxPlayers, inst.category);
  return shape.tank + shape.healer + shape.dps;
}

/**
 * An instance as the LFG group it names.
 *
 * @param inst - The instance.
 */
export function toWowGroupDescriptor(inst: WowLfgInstance): LfgGroupDescriptor {
  const { minimumLevel: lo, maximumLevel: hi } = inst;
  return {
    key: wowGroupKey(inst),
    label: inst.name,
    kind: inst.category,
    size: wowInstanceSize(inst),
    rosterShape: wowRosterShapeForSize(inst.maxPlayers, inst.category),
    ...(lo != null && hi != null ? { levelRange: [lo, hi] as [number, number] } : {}),
  };
}
