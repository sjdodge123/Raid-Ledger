/**
 * ROK-2056 — where Raid Ledger points members to install the Raid Ledger
 * Companion (rl-companion). One place for the download link and its copy.
 */

/**
 * The Companion's GitHub releases page. `/releases`, not `/releases/latest`:
 * test builds are published as pre-releases (ROK-2057), which `/latest` skips.
 */
export const COMPANION_DOWNLOAD_URL =
  "https://github.com/Raid-Ledger-Plugins/rl-companion/releases";

/**
 * Off until the first public release exists (ROK-2057's first tag). While
 * false, no download affordance renders anywhere; the linked-device list still
 * does. Flip in one place.
 */
export const COMPANION_DOWNLOAD_AVAILABLE = false;

/** Shown under the Download button: what the releases page offers. */
export const COMPANION_DOWNLOAD_FORMATS = "Windows .exe · macOS .dmg";

/**
 * Builds are unsigned until ROK-1963 ships signing; remove these then.
 * Plain words for the warning each OS shows the first time.
 */
export const COMPANION_UNSIGNED_NOTE = {
  windows:
    "Windows may say “Windows protected your PC”: choose More info, then Run anyway.",
  macos: "On a Mac, right-click the app and choose Open the first time.",
} as const;
