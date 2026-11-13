/**
 * ROK-2187 — GG <year> delivery: the community announcement posts exactly once
 * to the configured channel, and once the DM offset has passed the DM wave
 * reaches the companion's linked demo user.
 *
 *  1. Snapshot the admin GG settings, then enable GG with the channel override
 *     pointed at the default channel and a 15-minute DM offset.
 *  2. Seed a minimal snapshot for the DM recipient (so the wave always has a
 *     row for them, activity or not), then reset the year (announce key + DM
 *     claims released).
 *  3. Send now → `waiting-offset`; exactly one "GG <year> is here" embed lands
 *     in the channel. A repeat send-now keeps the same `announcedAt` and posts
 *     no second embed.
 *  4. Backdate the announcement past the offset; send-now answers
 *     (`announced`, no DM wave — pacing stays on the cron). Tick until the wave
 *     reaches the recipient (≤25 per pass, ordered by snapshot id).
 *  5. The DM itself cannot be read: the companion is a bot and Discord refuses
 *     bot-to-bot DMs (50007 — see `dm-embed-render.test.ts`). The recipient's
 *     `gg_ready` notification row is asserted instead, and its DM embed is
 *     rendered through the deployed API's real builder
 *     (`POST /admin/test/render-dm-embed`).
 *  6. Teardown: settings restored with the kill switch OFF, the year reset.
 *
 * Serial: GG settings are global and the DM wave notifies every user with a
 * snapshot, so this must not overlap other DM tests.
 */
import type { SimpleMessage } from "../../helpers/messages.js";
import { readLastMessages } from "../../helpers/messages.js";
import { pollForCondition, pollForEmbed, snapshotMessageIds } from "../../helpers/polling.js";
import { SmokeAssertionError } from "../assert.js";
import { assertConditionNeverMet, awaitProcessing } from "../fixtures.js";
import type { ApiClient } from "../api.js";
import type { SmokeTest, TestContext } from "../types.js";

const SETTINGS = "/admin/gg/settings";
const SEND_NOW = "/admin/gg/send-now";
const DM_OFFSET_MINUTES = 15;
/** `buildNotificationEmbed` prefixes the DM title with the type emoji (gg_ready → 🎮). */
const DM_TITLE_EMOJI = "🎮";

interface GgSettings {
  enabled: boolean;
  deliveryDate: string;
  dmOffsetMinutes: number;
  channelId: string | null;
}

interface SendNowOutcome {
  status: string;
  year?: number;
  announcedAt?: string;
  dm?: { claimed: number; sent: number; failed: number };
}

interface GgNotification {
  id: string;
  type: string;
  title?: string;
  message?: string;
  payload?: Record<string, unknown>;
}

function fail(msg: string): never {
  throw new SmokeAssertionError(msg);
}

function sendNow(api: ApiClient): Promise<SendNowOutcome> {
  return api.post<SendNowOutcome>(SEND_NOW, {});
}

/** One cron-equivalent pass (date gate skipped) — send-now never runs the DM wave. */
function tick(api: ApiClient): Promise<SendNowOutcome> {
  return api.post<SendNowOutcome>("/admin/test/gg/tick", {});
}

function isAnnouncement(msg: SimpleMessage, year: number): boolean {
  return msg.embeds.some((e) => e.title === `GG ${year} is here`);
}

/** A snapshot with no cards — the seed fixture stores it verbatim. */
function minimalSnapshot(year: number): Record<string, unknown> {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    year,
    window: { from: `${year}-01-01T00:00:00.000Z`, to: now },
    tier: "short",
    computedAt: now,
    cards: [],
  };
}

/** Enable GG, override the channel, pin the offset; return the prior settings. */
async function enableGg(ctx: TestContext): Promise<GgSettings> {
  const before = await ctx.api.get<GgSettings>(SETTINGS);
  const after = await ctx.api.patch<GgSettings>(SETTINGS, {
    enabled: true,
    channelId: ctx.defaultChannelId,
    dmOffsetMinutes: DM_OFFSET_MINUTES,
  });
  if (!after.enabled || after.channelId !== ctx.defaultChannelId) {
    fail(`GG settings did not take: ${JSON.stringify(after)}`);
  }
  return before;
}

async function seedAndReset(ctx: TestContext, year: number): Promise<void> {
  await ctx.api.post("/admin/test/gg/seed", {
    userId: ctx.dmRecipientUserId,
    year,
    snapshot: minimalSnapshot(year),
  });
  await ctx.api.post("/admin/test/gg/reset", { year });
  await ctx.api.post("/admin/test/enable-discord-notifications", {
    userId: ctx.dmRecipientUserId,
  });
}

/** First send-now: announce, hold the DMs behind the offset, one embed posted. */
async function announceOnce(ctx: TestContext, year: number): Promise<SimpleMessage> {
  const fence = await snapshotMessageIds(ctx.defaultChannelId);
  const first = await sendNow(ctx.api);
  if (first.status !== "waiting-offset" || first.year !== year) {
    fail(`first send-now: expected "waiting-offset" for ${year}, got ${JSON.stringify(first)}`);
  }
  const posted = await pollForEmbed(
    ctx.defaultChannelId,
    (m) => isAnnouncement(m, year),
    ctx.config.timeoutMs,
    { excludeIds: fence },
  );
  if (!posted.embeds[0]?.description?.includes(`GG ${year}`)) {
    fail(`announcement description lacks "GG ${year}": ${posted.embeds[0]?.description}`);
  }
  await assertSecondSendNowPostsNothing(ctx, year, { fence, posted, first });
  return posted;
}

