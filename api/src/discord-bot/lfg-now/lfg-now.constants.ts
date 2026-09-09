/**
 * Constants for the LFG "playing now" auto-spawn (ROK-1494).
 *
 * The threshold counts NOW-HANDS ONLY (operator ruling Q1) — a weekly hand
 * never contributes, which is why it is not the same number as the LFM
 * threshold even though both happen to be 2.
 */

/** How many live `urgency = 'now'` intents a game needs to spawn a session. */
export const LFG_NOW_SPAWN_THRESHOLD = 2;

/** Title suffix for a spawned event: `${gameName} — Playing now`. */
export const LFG_NOW_TITLE_SUFFIX = 'Playing now';

/** Fallback game name, mirroring the Quick Play title builder. */
export const LFG_NOW_FALLBACK_GAME_NAME = 'Gaming';

/**
 * Session length, in minutes (A5 default: reuse Quick Play's 60).
 * Deliberately NOT the group's `ttlMinutes` — the TTL bounds how long a hand
 * stays raised, not how long the session runs, and the ad-hoc reaper keys its
 * orphan window off the event's end.
 */
export const LFG_NOW_EVENT_DURATION_MINUTES = 60;

/** Log prefix — one tag for every line this feature emits. */
export const LFG_NOW_LOG_TAG = '[lfg-now]';
