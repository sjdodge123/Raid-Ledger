import { pollForCondition } from "../helpers/polling.js";
import { ApiClient } from "./api.js";
import { SMOKE } from "./config.js";
import type { DiscordChannel, TestContext } from "./types.js";

let counter = 0;
function uid(prefix: string) {
  return `${prefix}-${Date.now()}-${++counter}`;
}

export function futureTime(minutesFromNow: number): string {
  const d = new Date(Date.now() + minutesFromNow * 60_000);
  return d.toISOString();
}

/** Pick a channel from the pool, rotating through to avoid collisions. */
export function pickChannel(channels: DiscordChannel[], index: number) {
  if (channels.length === 0) throw new Error("No channels available");
  return channels[index % channels.length];
}

/**
 * Select a channel for a test from the channel pool.
 * Falls back to defaultChannelId when no pool is configured.
 */
export function channelForTest(
  ctx: Pick<TestContext, "defaultChannelId" | "channelPool">,
  index: number,
): { channelId: string; gameId?: number } {
  if (!ctx.channelPool?.length) {
    return { channelId: ctx.defaultChannelId };
  }
  const slot = ctx.channelPool[index % ctx.channelPool.length];
  return { channelId: slot.channelId, gameId: slot.gameId };
}

/**
 * Look up the channel bound to a specific game in the pool.
 * Falls back to defaultChannelId if the game isn't in the pool.
 */
export function channelForGame(
  ctx: Pick<TestContext, "defaultChannelId" | "channelPool">,
  gameId: number | undefined,
): string {
  if (!gameId || !ctx.channelPool?.length) return ctx.defaultChannelId;
  const slot = ctx.channelPool.find((s) => s.gameId === gameId);
  return slot?.channelId ?? ctx.defaultChannelId;
}

/** Create an event with a unique title for test isolation. */
export async function createEvent(
  api: ApiClient,
  tag: string,
  overrides: Record<string, unknown> = {},
) {
  const title = uid(`smoke-${tag}`);
  const body = {
    title,
    startTime: futureTime(60),
    endTime: futureTime(120),
    maxAttendees: 10,
    ...overrides,
  };
  const event = await api.post<Record<string, unknown>>("/events", body);
  return { ...event, title } as {
    id: number;
    title: string;
    [k: string]: unknown;
  };
}

/** Create a channel binding and return its ID for cleanup. */
export async function createBinding(
  api: ApiClient,
  opts: {
    channelId: string;
    channelType: "text" | "voice";
    purpose: string;
    gameId?: number;
    config?: Record<string, unknown>;
  },
) {
  const res = await api.post<{ data: { id: string } }>(
    "/admin/discord/bindings",
    {
      channelId: opts.channelId,
      channelType: opts.channelType,
      bindingPurpose: opts.purpose,
      gameId: opts.gameId,
      config: opts.config,
    },
  );
  return res.data.id;
}

/** Sign up the current user for an event. */
export async function signup(
  api: ApiClient,
  eventId: number,
  opts: Record<string, unknown> = {},
) {
  return api.post(`/events/${eventId}/signup`, opts);
}

/** Cancel signup for an event. */
export async function cancelSignup(api: ApiClient, eventId: number) {
  return api.delete(`/events/${eventId}/signup`);
}

/** Cancel an event. */
export async function cancelEvent(api: ApiClient, eventId: number) {
  return api.patch(`/events/${eventId}/cancel`, {});
}

/** Reschedule an event (change start/end time). */
export async function rescheduleEvent(
  api: ApiClient,
  eventId: number,
  minutesFromNow: number,
) {
  return api.patch(`/events/${eventId}/reschedule`, {
    startTime: futureTime(minutesFromNow),
    endTime: futureTime(minutesFromNow + 60),
  });
}

/** Link a Discord ID to a user (DEMO_MODE only). */
export async function linkDiscord(
  api: ApiClient,
  userId: number,
  discordId: string,
  username: string,
) {
  return api.post("/admin/test/link-discord", {
    userId,
    discordId,
    username,
  });
}

/** Create a signup for any user (DEMO_MODE admin endpoint). */
export async function signupAs(
  api: ApiClient,
  eventId: number,
  userId: number,
  preferredRoles?: string[],
  opts?: { characterId?: string; status?: string },
) {
  return api.post("/admin/test/signup", {
    eventId,
    userId,
    preferredRoles,
    characterId: opts?.characterId,
    status: opts?.status,
  });
}

