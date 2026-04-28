/**
 * WoW profession max skill cap by game variant.
 *
 * The `apiNamespacePrefix` alone is ambiguous (the `classic` prefix covers
 * both BC Classic at 375 and Wrath Classic at 450), so we key the lookup off
 * the games table slug. Retail variants and unmapped slugs default to 100,
 * which matches the per-expansion tier cap Blizzard returns on retail.
 */

const BY_SLUG: Record<string, number> = {
  // Vanilla / Era / Anniversary 1x
  'world-of-warcraft-classic': 300,
  // Burning Crusade era
  'world-of-warcraft-burning-crusade-classic': 375,
  'world-of-warcraft-burning-crusade-classic-anniversary-edition': 375,
  // Wrath of the Lich King era
  'world-of-warcraft-wrath-of-the-lich-king-classic': 450,
  // Cataclysm era
  'world-of-warcraft-cataclysm-classic': 525,
  // Mists of Pandaria era
  'world-of-warcraft-mists-of-pandaria-classic': 600,
  // Season of Discovery rides Vanilla 1x's cap
  'world-of-warcraft-classic-season-of-discovery': 300,
};

/**
 * Derive the max skill cap for a profession in the given game.
 * Retail variants and unrecognised slugs return 100 (current per-expansion tier).
 */
export function getMaxProfessionSkill(gameSlug: string | null | undefined): number {
  if (!gameSlug) return 100;
  return BY_SLUG[gameSlug] ?? 100;
}
