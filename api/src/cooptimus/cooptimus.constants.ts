/**
 * Co-Optimus enrichment constants (ROK-1397).
 *
 * The public keyless XML API. Access is Cloudflare-gated for unattended
 * clients — the transport only activates once the operator configures an
 * allowlisted user-agent (see SettingsService cooptimus accessors), per the
 * permission-first posture in docs/spikes/rok-275-co-optimus-spike.md.
 */

export const COOPTIMUS_API_BASE = 'https://api.co-optimus.com/games.php';

/**
 * Hosts the game-page fetch may talk to. The `<url>` we follow comes from an
 * external XML response, so without this the sync is an SSRF primitive: any
 * http(s) URL in that field would be requested server-side, from inside the
 * network, by a trusted background job (Codex pre-push review).
 */
export const COOPTIMUS_ALLOWED_HOSTS = new Set([
  'co-optimus.com',
  'www.co-optimus.com',
  'api.co-optimus.com',
]);

/** robots.txt asks crawl-delay: 1 — stay above it. */
export const COOPTIMUS_RATE_LIMIT_MS = 1100;

/** Weekly delta sync — Mondays 06:20 UTC (quiet window, offset from ITAD's cadence). */
export const COOPTIMUS_SYNC_CRON = '20 6 * * 1';

/** Re-sync rows whose data is older than this (days). */
export const COOPTIMUS_STALE_AFTER_DAYS = 14;

/**
 * Edition/DLC suffixes whose base title exists on Co-Optimus (measured +13
 * library names in the ROK-275 probe). A stripped-suffix hit routes to the
 * REVIEW QUEUE, never auto-maps — "Fortnite" → "Fortnite: Save the World"
 * taught us subtitle variants can over-claim.
 */
export const EDITION_SUFFIX_RE =
  // A colon or whitespace MUST precede word suffixes — zero-width prefixes
  // stripped mid-word ('Marigold'→'Mari', 'Expedition'→'Exp'; review finding).
  // The bare '+' branch stays zero-width for 'Repentance+'-style names.
  /(?:[:\s]\s*(?:game of the year|goty|definitive|complete|ultimate|special|gold|deluxe|enhanced|remastered|anniversary)(?:\s+edition)?|[:\s]\s*edition|\s+plus|\s*\+)\s*$/i;

/** Redis list holding review-queue candidates for the admin surface. */
export const COOPTIMUS_REVIEW_QUEUE_KEY = 'cooptimus:review-queue';

/** Cap the review queue so repeated syncs can't grow it unbounded. */
export const COOPTIMUS_REVIEW_QUEUE_MAX = 200;
