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
 * (`recordLfgNowVoiceJoin` / `recordLfgNowVoiceLeave`), so from
 * `recordLfgNowVoiceJoin` down — the roster write, the PARTICIPANT_JOINED/LEFT
 * emit and the post re-render — they match a real join or leave. What they
 * SKIP is the gateway → unbound-channel routing above it (`isBotMember`,
 * `resolveAllBindings`); that is pinned by `lfg-now-voice.helpers.spec.ts`,
 * not by any smoke.
 */
import { ApiClient } from "./api.js";
import { awaitProcessing } from "./fixtures.js";

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

/** `POST /admin/test/lfg/end-session` response (ROK-1505 AC10b). */
export interface LfgEndSessionResult {
  /** False when the game had no open LFG-born session to end. */
  ended: boolean;
  eventId: number | null;
  /**
   * True only when the temp voice channel was actually deleted. False with
   * `ended: true` means it may be leaked (bot offline, already gone, or the
   * delete failed).
   */
  channelDestroyed: boolean;
}

/**
 * End the game's live LFG-born session and destroy its temp voice channel.
 *
 * A spawn creates a real `⏰ <game> — Playing now` channel in the shared test
 * guild. The ordinary teardown is the ephemeral reaper, 30 min after the
 * session ends — long after a CI run's API is gone — so a smoke that spawns
 * must call this in its `finally` or leak that channel for good. It also
 * closes the game's `lfg_group_messages` row, which would otherwise keep
 * `uq_lfg_group_messages_game_open` taken and the game out of the idle pool.
 * A no-op (`ended: false`) when nothing was spawned.
 *
 * @param api - An ADMIN client (the endpoint is admin-guarded, DEMO_MODE only).
 * @param gameId - The game whose session to end.
 * @returns Whether a session was ended, and which event.
 */
export function endLfgSession(
  api: ApiClient,
  gameId: number,
): Promise<LfgEndSessionResult> {
  return api.post<LfgEndSessionResult>("/admin/test/lfg/end-session", {
    gameId,
  });
}

/**
 * Best-effort {@link endLfgSession} for a smoke's `finally`: tear down the
 * session the run spawned, if any (a no-op when none was).
 *
 * Warns on `ended && !channelDestroyed` — a temp voice channel that may now be
 * orphaned in the shared guild — and on any error, but never throws, so a
 * cleanup failure cannot replace the test's real one. Drained afterwards so
 * the post's closing re-render lands before the caller deletes the binding or
 * thread it routes through.
 *
 * @param api - An ADMIN client.
 * @param gameId - The game whose session to end.
 * @param tag - Log prefix naming the calling smoke, e.g. `lfg-board`.
 */
export async function endSpawnedLfgSession(
  api: ApiClient,
  gameId: number,
  tag: string,
): Promise<void> {
  try {
    const res = await endLfgSession(api, gameId);
    if (res.ended && !res.channelDestroyed) {
      console.warn(
        `[${tag}] session ended for game ${gameId} but its temp voice ` +
          `channel was NOT deleted — never created, bot offline, already ` +
          `gone, or the delete failed; if it exists it may be orphaned in ` +
          `the guild`,
      );
    }
    await awaitProcessing(api);
  } catch (err) {
    console.warn(
      `[${tag}] end-session cleanup failed for game ${gameId} — its temp ` +
        `voice channel may be orphaned: ${String(err)}`,
    );
  }
}
