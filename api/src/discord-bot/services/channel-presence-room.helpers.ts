/**
 * ROK-1446 — room truth for the channel-level Quick Play presence embed.
 *
 * **Lane A spawn 1 (skeleton): TYPES ONLY.** `resolveRoom`, `findLinkedEvents`
 * and `recapEvents` (spec item 4) land in the next Lane A spawn. The types are
 * here now because `ChannelPresenceEmbedService.setRoomOverride` is part of the
 * public API Lane B compiles against, so `RoomSnapshot` has to be a real,
 * constructible shape before Lane B's D12 controller exists.
 *
 * D4 — render from truth, never from deltas: every flush re-derives the room
 * from `humanMembers` + `detectGames` + `partitionLobbyGroups` + the DB's
 * live/grace ad-hoc events, so a missed Discord event self-heals on the next
 * tick and the service never has to import `AdHocEventService`.
 */

/**
 * One human occupant of a bound lobby channel, as the DEMO_MODE seam supplies
 * it (D12). This is deliberately the POST-detection shape: `gameId` is what
 * presence detection would have resolved, so an override can stand in for the
 * Discord read without carrying a `user.bot` flag — which is why the override
 * can never sneak a bot onto the embed (AC3).
 */
export interface RoomMemberSnapshot {
  discordUserId: string;
  /** Rendered name — rosters are bold plain text, never `<@id>` mentions. */
  displayName: string;
  /** `null` = presence produced no game ("in channel · no game detected"). */
  gameId: number | null;
  /** Links this member's game group to an existing ad-hoc event (D12). */
  eventId?: number;
}

/**
 * A stand-in for the Discord read + detection step of `resolveRoom` (D12).
 *
 * The override replaces ONLY that step — partition, linked-event lookup,
 * render, post/edit, persistence and close all still run for real, which is
 * what makes the smoke test a real end-to-end exercise of the message.
 * `members: []` means an empty room (the recap path); passing `null` to
 * `setRoomOverride` clears the override entirely.
 */
export interface RoomSnapshot {
  members: RoomMemberSnapshot[];
}
