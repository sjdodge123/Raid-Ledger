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
import type { ApiClient } from "./api.js";

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

/** ROK-293's product gate: `AdHocEventService.isEnabled` reads this setting. */
const AD_HOC_PATH = "/admin/settings/discord-bot/ad-hoc";

/** What the ad-hoc gate helper needs from an ADMIN client. */
export type AdHocGateApi = Pick<ApiClient, "get" | "put">;

/**
 * Run `fn` with ad-hoc events ON, then put the setting back as it was.
 *
 * `handleVoiceJoin` returns before the spawn when `ad_hoc_events_enabled` is
 * not `'true'` (trace `[voice-gate] outcome=feature-disabled`), and nothing in
 * the smoke harness, the demo seed or the CI workflow sets it. A run whose DB
 * lacks the row — a fresh CI database, or a fleet env whose settings came from
 * the shared bundle — can therefore never spawn. A test that needs a Quick Play
 * spawn sets the flag itself through the admin settings API.
 *
 * When the flag is already ON nothing is written, so a run that enabled it on
 * purpose keeps it. A failed restore fails the run when `fn` succeeded — a
 * green test must not leave the flag ON for the tests after it — and is only
 * logged when `fn` threw, so it never hides that error.
 */
export async function withAdHocEventsEnabled<T>(
  api: AdHocGateApi,
  fn: () => Promise<T>,
): Promise<T> {
  const prior = await api.get<{ enabled: boolean }>(AD_HOC_PATH);
  if (prior.enabled) return fn();
  await api.put(AD_HOC_PATH, { enabled: true });
  let result: T;
  try {
    result = await fn();
  } catch (err) {
    await restoreAdHocGate(api).catch((restoreErr: unknown) => {
      console.warn(errorMessage(restoreErr));
    });
    throw err;
  }
  await restoreAdHocGate(api);
  return result;
}

/** Put the ad-hoc flag back OFF; rejects with a message naming the leak. */
async function restoreAdHocGate(api: AdHocGateApi): Promise<void> {
  try {
    await api.put(AD_HOC_PATH, { enabled: false });
  } catch (err) {
    throw new Error(`ad-hoc gate restore failed; the flag stays ON: ${errorMessage(err)}`);
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