async function assertSecondSendNowPostsNothing(
  ctx: TestContext,
  year: number,
  seen: { fence: Set<string>; posted: SimpleMessage; first: SendNowOutcome },
): Promise<void> {
  const again = await sendNow(ctx.api);
  if (again.status !== "waiting-offset" || again.announcedAt !== seen.first.announcedAt) {
    fail(`repeat send-now: expected "waiting-offset" at ${seen.first.announcedAt}, got ${JSON.stringify(again)}`);
  }
  await assertConditionNeverMet(
    async () => {
      const msgs = await readLastMessages(ctx.defaultChannelId, 50);
      return msgs.some(
        (m) => isAnnouncement(m, year) && !seen.fence.has(m.id) && m.id !== seen.posted.id,
      );
    },
    6_000,
    `A second GG ${year} announcement was posted after a repeat send-now`,
    { intervalMs: 2000 },
  );
}

/** The recipient's gg_ready rows, newest first. */
function readyRows(ctx: TestContext): Promise<GgNotification[]> {
  const params = new URLSearchParams({
    userId: String(ctx.dmRecipientUserId),
    type: "gg_ready",
    limit: "50",
  });
  return ctx.api.get<GgNotification[]>(`/admin/test/notifications?${params}`);
}

/** Ids of the recipient's gg_ready rows before this run (a prior run's row never matches). */
async function readyFence(ctx: TestContext): Promise<Set<string>> {
  return new Set((await readyRows(ctx)).map((n) => n.id));
}

/** The recipient's gg_ready row for `year` that is not behind the fence, if any. */
async function findReady(
  ctx: TestContext,
  year: number,
  fence: Set<string>,
): Promise<GgNotification | undefined> {
  const rows = await readyRows(ctx);
  return rows.find((n) => !fence.has(n.id) && n.payload?.year === year);
}

/** Age the announcement past the offset; send-now must NOT DM; ticks run the wave to the recipient. */
async function runDmWave(ctx: TestContext, year: number, fence: Set<string>): Promise<GgNotification> {
  const aged = await ctx.api.post<{ aged: number }>("/admin/test/gg/age-announce", {
    year,
    minutes: DM_OFFSET_MINUTES + 1,
  });
  if (aged.aged !== 1) fail(`age-announce: expected 1 row, got ${JSON.stringify(aged)}`);
  const announceOnly = await sendNow(ctx.api);
  if (announceOnly.status !== "announced" || announceOnly.dm) {
    fail(`send-now after the offset: expected "announced" with no DM wave, got ${JSON.stringify(announceOnly)}`);
  }
  return pollForCondition(
    async () => {
      const out = await tick(ctx.api);
      if (out.status !== "dm-wave" || !out.dm) {
        fail(`tick after the offset: expected "dm-wave", got ${JSON.stringify(out)}`);
      }
      await awaitProcessing(ctx.api);
      const row = await findReady(ctx, year, fence);
      if (row) return row;
      if (out.dm.claimed === 0) {
        fail(`DM wave drained without a gg_ready for user ${ctx.dmRecipientUserId}`);
      }
      return null;
    },
    ctx.config.timeoutMs * 2,
    { intervalMs: 1000, backoff: false },
  );
}

/** Pin the notification and its DM embed (rendered by the real builder). */
async function assertReady(ctx: TestContext, n: GgNotification, year: number): Promise<void> {
  if (n.title !== `Your GG ${year} is ready`) {
    fail(`gg_ready title: expected "Your GG ${year} is ready", got "${n.title}"`);
  }
  if (n.payload?.url !== `/gg/${year}`) {
    fail(`gg_ready payload.url: expected "/gg/${year}", got ${JSON.stringify(n.payload?.url)}`);
  }
  const res = await ctx.api.post<{ embed: { title?: string } }>("/admin/test/render-dm-embed", {
    type: "gg_ready",
    title: n.title,
    message: n.message ?? "",
    payload: n.payload ?? {},
  });
  const expected = `${DM_TITLE_EMOJI} Your GG ${year} is ready`;
  if (res.embed.title !== expected) {
    fail(`gg_ready DM title: expected "${expected}", got "${res.embed.title}"`);
  }
}

/** Kill switch OFF, prior channel/offset back, the year released again. */
async function restore(ctx: TestContext, before: GgSettings, year: number): Promise<void> {
  await ctx.api.patch(SETTINGS, {
    enabled: false,
    channelId: before.channelId,
    dmOffsetMinutes: before.dmOffsetMinutes,
  });
  await ctx.api.post("/admin/test/gg/reset", { year });
}

async function ggAnnouncesOnceThenDms(ctx: TestContext): Promise<void> {
  const before = await enableGg(ctx);
  const year = Number(before.deliveryDate.slice(0, 4));
  try {
    await seedAndReset(ctx, year);
    const fence = await readyFence(ctx);
    const posted = await announceOnce(ctx, year);
    console.log(`    ROK-2187: GG ${year} announced as message ${posted.id}`);
    const n = await runDmWave(ctx, year, fence);
    await assertReady(ctx, n, year);
  } finally {
    await restore(ctx, before, year);
  }
}

export const ggDeliveryTests: SmokeTest[] = [
  {
    name: "GG delivery: send-now announces once, DM wave reaches the recipient after the offset (ROK-2187)",
    category: "dm",
    serial: true,
    run: ggAnnouncesOnceThenDms,
  },
];