/** Update a signup's status (tentative, declined, etc.). */
export async function updateSignupStatus(
  api: ApiClient,
  eventId: number,
  status: string,
) {
  return api.patch(`/events/${eventId}/signup/status`, { status });
}

/** Create a PUG invite slot for a Discord user. */
export async function createPugInvite(
  api: ApiClient,
  eventId: number,
  discordUsername: string,
  role?: string,
) {
  return api.post(`/events/${eventId}/pugs`, {
    discordUsername,
    role: role ?? "dps",
  });
}

/** Update roster assignments (admin). */
export async function updateRoster(
  api: ApiClient,
  eventId: number,
  assignments: { userId: number; slot: string; position: number }[],
) {
  return api.patch(`/events/${eventId}/roster`, { assignments });
}

/** Remove a specific signup (admin). */
export async function removeSignup(
  api: ApiClient,
  eventId: number,
  signupId: number,
) {
  return api.delete(`/events/${eventId}/signups/${signupId}`);
}

/** Add a game interest for a user (DEMO_MODE admin endpoint). */
export async function addGameInterest(
  api: ApiClient,
  userId: number,
  gameId: number,
) {
  return api.post("/admin/test/add-game-interest", { userId, gameId });
}

/** Trigger a departure grace expiry (0ms delay) — DEMO_MODE only. */
export async function triggerDeparture(
  api: ApiClient,
  eventId: number,
  signupId: number,
  discordUserId: string,
) {
  return api.post("/admin/test/trigger-departure", {
    eventId,
    signupId,
    discordUserId,
  });
}

export async function deleteEvent(api: ApiClient, eventId: number) {
  return api.delete(`/events/${eventId}`).catch(() => {});
}

export async function deleteBinding(api: ApiClient, bindingId: string) {
  return api.delete(`/admin/discord/bindings/${bindingId}`).catch(() => {});
}

/** Cancel a user's signup (triggers bufferLeave path) — DEMO_MODE only. */
export async function cancelSignupAs(
  api: ApiClient,
  eventId: number,
  userId: number,
) {
  return api.post("/admin/test/cancel-signup", { eventId, userId });
}

/** Query a user's notifications — DEMO_MODE only (smoke tests). */
export async function getNotificationsFor(
  api: ApiClient,
  userId: number,
  type?: string,
  limit = 20,
) {
  const params = new URLSearchParams({
    userId: String(userId),
    limit: String(limit),
  });
  if (type) params.set("type", type);
  return api.get<{ type: string; payload?: Record<string, unknown> }[]>(
    `/admin/test/notifications?${params}`,
  );
}

/** Flush the roster notification buffer immediately — DEMO_MODE only. */
export async function flushNotificationBuffer(api: ApiClient) {
  return api.post<{ flushed: number }>(
    "/admin/test/flush-notification-buffer",
    {},
  );
}

/** Flush voice attendance sessions to the DB — DEMO_MODE only. */
export async function flushVoiceSessions(api: ApiClient): Promise<void> {
  await api.post("/admin/test/flush-voice-sessions", {});
}

/** Drain the embed sync BullMQ queue — DEMO_MODE only. */
export async function flushEmbedQueue(api: ApiClient): Promise<void> {
  await api.post("/admin/test/flush-embed-queue", {});
}

/** Wait for all BullMQ queues to finish processing — DEMO_MODE only. */
export async function awaitProcessing(
  api: ApiClient,
  timeoutMs = 10_000,
): Promise<void> {
  await api.post("/admin/test/await-processing", { timeoutMs });
}

/** Trigger voice classification for a specific event — DEMO_MODE only (ROK-943). */
export async function triggerClassify(
  api: ApiClient,
  eventId: number,
): Promise<void> {
  await api.post("/admin/test/trigger-classify", { eventId });
}

/** Delete all Discord scheduled events in the guild — prevents 100-event limit (ROK-969). */
export async function cleanupScheduledEvents(api: ApiClient): Promise<void> {
  // Bulk-deleting many events can exceed the default HTTP timeout, so use a generous limit
  const res = await api
    .post<{
      deleted: number;
      failed: number;
      total: number;
    }>("/admin/test/cleanup-scheduled-events", {})
    .catch(() => null);
  if (res && res.total > 0) {
    console.log(
      `  Cleaned up ${res.deleted}/${res.total} scheduled events (${res.failed} failed)`,
    );
  }
}

