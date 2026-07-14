/**
 * Shared constants for Community Lineup notification services (ROK-932).
 */

/** TTL for dedup records (7 days in seconds). */
export const DEDUP_TTL = 7 * 24 * 3600;

/** Per-match cooldown for the manual "remind voters" nudge (1h, ROK-1395). */
export const MANUAL_REMIND_COOLDOWN_TTL = 3600;

/** Per-recipient dedup for the manual nudge (24h, ROK-1395). */
export const MANUAL_REMIND_RECIPIENT_TTL = 24 * 3600;
