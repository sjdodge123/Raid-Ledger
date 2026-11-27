/**
 * ROK-1455 / ROK-2352 — the `lfg_player_invite` notification payload, split
 * out of `lfg-invite.service.ts` (max-lines). The service re-exports it.
 */
import type { LfgSuggestionReason, LfgUrgency } from '@raid-ledger/contract';

/** `notifications.payload` for `lfg_player_invite` — what the DM builder reads. */
export interface LfgPlayerInvitePayload {
  gameId: number;
  gameSlug: string;
  gameName: string;
  inviterUserId: number;
  /** Display name, falling back to username — the `✉ Invited by …` line. */
  inviterName: string;
  /** Why the recipient was suggested (`played` → `owns` → `hearted`). */
  reasons: LfgSuggestionReason[];
  /** Masked link to the group page; absent when no client URL is configured. */
  url?: string;
  /**
   * ROK-2352 — the group invited into. Absent for the whole-game group, so a
   * non-WoW payload is byte-for-byte what it was; the DM's Join and Decline
   * buttons carry it (v2 custom ids) and `url` already points at its page.
   */
  groupKey?: string;
  /** Steam lifetime playtime in MINUTES (`steam_library` row); absent when unknown (AC6). */
  playtimeMinutes?: number;
  /**
   * The GROUP's horizon at send time — `now` while ANY live member holds a
   * `now` hand, else `week`. Read off the group, NOT off the inviter: an
   * inviter on a week hand can invite you into a group that is playing right
   * now, and the DM has to say "right now" (walk feedback 2).
   */
  urgency: LfgUrgency;
  /** ISO instant the group's longest live `now` hand lapses; absent on week. */
  nowExpiresAt?: string;
  /**
   * ROK-1619 AC7: at send time, the recipient's Join would cross the spawn
   * threshold and start the session — the DM's Join wears the indicator.
   * Absent means no. A send-time snapshot: a DM is never re-rendered, so a
   * stale mark degrades to AC4's graceful attach, never to an error.
   */
  spawnsNow?: boolean;
  /** The admin indicator-emoji setting at send time, raw; only with spawnsNow. */
  spawnEmoji?: string;
}
