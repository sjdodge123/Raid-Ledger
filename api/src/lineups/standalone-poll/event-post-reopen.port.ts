/**
 * ROK-2314 review MAJOR-1 — the lineups side of the "reopen the event's
 * Discord post now" seam. A reschedule poll's lock-in clears
 * `events.rescheduling_poll_id`; the post it closed must be open again
 * BEFORE `POLL_LOCKED_IN` fires, or the ROK-2295 chat copy hits an archived
 * thread (Discord 50083). Bound by `HubForumDiscordModule` and resolved
 * lazily (`moduleRef.get(token, { strict: false })`), like
 * `POLL_FORUM_STARTER_PORT`: no lineups → guilds/forum import cycle.
 */

/** Re-derives an event post's close time and flips its lock right away. */
export interface EventPostReopenPort {
  /**
   * Re-sync the event's hub thread and registry post to the (already moved)
   * event, then flip their Discord lock. No post ⇒ nothing. Best effort:
   * the caller catches and logs a throw.
   */
  reopenEventPost(eventId: number): Promise<void>;
}

/** DI token of the {@link EventPostReopenPort} implementation. */
export const EVENT_POST_REOPEN_PORT = 'EVENT_POST_REOPEN_PORT';
