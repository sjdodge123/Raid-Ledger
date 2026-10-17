/**
 * Adult content filtering helpers for Steam library sync (ROK-774).
 * Checks ITAD mature flag, ADULT_KEYWORDS, and IGDB adult theme IDs.
 */
import { ADULT_THEME_IDS, ADULT_KEYWORDS } from '../igdb/igdb.constants';

/** Result of adult content check. */
export interface AdultCheckResult {
  isAdult: boolean;
  reason?: string;
}

/** Check if a game name contains adult keywords (case-insensitive). */
function matchesAdultKeyword(name: string): string | undefined {
  const lower = name.toLowerCase();
  return ADULT_KEYWORDS.find((kw) => lower.includes(kw));
}

/** Check if IGDB themes contain adult theme IDs. */
function hasAdultTheme(themes: number[]): boolean {
  return themes.some((t) => ADULT_THEME_IDS.includes(t));
}

/**
 * Determine if a game should be flagged as adult content.
 * Checks ITAD mature flag, keyword blocklist, and IGDB themes.
 */
export function checkAdultContent(
  gameName: string,
  itadMature: boolean,
  igdbThemes?: number[],
): AdultCheckResult {
  if (itadMature) {
    return { isAdult: true, reason: 'ITAD mature flag' };
  }

  const keyword = matchesAdultKeyword(gameName);
  if (keyword) {
    return { isAdult: true, reason: `keyword: ${keyword}` };
  }

  if (igdbThemes && hasAdultTheme(igdbThemes)) {
    return { isAdult: true, reason: 'IGDB adult theme' };
  }

  return { isAdult: false };
}