/** Pause reconciliation cron to prevent Discord API queue flooding (ROK-969). */
export async function pauseReconciliation(api: ApiClient): Promise<void> {
  await api.post("/admin/test/pause-reconciliation", {}).catch(() => null);
}

/** Disable Discord scheduled event creation for non-SE tests (ROK-969). */
export async function disableScheduledEvents(api: ApiClient): Promise<void> {
  await api.post("/admin/test/disable-scheduled-events", {}).catch(() => null);
}

/** Run the SE reconciliation cron once on demand (ROK-1347). */
export async function triggerReconciliation(api: ApiClient): Promise<void> {
  await api.post("/admin/test/trigger-reconciliation", {});
}

/** Call the operator orphan-SE recovery endpoint (ROK-1347). */
export async function recoverOrphanScheduledEvents(
  api: ApiClient,
  dryRun: boolean,
): Promise<{
  dryRun: boolean;
  guildSeCount: number;
  reclaimableDuplicates: Array<{
    eventId: number;
    seId: string;
    title: string;
  }>;
  operatorOrphans: number;
  deleted: number;
}> {
  return api.post(
    `/admin/scheduled-events/recover-orphans?dryRun=${dryRun}`,
    {},
  );
}

/** Re-enable Discord scheduled event creation for SE tests (ROK-969). */
export async function enableScheduledEvents(api: ApiClient): Promise<void> {
  await api.post("/admin/test/enable-scheduled-events", {}).catch(() => null);
}

/**
 * Hard reset: wipe events/signups/lineups/characters/voice sessions and
 * re-run demo install (ROK-1186). DEMO_MODE only. Called once at the
 * start of every smoke / Playwright run so tests start from a clean
 * baseline. Safe on already-clean DBs (no-op fast path).
 *
 * On failure (older API without the endpoint, transient error), falls
 * back to `/admin/settings/demo/install` so seed data is at least
 * present — matches `scripts/playwright-global-setup.ts`. A silent
 * skip would defeat the purpose of the reset (orphans accumulate).
 */
export async function resetToSeed(api: ApiClient): Promise<void> {
  try {
    await api.post("/admin/test/reset-to-seed", {});
    return;
  } catch (err) {
    console.warn(
      `  reset-to-seed failed (${err}) — falling back to demo/install`,
    );
  }
  await api.post("/admin/settings/demo/install", {}).catch((err) => {
    console.warn(`  demo/install fallback also failed: ${err}`);
  });
}

/** Inject a synthetic voice session into the DB — DEMO_MODE only (ROK-943). */
export async function injectVoiceSession(
  api: ApiClient,
  p: {
    eventId: number;
    discordUserId: string;
    userId: number;
    durationSec: number;
    firstJoinAt?: string;
    lastLeaveAt?: string;
  },
): Promise<void> {
  await api.post("/admin/test/inject-voice-session", p);
}

/**
 * Assert that a condition is never met within a time window.
 * Used for negative tests — verifying that something does NOT happen.
 * Polls the check function and fails if it ever returns true.
 * Succeeds if the poll times out (meaning the condition was never met).
 */
export async function assertConditionNeverMet(
  check: () => Promise<boolean>,
  windowMs: number,
  errorMsg: string,
  opts?: { intervalMs?: number },
): Promise<void> {
  try {
    await pollForCondition(
      async () => {
        const r = await check();
        return r ? true : null;
      },
      windowMs,
      { intervalMs: opts?.intervalMs ?? 2000, backoff: false },
    );
    throw new Error(errorMsg);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("pollForCondition timed out")) return;
    throw err;
  }
}

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
 * @returns The fixture user's id, Discord id, and its own API client.
 */
export async function seedFixtureUser(
  api: ApiClient,
  attempts = 3,
): Promise<FixtureUser> {
  let lastError = "";
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await api.post<{
        userId: number;
        discordId: string;
        jwt: string;
      }>("/admin/test/seed-fixture-user", {});
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

/**
 * Raise a hand for a game as whoever `api` is authenticated as.
 *
 * The SAME method the `/lfg` slash command reaches (`LfgService.createIntent`),
 * so `LFM_REACHED` / `GROUP_CHANGED` fire identically down both paths.
 *
 * @param api - Client for the player raising the hand.
 * @param gameId - `games.id`.
 * @returns The intent row plus the group it landed in.
 */
export async function postLfgIntent(
  api: ApiClient,
  gameId: number,
): Promise<LfgIntentResponse> {
  return api.post<LfgIntentResponse>("/lfg", { gameId });
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
