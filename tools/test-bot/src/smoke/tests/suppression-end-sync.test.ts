/**
 * ROK-1696: a suppressed Quick Play join that pushes a live scheduled event's
 * window forward (`extended_until`) must also push the new end to the bound
 * Discord Scheduled Event. Before the fix the suppression path wrote the DB
 * column only, so Discord kept showing (and completing at) the old end.
 *
 * Flow: one game-voice-monitor binding for game B on a voice channel, a
 * scheduled event for game B that owns a Discord Scheduled Event, wait for the
 * start cron to mark that SE Active, join voice (the join is suppressed by the
 * live event, which extends its window), then require the SE's
 * `scheduledEndTime` to equal `extendedUntil`.
 *
 * Why no `/admin/test/set-event-times` back-dating: it is a DB-only write with
 * no app event. `ScheduledEventService` receives `ActiveEventCacheService` by
 * explicit token, and the `getActiveEvents(now)` short-circuit in
 * `startScheduledEvents` reads that cache, which keeps the creation-time start
 * until its next refresh (the 5-minute safety net or a lifecycle event). A
 * back-dated event would therefore not start any sooner. The event starts for
 * real a few minutes out instead; the Active wait covers the cache gate plus
 * one cron tick.
 *
 * Needs a real voice connection: gated by SMOKE_SKIP_VOICE_JOIN like the other
 * voice-join tests (CI runners cannot reach Discord voice). Deterministic
 * polling only; never a fixed delay.
 */
import { GuildScheduledEventStatus } from 'discord.js';
import { getGuild } from '../../client.js';
import { joinVoice, leaveVoice } from '../../helpers/voice.js';
import { pollForCondition } from '../../helpers/polling.js';
import {
  awaitProcessing,
  createBinding,
  createEvent,
  deleteBinding,
  deleteEvent,
  futureTime,
  pickChannel,
  signup,
} from '../fixtures.js';
import { SmokeAssertionError } from '../assert.js';
import {
  acquireScheduledEvents,
  releaseScheduledEvents,
} from '../scheduled-events-toggle.js';
import type { ApiClient } from '../api.js';
import type { SmokeTest, TestContext } from '../types.js';

/** Minutes until the event starts. Creation skips an SE whose start is past. */
const START_IN_MIN = 3;
/** Event end. The suppression target (join + 60m) lands well after it. */
const END_IN_MIN = 58;
/** Cache gate opens at the real start, then the start cron ticks each minute. */
const ACTIVE_TIMEOUT_MS = (START_IN_MIN + 2) * 60_000;
/** Discord and Postgres may round differently; one second is plenty. */
const END_SYNC_TOLERANCE_MS = 1000;

interface SeSnapshot {
  status: GuildScheduledEventStatus;
  endMs: number | null;
}

type EventDetail = { extendedUntil: string | null };

function isoOrNull(ms: number | null): string {
  return ms == null ? 'null' : new Date(ms).toISOString();
}

async function firstGameId(api: ApiClient): Promise<number> {
  const res = await api.get<{ data: { id: number }[] }>(
    '/admin/settings/games?limit=1',
  );
  const id = res.data[0]?.id;
  if (id == null) throw new Error('ROK-1696 smoke needs at least 1 game in DB');
  return id;
}

/** Guild SE whose name contains the unique event title (HTTP, not cache). */
async function findSeIdByTitle(title: string): Promise<string | null> {
  const events = await getGuild().scheduledEvents.fetch();
  return events.find((se) => se.name.includes(title))?.id ?? null;
}

/** Force a REST round-trip: the cached SE goes stale when the RL bot edits it. */
async function fetchSe(seId: string): Promise<SeSnapshot> {
  const se = await getGuild().scheduledEvents.fetch({
    guildScheduledEvent: seId,
    force: true,
  });
  return { status: se.status, endMs: se.scheduledEndTimestamp };
}

async function waitForSeId(ctx: TestContext, title: string): Promise<string> {
  return pollForCondition(() => findSeIdByTitle(title), ctx.config.timeoutMs, {
    intervalMs: 2000,
  }).catch(() => {
    throw new Error(`no Discord Scheduled Event appeared for "${title}"`);
  });
}

/** Wait for the start cron to flip the SE to Active; returns its end then. */
async function waitForActive(seId: string): Promise<SeSnapshot> {
  let last: SeSnapshot | null = null;
  return pollForCondition(
    async () => {
      last = await fetchSe(seId);
      return last.status === GuildScheduledEventStatus.Active ? last : null;
    },
    ACTIVE_TIMEOUT_MS,
    { intervalMs: 2000 },
  ).catch(() => {
    const status = last ? GuildScheduledEventStatus[last.status] : 'never read';
    throw new Error(
      `SE ${seId} did not reach Active within ${ACTIVE_TIMEOUT_MS}ms ` +
        `(last status: ${status})`,
    );
  });
}

