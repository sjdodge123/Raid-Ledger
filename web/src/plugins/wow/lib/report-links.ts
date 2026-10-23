/** Every WoW-family game slug starts with this (retail, every Classic flavour, Forever). */
const WOW_SLUG_PREFIX = 'world-of-warcraft';

/**
 * Warcraft Logs / foreverlogs.gg report links make sense for WoW-family games
 * only — the WoW plugin declares that through `registerEventReportLinks`.
 */
export function supportsEventReportLinks(gameSlug: string): boolean {
    return gameSlug === WOW_SLUG_PREFIX || gameSlug.startsWith(`${WOW_SLUG_PREFIX}-`);
}
