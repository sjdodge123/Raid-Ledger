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
import { joinVoice, leaveVoice, getVoiceMembers } from '../../helpers/voice.js';
import { pollForCondition } from '../../helpers/polling.js';
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

// ---------------------------------------------------------------------------
// Lifecycle test
// ---------------------------------------------------------------------------

const ephemeralLifecycle: SmokeTest = {
  name: 'Ephemeral voice channel create → occupied-survives → idle destroy (ROK-1352)',
  category: 'voice',
  async run(ctx) {
    // Parent category for the ephemeral channel. Prefer an explicit env override
    // (fleet run); otherwise ask the feature's own categories endpoint for a real
    // GUILD_CATEGORY and prefer the voice category. ctx.voiceChannels[0] is a
    // voice channel, NOT a category, so it is not a valid parent. ROK-1352.
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
    // gameId: ctx.games is derived from the logged-in admin's first character,
    // which is empty after reset-to-seed (admin has no character). Fall back to
    // the library games list — matches voice-activity.test.ts — so the test is
    // seed-robust and passes in CI. ROK-1352.
    let gameId = ctx.games[0]?.id;
    if (!gameId) {
      const gamesRes = await ctx.api.get<{ data: { id: number }[] }>(
        '/admin/settings/games?limit=1',
      );
      gameId = gamesRes.data[0]?.id;
    }
    if (!gameId) throw new Error('No games in DB for ROK-1352 lifecycle test');

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
      // 1) Force the scheduler scan → channel created + id persisted.
      await forceEphemeralScan(ctx.api);
      await awaitProcessing(ctx.api);
      channelId = await pollForCondition(
        async () => getEphemeralChannelId(ctx.api, ev.id),
        ctx.config.timeoutMs,
        { intervalMs: 1500 },
      );
      if (!channelId) {
        throw new Error('Ephemeral channel was not created within timeout');
      }

      // 2) Occupy the channel, then force a reap — it MUST survive (AC4).
      await joinVoice(channelId);
      await pollForCondition(
        async () => {
          const m = getVoiceMembers(channelId!);
          return m.some((x) => x.id === ctx.testBotDiscordId) ? true : null;
        },
        ctx.config.timeoutMs,
        { intervalMs: 1000 },
      );
      await forceEphemeralReap(ctx.api);
      await awaitProcessing(ctx.api);
      const stillThere = await getEphemeralChannelId(ctx.api, ev.id);
      if (stillThere !== channelId) {
        throw new Error(
          `Occupied ephemeral channel was deleted (AC4 violation): ${stillThere}`,
        );
      }

      // 3) Vacate, force reap → channel deleted, id cleared.
      leaveVoice();
      await pollForCondition(
        async () => {
          const m = getVoiceMembers(channelId!);
          return m.some((x) => x.id === ctx.testBotDiscordId) ? null : true;
        },
        ctx.config.timeoutMs,
        { intervalMs: 1000 },
      );
      // Make the event "ended" so the safety-net reaper considers it:
      // findReapCandidates only matches events whose end is > idleMinutes ago
      // AND are empty. The event was created upcoming (required so the scheduler
      // creates the channel in the first place), so PATCH it into the past now —
      // endTime 40 min ago, beyond the 30-min idle window. RescheduleEventSchema
      // forbids past times; UpdateEventSchema (PATCH /events/:id) only enforces
      // start < end. ROK-1352.
      await ctx.api.patch(`/events/${ev.id}`, {
        startTime: futureTime(-90),
        endTime: futureTime(-40),
      });
      await forceEphemeralReap(ctx.api);
      await awaitProcessing(ctx.api);
      await pollForCondition(
        async () => {
          const id = await getEphemeralChannelId(ctx.api, ev.id);
          return id === null ? true : null;
        },
        ctx.config.timeoutMs,
        { intervalMs: 1500 },
      ).catch(() => {
        throw new Error(
          'Ephemeral channel was not destroyed after idle reap (AC4)',
        );
      });
    } finally {
      leaveVoice();
      await setEphemeralVoiceConfig(ctx.api, {
        enabled: false,
        categoryId: null,
      }).catch(() => undefined);
      await deleteEvent(ctx.api, ev.id);
    }
  },
};

export const ephemeralVoiceTests: SmokeTest[] = [ephemeralLifecycle];
