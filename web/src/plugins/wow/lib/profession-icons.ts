/**
 * WoW profession icon URLs from Blizzard CDN.
 *
 * Used in web UI to show profession icons next to a character's profession entries
 * (detail page panel + roster character card pills).
 *
 * Keys are profession slugs derived from the Blizzard API profession name:
 *   slug = name.toLowerCase().replace(/\s+/g, '-')
 *
 * Map was harvested once from Blizzard's media API
 * (`/data/wow/profession/index` + `/data/wow/media/profession/{id}`)
 * and is intentionally static — no runtime fetch.
 */

const WOW_PROFESSION_ICONS: Record<string, string> = {
  'abominable-stitching': 'https://render.worldofwarcraft.com/us/icons/56/sanctum_features_buildabom.jpg',
  alchemy: 'https://render.worldofwarcraft.com/us/icons/56/ui_profession_alchemy.jpg',
  'alchemy-research': 'https://render.worldofwarcraft.com/us/icons/56/inv_misc_cauldron_shadow.jpg',
  'arcana-manipulation': 'https://render.worldofwarcraft.com/us/icons/56/ability_socererking_arcanemines.jpg',
  archaeology: 'https://render.worldofwarcraft.com/us/icons/56/trade_archaeology.jpg',
  'ascension-crafting': 'https://render.worldofwarcraft.com/us/icons/56/inv_mace_1h_bastionquest_b_01.jpg',
  blacksmithing: 'https://render.worldofwarcraft.com/us/icons/56/ui_profession_blacksmithing.jpg',
  cooking: 'https://render.worldofwarcraft.com/us/icons/56/ui_profession_cooking.jpg',
  'dye-crafting': 'https://render.worldofwarcraft.com/us/icons/56/housing-dye-bonewhite.jpg',
  enchanting: 'https://render.worldofwarcraft.com/us/icons/56/ui_profession_enchanting.jpg',
  engineering: 'https://render.worldofwarcraft.com/us/icons/56/ui_profession_engineering.jpg',
  fishing: 'https://render.worldofwarcraft.com/us/icons/56/ui_profession_fishing.jpg',
  herbalism: 'https://render.worldofwarcraft.com/us/icons/56/ui_profession_herbalism.jpg',
  inscription: 'https://render.worldofwarcraft.com/us/icons/56/ui_profession_inscription.jpg',
  jewelcrafting: 'https://render.worldofwarcraft.com/us/icons/56/ui_profession_jewelcrafting.jpg',
  leatherworking: 'https://render.worldofwarcraft.com/us/icons/56/ui_profession_leatherworking.jpg',
  mining: 'https://render.worldofwarcraft.com/us/icons/56/ui_profession_mining.jpg',
  'protoform-synthesis': 'https://render.worldofwarcraft.com/us/icons/56/inv_progenitor_protoformsynthesis.jpg',
  'shipment-prototype': 'https://render.worldofwarcraft.com/us/icons/56/inv_mechagon_junkyardtinkeringcrafting.jpg',
  skinning: 'https://render.worldofwarcraft.com/us/icons/56/ui_profession_skinning.jpg',
  'soul-cyphering': 'https://render.worldofwarcraft.com/us/icons/56/sha_spell_warlock_demonsoul.jpg',
  'stygia-crafting': 'https://render.worldofwarcraft.com/us/icons/56/inv_blacksmithing_815_khazgorianhammer.jpg',
  'supply-shipments': 'https://render.worldofwarcraft.com/us/icons/56/inv_legion_cache_dreamweavers.jpg',
  tailoring: 'https://render.worldofwarcraft.com/us/icons/56/ui_profession_tailoring.jpg',
  'tuskarr-fishing-gear': 'https://render.worldofwarcraft.com/us/icons/56/inv_10_dungeonjewelry_tuskarr_trinket_1_color4.jpg',
};

/**
 * Look up a profession icon URL by slug.
 * Returns null if the slug isn't in the map (UI should fall back to text-only).
 */
export function getProfessionIconUrl(slug: string | null | undefined): string | null {
  if (!slug) return null;
  return WOW_PROFESSION_ICONS[slug] ?? null;
}

/**
 * Convert a profession name (e.g. from the contract DTO) to its canonical slug.
 * Mirrors the slug derivation used by the backend parser.
 */
export function professionNameToSlug(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '-');
}
