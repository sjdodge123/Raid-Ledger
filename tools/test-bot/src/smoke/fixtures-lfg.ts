/**
 * LFG / LFM fixtures (ROK-1454). Split out of `fixtures.ts`, which re-exports
 * everything here.
 */
import { ApiClient } from "./api.js";
import { SMOKE } from "./config.js";

// ---------------------------------------------------------------------------
// LFG / LFM (ROK-1454)
//
// Types are declared locally rather than imported from `@raid-ledger/contract`
// on purpose: the test-bot workspace has no dependency on the contract package
// and adding one would escalate the whole gate to `--full` for a handful of
// field names. These mirror `packages/contract/src/lfg.schema.ts` and are
// deliberately PARTIAL — only the fields the smoke asserts on.
// ---------------------------------------------------------------------------

/** The derived per-game group summary every LFG write echoes back. */
export interface LfgGroupSummary {
  gameId: number;
  gameName: string;
  /** `games.slug` — the `/lfg/:gameSlug` segment the embed links to. */
  gameSlug: string;
  /** Active intents held by non-deactivated, non-banned users. */
  activeCount: number;
  /** `games.cooptimusOnlineMax`, or null when Co-Optimus has no data. */
  viabilityThreshold: number | null;
  /** Drives amber (`needs_you`) vs emerald (`live`) on the channel embed. */
  isViable: boolean;
  hasOwnIntent: boolean;
  soonestExpiresAt: string | null;
  /**
   * ROK-1494: the live LFG-born session two `now` hands spawned, or null.
   *
   * Optional here only so the older fixtures in this file that build a summary
   * by hand keep compiling; the API always sends the field.
   */
  playingNow?: { eventId: number; voiceChannelId: string | null } | null;
}

/** `POST /lfg` — the intent row plus the group it now belongs to. */
export interface LfgIntentResponse {
  id: number;
  userId: number;
  gameId: number;
  status: string;
  group: LfgGroupSummary;
}

/** The stable smoke fixture user, plus a client authenticated AS them. */
export interface FixtureUser {
  userId: number;
  discordId: string;
  /** Authenticated as the fixture user — NOT as the admin. */
  api: ApiClient;
}

/**
 * Seed the stable non-admin smoke fixture user and mint a client for it.
 *
 * `POST /admin/test/seed-fixture-user` is a SELECT-then-INSERT on one
 * hard-coded `discord_id`, so concurrent smoke workers race it: the loser's
 * INSERT trips the unique constraint and the endpoint answers 500. Retrying is
 * a complete fix rather than a mask — the retry takes the SELECT branch,
 * because the winner's row is committed by the time the loser fails. The same
 * reasoning is documented at `scripts/smoke/lfg-group-page.smoke.spec.ts`.
 *
 * @param api - An ADMIN client (the endpoint is admin-guarded).
 * @param attempts - How many times to try before giving up.
 * @param slot - Fixture slot 1..9 (idempotent PER SLOT); use a higher slot
 *   when one smoke needs several distinct non-admin users.
 * @param opts - `guildMember: true` also stamps `guild_member_seen_at`, making
 *   the user "in the Discord" (ROK-1870 A2 — hub Join/Propose). Opt-in.
 * @returns The fixture user's id, Discord id, and its own API client.
 */
export async function seedFixtureUser(
  api: ApiClient,
  attempts = 3,
  slot = 1,
  opts: { guildMember?: boolean } = {},
): Promise<FixtureUser> {
  const body = { slot, ...(opts.guildMember ? { guildMember: true } : {}) };
  let lastError = "";
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await api.post<{
        userId: number;
        discordId: string;
        jwt: string;
      }>("/admin/test/seed-fixture-user", body);
      const scoped = new ApiClient(SMOKE.apiUrl, res.jwt);
      scoped.userId = res.userId;
      return { userId: res.userId, discordId: res.discordId, api: scoped };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }
  throw new Error(
    `seed-fixture-user failed after ${attempts} attempts: ${lastError}`,
  );
}

/** ROK-1479 — how soon the player wants to play. Absent means `week`. */
export interface LfgIntentOpts {
  urgency?: "week" | "now";
  /** Only valid alongside `urgency: 'now'`; absent there means 30. */
  ttlMinutes?: 30 | 60;
}

/**
 * Raise a hand for a game as whoever `api` is authenticated as.
 *
 * The SAME method the `/lfg` slash command reaches (`LfgService.createIntent`),
 * so `LFM_REACHED` / `GROUP_CHANGED` fire identically down both paths.
 *
 * `opts` is SPREAD rather than defaulted, so a caller that passes nothing
 * sends the ROK-1454 body byte for byte and takes the contract's own
 * `urgency` default — the AC1 promise that existing clients keep the week.
 *
 * @param api - Client for the player raising the hand.
 * @param gameId - `games.id`.
 * @param opts - ROK-1479 urgency; omit for the weekly intent.
 * @returns The intent row plus the group it landed in.
 */
export async function postLfgIntent(
  api: ApiClient,
  gameId: number,
  opts: LfgIntentOpts = {},
): Promise<LfgIntentResponse> {
  return api.post<LfgIntentResponse>("/lfg", { gameId, ...opts });
}

/**
 * Withdraw the caller's own intent. Never throws.
 *
 * Swallowing matches `deleteEvent` / `deleteBinding`: this runs in `finally`,
 * and after a conversion every row is `status='converted'`, so the DELETE
 * answers 404. A cleanup helper that threw there would replace the test's real
 * failure with a cleanup failure.
 *
 * @param api - Client for the player withdrawing.
 * @param gameId - `games.id`.
 */
export async function withdrawLfgIntent(
  api: ApiClient,
  gameId: number,
): Promise<void> {
  await api.delete(`/lfg/${gameId}`).catch(() => {});
}

/**
 * Record that a group converted into an event (or a scheduling poll).
 *
 * Throws on failure by design — conversion is the action under test in AC10
 * step 4, not cleanup.
 *
 * @param api - Client for a participant of the group.
 * @param gameId - `games.id`.
 * @param target - Exactly one of `eventId` / `pollId`.
 * @returns How many active intents flipped to `converted`.
 */
export async function convertLfg(
  api: ApiClient,
  gameId: number,
  target: { eventId?: number; pollId?: number },
): Promise<{ converted: number }> {
  return api.post<{ converted: number }>(`/lfg/${gameId}/convert`, target);
}
