/**
 * ROK-1352 — ephemeral voice channel lifecycle smoke test (AC7).
 *
 * Exercises the full create → event → idle → destroy lifecycle end-to-end:
 *   1. Admin enables the global ephemeral-voice toggle + sets a parent category.
 *   2. An event is created in the create-buffer window with a per-event opt-in.
 *   3. A test-only force-scan triggers the scheduler → the bot creates a voice
 *      channel under the category and persists `ephemeralVoiceChannelId`.
 *   4. The companion bot joins the channel, then a force-reap is fired while it
 *      is OCCUPIED → the channel MUST survive (never delete while occupied).
 *   5. The bot leaves; a force-reap is fired with the event past end + channel
 *      empty → the channel is deleted and `ephemeralVoiceChannelId` clears.
 *
 * fails-by-construction (committed RED): the ephemeral-voice feature, the
 * `setEphemeralVoiceConfig` admin endpoint, the per-event `ephemeralVoiceEnabled`
 * field, the event ephemeral-state read endpoint, and the test-only
 * `POST /admin/test/ephemeral-voice/scan` + `/reap` force triggers do not exist
 * yet. This is validated against the deployed fleet env in a later step, after
 * the dev builds the feature. Deterministic polling only — no fixed delays.
 */
import {
  joinVoiceWithRetry,
  leaveVoice,
  getVoiceMembers,
} from '../../helpers/voice.js';
import { pollForCondition } from '../../helpers/polling.js';
import { getGuild } from '../../client.js';
import {
  createEvent,
  deleteEvent,
  futureTime,
  awaitProcessing,
} from '../fixtures.js';
import type { ApiClient } from '../api.js';
import type { SmokeTest, TestContext } from '../types.js';

// ---------------------------------------------------------------------------
// Local fixtures — call feature/test endpoints the dev will build (ROK-1352).
// ---------------------------------------------------------------------------

/** Set the global ephemeral-voice config (admin). */
async function setEphemeralVoiceConfig(
  api: ApiClient,
  cfg: {
    enabled: boolean;
    categoryId: string | null;
    createBufferMinutes?: number;
    idleMinutes?: number;
  },
): Promise<void> {
  await api.put('/admin/settings/discord-bot/ephemeral-voice', cfg);
}

/** Force the create-window scheduler scan — DEMO_MODE only. */
async function forceEphemeralScan(api: ApiClient): Promise<void> {
  await api.post('/admin/test/ephemeral-voice/scan', {});
}

/** Force the idle reaper scan — DEMO_MODE only. */
async function forceEphemeralReap(api: ApiClient): Promise<void> {
  await api.post('/admin/test/ephemeral-voice/reap', {});
}

/** Read an event's live ephemeral channel id (null when none). */
async function getEphemeralChannelId(
  api: ApiClient,
  eventId: number,
): Promise<string | null> {
  const ev = await api.get<{ ephemeralVoiceChannelId: string | null }>(
    `/events/${eventId}`,
  );
  return ev.ephemeralVoiceChannelId ?? null;
}

/**
 * Parent category for the ephemeral channel. Prefer an explicit env override
 * (fleet run); otherwise ask the feature's own categories endpoint for a real
 * GUILD_CATEGORY and prefer the voice category. ctx.voiceChannels[0] is a
 * voice channel, NOT a category, so it is not a valid parent. ROK-1352.
 */
async function resolveCategoryId(ctx: TestContext): Promise<string> {
  let categoryId = process.env.SMOKE_EPHEMERAL_CATEGORY_ID;
  if (!categoryId) {
    const cats = await ctx.api
      .get<{ id: string; name: string }[]>(
        '/admin/settings/discord-bot/ephemeral-voice/categories',
      )
      .catch(() => [] as { id: string; name: string }[]);
    const list = Array.isArray(cats) ? cats : [];
    categoryId = list.find((c) => /voice/i.test(c.name))?.id ?? list[0]?.id;
  }
  if (!categoryId) {
    throw new Error('No ephemeral parent category available for smoke run');
  }
  return categoryId;
}

/**
 * gameId: ctx.games is derived from the logged-in admin's first character,
 * which is empty after reset-to-seed (admin has no character). Fall back to
 * the library games list — matches voice-activity.test.ts — so the test is
 * seed-robust and passes in CI. ROK-1352.
 */
async function resolveGameId(ctx: TestContext): Promise<number> {
  let gameId = ctx.games[0]?.id;
  if (!gameId) {
    const gamesRes = await ctx.api.get<{ data: { id: number }[] }>(
      '/admin/settings/games?limit=1',
    );
    gameId = gamesRes.data[0]?.id;
  }
  if (!gameId) throw new Error('No games in DB for ROK-1352 lifecycle test');
  return gameId;
}

/** Force the scheduler scan and wait for the channel id to be persisted. */
async function awaitChannelCreated(
  ctx: TestContext,
  eventId: number,
): Promise<string> {
  await forceEphemeralScan(ctx.api);
  await awaitProcessing(ctx.api);
  const channelId = await pollForCondition(
    async () => getEphemeralChannelId(ctx.api, eventId),
    ctx.config.timeoutMs,
    { intervalMs: 1500 },
  );
  if (!channelId) {
    throw new Error('Ephemeral channel was not created within timeout');
  }
  return channelId;
}