async function waitForExtendedUntil(
  ctx: TestContext,
  eventId: number,
): Promise<string> {
  return pollForCondition(
    async () => {
      await awaitProcessing(ctx.api);
      const detail = await ctx.api.get<EventDetail>(`/events/${eventId}`);
      return detail.extendedUntil;
    },
    ctx.config.timeoutMs,
    { intervalMs: 2000 },
  ).catch(() => {
    throw new SmokeAssertionError(
      `extendedUntil not set on event ${eventId} after a suppressed voice join`,
    );
  });
}

/** The extension must move the end FORWARD, past the SE's original end. */
function assertExtendsPastOriginalEnd(
  eventId: number,
  extendedUntil: string,
  originalEndMs: number | null,
): void {
  const extMs = new Date(extendedUntil).getTime();
  if (originalEndMs != null && extMs > originalEndMs + END_SYNC_TOLERANCE_MS) {
    return;
  }
  throw new SmokeAssertionError(
    `event ${eventId} extendedUntil ${extendedUntil} is not after the ` +
      `Discord SE's original end ${isoOrNull(originalEndMs)}`,
  );
}

/** Poll until Discord's end equals extendedUntil; fail naming both values. */
async function assertSeEndSynced(
  ctx: TestContext,
  eventId: number,
  seId: string,
): Promise<void> {
  let ext: string | null = null;
  let seEndMs: number | null = null;
  await pollForCondition(
    async () => {
      ext = (await ctx.api.get<EventDetail>(`/events/${eventId}`)).extendedUntil;
      seEndMs = (await fetchSe(seId)).endMs;
      if (ext == null || seEndMs == null) return null;
      const delta = Math.abs(seEndMs - new Date(ext).getTime());
      return delta <= END_SYNC_TOLERANCE_MS ? true : null;
    },
    ctx.config.timeoutMs,
    { intervalMs: 2000 },
  ).catch(() => {
    throw new SmokeAssertionError(
      `Discord SE ${seId} scheduledEndTime ${isoOrNull(seEndMs)} != ` +
        `event ${eventId} extendedUntil ${ext} ` +
        `(tolerance ${END_SYNC_TOLERANCE_MS}ms)`,
    );
  });
}

/** SE live → suppressed join → extended_until → Discord end matches. */
async function proveEndSync(
  ctx: TestContext,
  ev: { id: number; title: string },
  voiceChannelId: string,
): Promise<void> {
  const seId = await waitForSeId(ctx, ev.title);
  const active = await waitForActive(seId);
  await joinVoice(voiceChannelId);
  const extendedUntil = await waitForExtendedUntil(ctx, ev.id);
  assertExtendsPastOriginalEnd(ev.id, extendedUntil, active.endMs);
  await assertSeEndSynced(ctx, ev.id, seId);
}

const suppressionEndSync: SmokeTest = {
  name: 'ROK-1696: suppressed Quick Play join syncs extended end to the Discord Scheduled Event',
  category: 'voice',
  async run(ctx) {
    const vCh = pickChannel(ctx.voiceChannels, 0);
    const gameId = await firstGameId(ctx.api);
    let bindingId: string | undefined;
    let eventId: number | undefined;
    await acquireScheduledEvents(ctx.api);
    try {
      bindingId = await createBinding(ctx.api, {
        channelId: vCh.id,
        channelType: 'voice',
        purpose: 'game-voice-monitor',
        gameId,
        config: { minPlayers: 1 },
      });
      await awaitProcessing(ctx.api);
      const ev = await createEvent(ctx.api, 'rok1696-sync', {
        gameId,
        startTime: futureTime(START_IN_MIN),
        endTime: futureTime(END_IN_MIN),
      });
      eventId = ev.id;
      await signup(ctx.api, ev.id);
      await proveEndSync(ctx, ev, vCh.id);
    } finally {
      leaveVoice();
      if (bindingId) await deleteBinding(ctx.api, bindingId);
      if (eventId) await deleteEvent(ctx.api, eventId);
      await releaseScheduledEvents(ctx.api);
    }
  },
};

// Voice-join tests need real UDP connectivity to Discord voice servers; CI
// runners cannot establish it and set SMOKE_SKIP_VOICE_JOIN=1 (ROK-969).
const canJoinVoice = process.env.SMOKE_SKIP_VOICE_JOIN !== '1';
if (!canJoinVoice) {
  console.log(
    '  SKIP (unregistered): "ROK-1696: suppressed Quick Play join syncs ' +
      'extended end" (SMOKE_SKIP_VOICE_JOIN=1)',
  );
}

export const suppressionEndSyncTests: SmokeTest[] = canJoinVoice
  ? [suppressionEndSync]
  : [];
