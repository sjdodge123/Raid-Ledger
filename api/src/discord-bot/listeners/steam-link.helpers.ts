/**
 * Pure URL parsing helpers for Steam store links (ROK-966).
 *
 * Extracts Steam app IDs from Discord message content.
 * Only matches canonical store.steampowered.com/app/:id URLs.
 */

/** Maximum number of Steam app IDs to extract per message. */
const MAX_STEAM_URLS = 3;

/**
 * Regex to match Steam store app URLs.
 * Captures the numeric app ID from URLs like:
 *   https://store.steampowered.com/app/730/CS2/
 *   http://store.steampowered.com/app/570
 *
 * Does NOT match:
 *   - www.store.steampowered.com (non-canonical)
 *   - steamcommunity.com
 *   - store.steampowered.com/bundle/...
 */
const STEAM_STORE_APP_REGEX =
  /https?:\/\/store\.steampowered\.com\/app\/(\d+)/g;

/**
 * Parse Steam store app IDs from a Discord message content string.
 *
 * Returns deduplicated app IDs, capped at MAX_STEAM_URLS (3).
 * Only matches canonical `store.steampowered.com/app/:id` URLs.
 *
 * @param content - The message content to parse
 * @returns Array of unique Steam app IDs (max 3)
 */
export function parseSteamAppIds(content: string): number[] {
  const seen = new Set<number>();
  const results: number[] = [];
  let match: RegExpExecArray | null;
  const regex = new RegExp(STEAM_STORE_APP_REGEX.source, 'g');

  while ((match = regex.exec(content)) !== null) {
    const appId = parseInt(match[1], 10);
    if (!seen.has(appId)) {
      seen.add(appId);
      results.push(appId);
    }
    if (results.length >= MAX_STEAM_URLS) break;
  }

  return results;
}
