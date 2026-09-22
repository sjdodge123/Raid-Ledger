/**
 * Shared constants for Community Lineup notification services (ROK-932).
 */

/** TTL for dedup records (7 days in seconds). */
export const DEDUP_TTL = 7 * 24 * 3600;

/**
 * Dedup TTL for the channel-override fallback warn (10 minutes, in the
 * SECONDS unit `NotificationDedupService.checkAndMarkSent` expects —
 * ROK-1093). Deliberately much shorter than {@link DEDUP_TTL}: if an operator
 * fixes bot permissions and they later break again, the fallback re-warns
 * within minutes instead of staying silent for the rest of the 7-day window.
 */
export const FALLBACK_WARN_TTL_SECONDS = 10 * 60;

/** Per-match cooldown for the manual "remind voters" nudge (1h, ROK-1395). */
export const MANUAL_REMIND_COOLDOWN_TTL = 3600;

/** Per-recipient dedup for the manual nudge (24h, ROK-1395). */
export const MANUAL_REMIND_RECIPIENT_TTL = 24 * 3600;

/**
 * Recurrence window for the automatic scheduling-poll vote nudge.
 * SECONDS (the unit `NotificationDedupService.checkAndMarkSent` expects) —
 * fixed expiry + lazy re-insert yields exactly one nudge per 24h window.
 *
 * Was 48h. Deadline-less polls rely on this nudge as their ONLY follow-up
 * (the deadline reminders require a non-null `phase_deadline`), so a
 * two-day gap was the slowest feedback loop in the poll flow.
 */
export const POLL_NUDGE_TTL_SECONDS = 24 * 3600;

/**
 * Grace period before a poll member's first automatic nudge (hours).
 * Members are inserted at poll creation, so this doubles as a poll-age
 * floor: the creation-time DM already covered the first day.
 */
export const POLL_NUDGE_MIN_MEMBER_AGE_HOURS = 24;

/**
 * Suppress the automatic nudge once a poll's `phase_deadline` is this close
 * (hours) — inside the window the deadline reminder services own the channel.
 */
export const POLL_NUDGE_DEADLINE_HANDOFF_HOURS = 24;

/**
 * ROK-1604: hours before an unlocked scheduling poll's deadline at which the
 * creator is DM'd once with a one-tap lock-in of the leading time.
 */
export const POLL_EXPIRY_WARN_HOURS = 12;

/**
 * Per-poll cooldown for the organiser "Rally" nudge (ROK-1618), in the SECONDS
 * unit `NotificationDedupService.checkAndMarkSent` expects.
 *
 * Deliberately between its two neighbours:
 * - LONGER than {@link MANUAL_REMIND_COOLDOWN_TTL} (1h) because a rally hits
 *   the whole "still owes a vote" audience, not a hand-picked target list.
 * - SHORTER than {@link POLL_NUDGE_TTL_SECONDS} (24h) so a second rally can
 *   still reach members who joined, or whose leading slot changed, since the
 *   first one.
 *
 * It is ALSO the TTL of the rally's own per-member key
 * (`sched-poll-rally:{match}:{slot}:{user}`): the rally does NOT share the
 * cron's 24h `sched-poll-nudge:…` key, so neither action can spend the other's
 * budget, and a rally is at most one DM per member per leading slot per 6h.
 */
export const POLL_RALLY_COOLDOWN_SECONDS = 6 * 3600;
