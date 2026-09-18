/**
 * Shared shapes for the LFG "playing now" spawn (ROK-1494, ROK-1613).
 *
 * Their own module so `lfg-now-manual-start.helpers.ts` can name a hand
 * without importing the spawn helper that imports IT — the cycle jest's module
 * registry would otherwise resolve to `undefined` at mock time.
 */

/** A live LFG hand, with the Discord identity the roster needs. */
export interface LfgNowHand {
  userId: number;
  createdAt: Date;
  discordId: string | null;
  username: string;
  discordAvatarHash: string | null;
}

/** What one pass of the spawn decision settled on. */
export interface LfgNowSpawnResult {
  eventId: number;
  /** True when THIS pass created the event; false when it attached to one. */
  spawned: boolean;
  /**
   * ROK-1613 AC4: the OTHER live participants, to be invited by the caller
   * AFTER the transaction commits. Always empty on the threshold path, which
   * rosters everyone it converts.
   */
  invitedUserIds: number[];
}
