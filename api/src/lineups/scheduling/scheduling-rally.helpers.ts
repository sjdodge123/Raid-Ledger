/**
 * Pure helpers for the organiser "Rally" nudge (ROK-1618).
 *
 * The rally reuses the recurring nudge's audience query, its copy and its
 * per-member dedup key wholesale (see `scheduling-poll-nudge.helpers.ts`), so
 * the only thing it owns is the PER-POLL cooldown that stops an organiser
 * pressing the button repeatedly. That cooldown is a `NotificationDedupService`
 * key rather than a column — no migration, same mechanism as the manual
 * "Remind voters" cooldown.
 *
 * The success copy (`summariseRally`) deliberately lives in
 * `@raid-ledger/contract` instead, because the web toast reads the same table.
 */

/** Prefix for the per-poll rally cooldown key. Distinct from the per-member
 * nudge key (`sched-poll-nudge:…`), which the rally SHARES with the cron. */
const RALLY_COOLDOWN_PREFIX = 'sched-poll-rally-cooldown';

/**
 * Dedup key for one poll's rally cooldown.
 *
 * Keyed by match, not by organiser: the cooldown protects the POLL's members
 * from a second fan-out, so a co-operator pressing Rally a minute later must
 * hit the same key.
 *
 * @param matchId - Scheduling match the rally targets.
 * @returns Key for `NotificationDedupService.checkAndMarkSent` / `releaseKey`.
 */
export function rallyCooldownKey(matchId: number): string {
  return `${RALLY_COOLDOWN_PREFIX}:${matchId}`;
}
