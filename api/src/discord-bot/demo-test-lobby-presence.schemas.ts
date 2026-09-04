/**
 * ROK-1446 D12 — request body for the DEMO_MODE lobby-presence seam.
 *
 * The member shape is a deliberate 1:1 mirror of `RoomMemberSnapshot`
 * (`services/channel-presence-room.helpers.ts`): the seam stands in for the
 * Discord read + detection step of `resolveRoom`, so what it accepts is exactly
 * the POST-detection member record and nothing else.
 *
 * **AC3 lives here.** A snapshot member carries no `user.bot` and no `bot`
 * flag, and zod's default object behaviour STRIPS unknown keys — so the seam
 * cannot smuggle a bot onto the embed even though it bypasses `humanMembers`.
 * Do NOT add such a field, and do NOT relax this to `.passthrough()`.
 */
import { z } from 'zod';

/** One human occupant, already resolved to the game presence detected for them. */
export const LobbyPresenceMemberSchema = z.object({
  discordUserId: z.string().min(1),
  /** Rendered name — rosters are bold plain text, never `<@id>` mentions (D2). */
  displayName: z.string().min(1),
  /** Required key; `null` = "in channel · no game detected". */
  gameId: z.number().int().positive().nullable(),
  /** Links this member's game group to an existing ad-hoc event. */
  eventId: z.number().int().positive().optional(),
});

/**
 * `members: []` is an EMPTY ROOM (drives the recap path).
 * `members: null` CLEARS the override and hands the channel back to real
 * Discord reads. The two are different requests and must stay distinguishable.
 */
export const SetLobbyPresenceSchema = z.object({
  voiceChannelId: z.string().min(1),
  members: z.array(LobbyPresenceMemberSchema).nullable(),
});

export type SetLobbyPresenceBody = z.infer<typeof SetLobbyPresenceSchema>;

/** What the seam reports back so a smoke test can poll the exact message. */
export interface LobbyPresenceResponse {
  /** `null` until the room's first flush has opened a row. */
  textChannelId: string | null;
  messageId: string | null;
}
