import { pollForCondition } from "../helpers/polling.js";
import { ApiClient } from "./api.js";
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
  if (!slot) {
    // Unreachable: the index is taken modulo a non-empty pool's length.
    throw new Error(`channel pool has no slot at ${index}`);
  }
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

/**
 * Delete a smoke-test event, draining in-flight jobs first (ROK-1511).
 *
 * The event-lifecycle job enqueued by the create may still be posting the
 * Discord embed; deleting the row underneath it made the tracking insert hit
 * the discord_event_messages FK, which orphaned the message and left the queue
 * dirty for every later test. The drain is best-effort — a timeout here must
 * never replace the test's real failure, and the poster now tolerates the
 * residual race.
 */
export async function deleteEvent(api: ApiClient, eventId: number) {
  await awaitProcessing(api, 2_000).catch(() => {});
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

/** Wait for pending embed-sync work to land (server waits for idle queues; never deletes jobs) — DEMO_MODE only. */
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

/**
 * Reset-to-seed and demo install rebuild the seed data and can outlast the
 * client's 90s default; cutting one off would start the demo/install fallback
 * while the reset is still running (TDB:4650 review).
 */
const RESET_TIMEOUT_MS = 300_000;

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
    await api.post("/admin/test/reset-to-seed", {}, { timeoutMs: RESET_TIMEOUT_MS });
    return;
  } catch (err) {
    console.warn(
      `  reset-to-seed failed (${err}) — falling back to demo/install`,
    );
  }
  await api.post("/admin/settings/demo/install", {}, { timeoutMs: RESET_TIMEOUT_MS }).catch((err) => {
    console.warn(`  demo/install fallback also failed: ${err}`);
  });
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

// Voice/lobby-presence, LFG and scheduled-event fixtures live in their own modules; re-exported
// here so every `../fixtures.js` importer keeps working unchanged.
export * from "./fixtures-voice.js";
export * from "./fixtures-lfg.js";
export * from "./fixtures-scheduled-events.js";
