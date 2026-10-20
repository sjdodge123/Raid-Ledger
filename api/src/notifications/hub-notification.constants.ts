/**
 * ROK-1832 — app events that trigger group notifications. Emitted by the guild
 * profile and event update paths so neither imports the notification module.
 */
export const HUB_NOTIFICATION_EVENTS = {
  /** Payload: {@link LeaderPostInput}. */
  LEADER_POST: 'hub.leader-post',
  /** Payload: `{ eventId: number }` — `guild_id` newly set on the event. */
  EVENT_TAGGED: 'hub.event-tagged',
} as const;

/** D7: one leader-post notice per group per hour. */
export const HUB_POST_COOLDOWN_SECONDS = 3600;

export interface LeaderPostInput {
  guildId: number;
  actorId: number;
  gmPost: string;
}