/** Wait until the companion bot is (or is no longer) in the channel. */
async function awaitBotPresence(
  ctx: TestContext,
  channelId: string,
  present: boolean,
): Promise<void> {
  await pollForCondition(
    async () => {
      const m = getVoiceMembers(channelId);
      const inChannel = m.some((x) => x.id === ctx.testBotDiscordId);
      return inChannel === present ? true : null;
    },
    ctx.config.timeoutMs,
    { intervalMs: 1000 },
  );
}

/** Occupy the channel, then force a reap — it MUST survive (AC4). */
async function assertOccupiedSurvives(
  ctx: TestContext,
  eventId: number,
  channelId: string,
): Promise<void> {
  // Retry covers only the companion bot's own Discord voice handshake.
  await joinVoiceWithRetry(channelId);
  await awaitBotPresence(ctx, channelId, true);
  await forceEphemeralReap(ctx.api);
  await awaitProcessing(ctx.api);
  const stillThere = await getEphemeralChannelId(ctx.api, eventId);
  if (stillThere !== channelId) {
    throw new Error(
      `Occupied ephemeral channel was deleted (AC4 violation): ${stillThere}`,
    );
  }
}

/** Vacate, push the event into the past, force reap → channel deleted. */
async function assertIdleDestroyed(
  ctx: TestContext,
  eventId: number,
  channelId: string,
): Promise<void> {
  leaveVoice();
  await awaitBotPresence(ctx, channelId, false);
  // Make the event "ended" so the safety-net reaper considers it:
  // findReapCandidates only matches events whose end is > idleMinutes ago
  // AND are empty. The event was created upcoming (required so the scheduler
  // creates the channel in the first place), so PATCH it into the past now —
  // endTime 40 min ago, beyond the 30-min idle window. RescheduleEventSchema
  // forbids past times; UpdateEventSchema (PATCH /events/:id) only enforces
  // start < end. ROK-1352.
  await ctx.api.patch(`/events/${eventId}`, {
    startTime: futureTime(-90),
    endTime: futureTime(-40),
  });
  await forceEphemeralReap(ctx.api);
  await awaitProcessing(ctx.api);
  await pollForCondition(
    async () => {
      const id = await getEphemeralChannelId(ctx.api, eventId);
      return id === null ? true : null;
    },
    ctx.config.timeoutMs,
    { intervalMs: 1500 },
  ).catch(() => {
    throw new Error('Ephemeral channel was not destroyed after idle reap (AC4)');
  });
}

/**
 * After the product teardown ran, check the ephemeral channel is gone. A
 * fetch rejection or null is the happy path. If it survived, warn loudly —
 * that is a PRODUCT finding (event delete should have destroyed it) — then
 * best-effort delete it so the shared guild is not littered. Never throws:
 * a cleanup failure must not replace the test's real failure, and the
 * companion bot may lack Manage Channels.
 */
async function reportOrphanChannel(channelId: string): Promise<void> {
  const channel = await getGuild()
    .channels.fetch(channelId)
    .catch(() => null);
  if (!channel) return;
  console.warn(
    `[ROK-1352] ephemeral channel ${channelId} survived event delete — product teardown did not remove it`,
  );
  try {
    await channel.delete('smoke cleanup (ROK-1352)');
  } catch (err) {
    const e = err as { code?: unknown; message?: unknown };
    console.warn(
      `[ROK-1352] companion-bot delete of ${channelId} failed: code=${String(e?.code)} ${String(e?.message ?? err)}`,
    );
  }
}

/**
 * Teardown order matters. deleteEvent is the PRODUCT teardown: the event
 * listener force-destroys the ephemeral channel before the row is removed,
 * while the config is still enabled. Only after that does the companion bot
 * check for (and remove) a survivor — deleting it first would mask a product
 * "orphan on event delete" regression. The config is disabled last.
 */
async function teardown(
  ctx: TestContext,
  eventId: number,
  channelId: string | null,
): Promise<void> {
  leaveVoice();
  await deleteEvent(ctx.api, eventId);
  if (channelId) await reportOrphanChannel(channelId);
  await setEphemeralVoiceConfig(ctx.api, {
    enabled: false,
    categoryId: null,
  }).catch(() => undefined);
}

// ---------------------------------------------------------------------------
// Lifecycle test
// ---------------------------------------------------------------------------

const ephemeralLifecycle: SmokeTest = {
  name: 'Ephemeral voice channel create → occupied-survives → idle destroy (ROK-1352)',
  category: 'voice',
  async run(ctx) {
    const categoryId = await resolveCategoryId(ctx);
    const gameId = await resolveGameId(ctx);
    await setEphemeralVoiceConfig(ctx.api, {
      enabled: true,
      categoryId,
      createBufferMinutes: 30,
      idleMinutes: 30,
    });

    // Event starts inside the 30-min create-buffer window, per-event opt-in.
    const ev = await createEvent(ctx.api, 'rok1352-ephemeral', {
      gameId,
      startTime: futureTime(10),
      endTime: futureTime(70),
      ephemeralVoiceEnabled: true,
    });

    let channelId: string | null = null;
    try {
      channelId = await awaitChannelCreated(ctx, ev.id);
      await assertOccupiedSurvives(ctx, ev.id, channelId);
      await assertIdleDestroyed(ctx, ev.id, channelId);
    } finally {
      await teardown(ctx, ev.id, channelId);
    }
  },
};

export const ephemeralVoiceTests: SmokeTest[] = [ephemeralLifecycle];
