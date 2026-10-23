/**
 * Events the Discord DM queue processor emits (ROK-1933 Codex P2).
 *
 * `DiscordNotificationService.dispatch` returning means the DM was QUEUED,
 * not delivered. A caller that holds state for a send (a dedupe key, say)
 * listens for this event to learn that the queued DM finally failed.
 */

/** Emitted once, on a DM's FINAL failure — never on a retryable attempt. */
export const DISCORD_NOTIFICATION_FAILED = 'notification.discord.failed';

/** Payload of {@link DISCORD_NOTIFICATION_FAILED}. */
export interface DiscordNotificationFailedEvent {
  /** The notification type the DM was sent under. */
  type: string;
  /** The Raid Ledger user the DM was for. */
  userId: number;
  /** The job's payload, or null when it carried none. */
  payload: Record<string, unknown> | null;
}
