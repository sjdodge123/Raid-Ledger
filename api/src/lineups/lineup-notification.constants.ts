/**
 * Shared constants for Community Lineup notification services (ROK-932).
 */

/** TTL for dedup records (7 days in seconds). */
export const DEDUP_TTL = 7 * 24 * 3600;

/** Per-match cooldown for the manual "remind voters" nudge (1h, ROK-1395). */
export const MANUAL_REMIND_COOLDOWN_TTL = 3600;

/** Per-recipient dedup for the manual nudge (24h, ROK-1395). */
export const MANUAL_REMIND_RECIPIENT_TTL = 24 * 3600;

/**
 * Recurrence window for the automatic scheduling-poll vote nudge.
 * SECONDS (the unit `NotificationDedupService.checkAndMarkSent` expects) —
 * fixed expiry + lazy re-insert yields exactly one nudge per 48h window.
 */
export const POLL_NUDGE_TTL_SECONDS = 48 * 3600;

/**
 * Grace period before a poll member's first automatic nudge (hours).
 * Members are inserted at poll creation, so this doubles as a poll-age
 * floor: the creation-time DM already covered the first two days.
 */
export const POLL_NUDGE_MIN_MEMBER_AGE_HOURS = 48;

/**
 * Suppress the automatic nudge once a poll's `phase_deadline` is this close
 * (hours) — inside the window the deadline reminder services own the channel.
 */
export const POLL_NUDGE_DEADLINE_HANDOFF_HOURS = 24;
