/**
 * Fixtures for an LFG-born "playing now" session's voice roster (ROK-1494).
 *
 * Split out of `fixtures.ts` (already 600+ lines), like `fixtures-lfg-board.ts`.
 *
 * The companion bot cannot move the PLAYING NOW head-count: the join dispatch
 * drops bot members before they reach the roster
 * (`voice-state-join-dispatch.handlers.ts`, `isBotMember`), and CI cannot open
 * a voice connection at all (`SMOKE_SKIP_VOICE_JOIN=1`). These endpoints record
 * a SEEDED, Discord-linked human through the voice listener's own helpers
 * (`recordLfgNowVoiceJoin` / `recordLfgNowVoiceLeave`), so the roster write,
 * the PARTICIPANT_JOINED/LEFT emit and the post re-render are exactly what a
 * real join or leave produces.
 */
import { ApiClient } from "./api.js";

/** `POST /admin/test/lfg-now/voice-join|voice-leave` response. */
export interface LfgNowVoiceResult {
  /** False when no OPEN (`live` / `grace_period`) LFG-born event owns the channel. */
  recorded: boolean;
  /** The event the member was recorded against, or null. */
  eventId: number | null;
}

/** A seeded user and the LFG-born event's ephemeral voice channel. */
export interface LfgNowVoiceTarget {
  /** `users.id` of a Discord-linked user (e.g. a `seedFixtureUser` slot). */
  userId: number;
  /** The temp voice channel id, as the PLAYING NOW post links it. */
  channelId: string;
}

/**
 * Record `userId` joining the session's voice channel, as the listener would.
 *
 * Throws on any non-2xx — the join is the action under test, not cleanup.
 *
 * @param api - An ADMIN client (the endpoint is admin-guarded, DEMO_MODE only).
 * @param target - The seeded user and the session's voice channel.
 * @returns Whether a roster row was written, and for which event.
 */
export function lfgNowVoiceJoin(
  api: ApiClient,
  target: LfgNowVoiceTarget,
): Promise<LfgNowVoiceResult> {
  return api.post<LfgNowVoiceResult>("/admin/test/lfg-now/voice-join", target);
}

/**
 * Record `userId` leaving the session's voice channel — the join's mirror.
 *
 * Throws on any non-2xx; a `finally` that must not mask the real failure
 * should `.catch` it, as `withdrawLfgIntent` does for intents.
 *
 * @param api - An ADMIN client (the endpoint is admin-guarded, DEMO_MODE only).
 * @param target - The seeded user and the session's voice channel.
 * @returns Whether a roster row was closed, and for which event.
 */
export function lfgNowVoiceLeave(
  api: ApiClient,
  target: LfgNowVoiceTarget,
): Promise<LfgNowVoiceResult> {
  return api.post<LfgNowVoiceResult>("/admin/test/lfg-now/voice-leave", target);
}
