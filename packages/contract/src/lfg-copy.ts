/**
 * ROK-1505 D5 — the one sentence an LFG group is described with, shared by the
 * web chips and the Discord board's thread title.
 *
 * Moved VERBATIM from `web/src/components/lfg/lfg-chip-copy.ts` (ROK-1478 D4),
 * which is now a re-export shim, so the events banner, the card badge and the
 * forum post title cannot drift apart about the same group. The operator's
 * ruling on ROK-1505 is that the board is aligned with the chips; two copies of
 * this sentence is exactly how the two web surfaces drifted before ROK-1478.
 *
 * Deliberately NOT `pages/lfg/lfg-copy.ts::lookingLine`, which has no
 * `max(1, …)` clamp and falls back to different prose when the threshold is
 * null — reusing it would silently change the group page (ROK-1478 AC7
 * forbids that).
 *
 * Emoji-free on purpose: `nowLine` and `chipLabel` stay in web because they
 * carry the 🔥 / 🎯 the Discord surface does not want.
 */

/** Assumed group size when a game has no Co-Optimus data: two players. */
export const DEFAULT_VIABILITY_THRESHOLD = 2;

/**
 * The threshold a group is actually measured against — never below
 * {@link DEFAULT_VIABILITY_THRESHOLD}.
 *
 * `games.cooptimus_online_max` is NOT a plain "max players" column. The
 * Co-Optimus sync writes `0` as a POSITIVE "this game has no Co-Optimus co-op
 * entry" marker (`cooptimus-sync.service.ts::markNoEntry`), and a matched
 * entry can legitimately carry `1`. Read literally, either value makes a group
 * of ONE viable — which is how the group page came to print
 * `1 looking - one more makes it a group` directly above
 * `You have a full group` (ROK-1532; PEAK stores `0`).
 *
 * ONE floor, shared by this file's copy and the server's `isViable`, so the
 * sentence and the banner can never disagree again.
 *
 * @param raw - `games.cooptimusOnlineMax`, or null/undefined when unknown.
 */
export function effectiveViabilityThreshold(raw?: number | null): number {
  if (raw == null) return DEFAULT_VIABILITY_THRESHOLD;
  return Math.max(DEFAULT_VIABILITY_THRESHOLD, raw);
}

/**
 * How many more players the group still needs — never fewer than one, so a
 * single-player group never reads "needs 0 more".
 *
 * @param activeCount - Live intents on the game.
 * @param viabilityThreshold - `games.cooptimusOnlineMax`, when it is known.
 */
export function playersStillNeeded(
  activeCount: number,
  viabilityThreshold?: number | null,
): number {
  const target = effectiveViabilityThreshold(viabilityThreshold);
  return Math.max(1, target - activeCount);
}

/**
 * The server's `state`, or the count's own verdict when it is absent — a group
 * of 2+ is `lfm` ("join them"), anything less is `lfg` ("they need you").
 *
 * @param activeCount - Live intents on the game.
 * @param state - Server-derived state, when the payload carries one.
 */
export function effectiveLfgState(
  activeCount: number,
  state?: 'lfg' | 'lfm' | null,
): 'lfg' | 'lfm' {
  return state ?? (activeCount >= 2 ? 'lfm' : 'lfg');
}

/**
 * The group's state in words, WITHOUT the 🎯 — `N looking to play` once a group
 * has formed, or `N looking · needs M more` while it still needs people.
 *
 * Emoji-free so a caller that already leads with 🎯 (the events banner, which
 * reads `🎯 {gameName} · {groupLine}`) does not print two of them.
 *
 * @param activeCount - Live intents on the game.
 * @param state - `lfm` (2+) or `lfg` (still recruiting).
 * @param viabilityThreshold - `games.cooptimusOnlineMax`, when it is known.
 */
export function groupLine(
  activeCount: number,
  state: 'lfg' | 'lfm',
  viabilityThreshold?: number | null,
): string {
  if (state === 'lfm') return `${activeCount} looking to play`;
  const needed = playersStillNeeded(activeCount, viabilityThreshold);
  return `${activeCount} looking · needs ${needed} more`;
}
