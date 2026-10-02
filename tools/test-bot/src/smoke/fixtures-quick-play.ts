/**
 * Fixtures for a `game-voice-monitor` Quick Play spawn (ROK-1390).
 *
 * Split out of `fixtures.ts` (already 600+ lines), like `fixtures-lfg-now.ts`.
 *
 * The companion bot cannot trigger a Quick Play event. It counts toward the
 * binding's threshold, but it is never rostered (ROK-1445 AC9), so a bot-only
 * room stops at the listener's `no-human-members` gate and nothing is minted.
 * CI cannot open a voice connection at all either (`SMOKE_SKIP_VOICE_JOIN=1`).
 * This endpoint records a SEEDED, Discord-linked human joining the bound voice
 * channel instead. From the ROK-959 suppression guard down — the event mint and
 * the LIVE embed post through the series routing tier — it matches a real
 * join. What it SKIPS is the gateway → gate routing above it (the threshold
 * count and the bot roster filter); unit specs in the api pin those.
 */
import { ApiClient } from "./api.js";

/** `POST /admin/test/quick-play/voice-join` response. */
export interface QuickPlayVoiceResult {
  /** True when the join minted (or joined) a Quick Play event. */
  spawned: boolean;
  /** The event the member was recorded against, or null. */
  eventId: number | null;
  /** Set when the ROK-959 suppression guard refused the spawn. */
  reason?: "suppressed";
}

/** A seeded user, the `game-voice-monitor` binding and its voice channel. */
export interface QuickPlayVoiceTarget {
  /** `users.id` of a Discord-linked user (e.g. a `seedFixtureUser` slot). */
  userId: number;
  /** The `game-voice-monitor` binding's id. */
  bindingId: string;
  /** The bound voice channel's snowflake. */
  channelId: string;
}

/**
 * Record `userId` joining the bound voice channel, as the listener would.
 *
 * Throws on any non-2xx — the join is the action under test, not cleanup.
 * 404 means the binding is unknown; 400 means it is not a
 * `game-voice-monitor` or the user is not Discord-linked.
 *
 * @param api - An ADMIN client (the endpoint is admin-guarded, DEMO_MODE only).
 * @param target - The seeded user, the binding and its voice channel.
 * @returns Whether an event was spawned, which one, and why not if suppressed.
 */
export function quickPlayVoiceJoin(
  api: ApiClient,
  target: QuickPlayVoiceTarget,
): Promise<QuickPlayVoiceResult> {
  return api.post<QuickPlayVoiceResult>(
    "/admin/test/quick-play/voice-join",
    target,
  );
}
