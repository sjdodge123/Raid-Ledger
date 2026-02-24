/**
 * WoW class icon URLs from Blizzard CDN.
 * Used in web UI to show class icons next to character names.
 * Keys match the class names returned by the Blizzard API / stored in the DB.
 */

const CDN_BASE = 'https://render.worldofwarcraft.com/us/icons/56';

/** Map of WoW class name -> Blizzard CDN icon URL */
export const WOW_CLASS_ICONS: Record<string, string> = {
  Warrior: `${CDN_BASE}/classicon_warrior.jpg`,
  Paladin: `${CDN_BASE}/classicon_paladin.jpg`,
  Hunter: `${CDN_BASE}/classicon_hunter.jpg`,
  Rogue: `${CDN_BASE}/classicon_rogue.jpg`,
  Priest: `${CDN_BASE}/classicon_priest.jpg`,
  'Death Knight': `${CDN_BASE}/classicon_deathknight.jpg`,
  Shaman: `${CDN_BASE}/classicon_shaman.jpg`,
  Mage: `${CDN_BASE}/classicon_mage.jpg`,
  Warlock: `${CDN_BASE}/classicon_warlock.jpg`,
  Monk: `${CDN_BASE}/classicon_monk.jpg`,
  Druid: `${CDN_BASE}/classicon_druid.jpg`,
  'Demon Hunter': `${CDN_BASE}/classicon_demonhunter.jpg`,
  Evoker: `${CDN_BASE}/classicon_evoker.jpg`,
};

/** Get class icon URL for a WoW class name, or null if not recognized. */
export function getClassIconUrl(className: string | null | undefined): string | null {
  if (!className) return null;
  return WOW_CLASS_ICONS[className] ?? null;
}
