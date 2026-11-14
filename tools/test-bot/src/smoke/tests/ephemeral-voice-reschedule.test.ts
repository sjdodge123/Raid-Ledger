/**
 * ROK-2201: an EMPTY ⏰ temporary voice channel is released when its event's
 * start moves past now + the create buffer. Before the fix the channel stayed
 * up for hours ahead of the new start (and the create cron never re-made it
 * at the right time). The channel is deleted in Discord and the event's
 * `ephemeralVoiceChannelId` clears; the create cron recreates it before the
 * new start.
 *
 * Flow: enable temporary voice with a 90-min create buffer, create an opted-in
 * event 60 min out, force the scheduler scan so the channel exists, PATCH the
 * start to ~3 h out (past now + 90 min), then poll DISCORD until the channel is
 * gone, and the event read until its channel id is null.
 *
 * Not covered here: "an occupied channel stays". That needs a real voice join,
 * which CI runners cannot make (SMOKE_SKIP_VOICE_JOIN=1); the api unit and
 * integration specs pin it (ephemeral-voice.reschedule.helpers.spec.ts, the
 * event.listener ephemeral-reschedule integration spec).
 *
 * Deterministic polling only — no fixed delays.
 */
import { pollForCondition } from '../../helpers/polling.js';
import { getGuild } from '../../client.js';
import {
  awaitProcessing,
  createEvent,
  deleteEvent,
  futureTime,
} from '../fixtures.js';
import { SmokeAssertionError } from '../assert.js';
import {
  forceEphemeralScan,
  getEphemeralChannelId,
  reportOrphanChannel,
  resolveCategoryId,
  resolveGameId,
  setEphemeralVoiceConfig,
} from './ephemeral-voice.test.js';
import type { SmokeTest, TestContext } from '../types.js';

/** The event (60 min out) sits inside this buffer, so the scan creates it. */
const BUFFER_MIN = 90;
/** The reschedule target: past now + BUFFER_MIN. */
const NEW_START_IN_MIN = 180;

/** True while Discord still has the channel (REST, not the gateway cache). */
async function channelExists(channelId: string): Promise<boolean> {
  const ch = await Promise.resolve()
    .then(() => getGuild().channels.fetch(channelId, { force: true }))
    .catch(() => null);
  return ch !== null;
}

/** Force the scheduler scan and wait for the channel id to be persisted. */
async function createChannelNow(
  ctx: TestContext,
  eventId: number,
): Promise<string> {
  await forceEphemeralScan(ctx.api);
  await awaitProcessing(ctx.api);
  const channelId = await pollForCondition(
    async () => getEphemeralChannelId(ctx.api, eventId),
    ctx.config.timeoutMs,
    { intervalMs: 1500 },
  ).catch(() => {
    throw new Error('precondition: temporary voice channel was not created');
  });
  if (!(await channelExists(channelId))) {
    throw new Error(`precondition: channel ${channelId} is not in Discord`);
  }
  return channelId;
}

/** The fix: the empty channel is deleted in Discord and its id clears. */
async function assertReleased(
  ctx: TestContext,
  eventId: number,
  channelId: string,
): Promise<void> {
  const why =
    `ROK-2201: empty temporary voice channel ${channelId} should be deleted ` +
    `once event ${eventId}'s start moved ${NEW_START_IN_MIN} min out ` +
    `(create buffer ${BUFFER_MIN} min)`;
  await pollForCondition(
    async () => ((await channelExists(channelId)) ? null : true),
    ctx.config.timeoutMs,
    { intervalMs: 2000 },
  ).catch(() => {
    throw new SmokeAssertionError(`${why}; Discord still has it`);
  });
  let lastId: string | null = channelId;
  await pollForCondition(
    async () => {
      lastId = await getEphemeralChannelId(ctx.api, eventId);
      return lastId === null ? true : null;
    },
    ctx.config.timeoutMs,
    { intervalMs: 1500 },
  ).catch(() => {
    throw new SmokeAssertionError(
      `${why}; channel is gone but ephemeralVoiceChannelId is still ${String(lastId)}`,
    );
  });
}

/** Product teardown first (event delete), then the orphan check, then config. */
async function teardown(
  ctx: TestContext,
  eventId: number,
  channelId: string | null,
): Promise<void> {
  await deleteEvent(ctx.api, eventId).catch(() => undefined);
  if (channelId) await reportOrphanChannel(channelId);
  await setEphemeralVoiceConfig(ctx.api, {
    enabled: false,
    categoryId: null,
  }).catch(() => undefined);
}

const releaseOnStartMovedLater: SmokeTest = {
  name: 'ROK-2201: empty temporary voice channel is released when the start moves past the create buffer',
  category: 'voice',
  async run(ctx) {
    const categoryId = await resolveCategoryId(ctx);
    const gameId = await resolveGameId(ctx);
    await setEphemeralVoiceConfig(ctx.api, {
      enabled: true,
      categoryId,
      createBufferMinutes: BUFFER_MIN,
      idleMinutes: 30,
    });
    const ev = await createEvent(ctx.api, 'rok2201-ephemeral', {
      gameId,
      startTime: futureTime(60),
      endTime: futureTime(120),
      ephemeralVoiceEnabled: true,
    });
    let channelId: string | null = null;
    try {
      channelId = await createChannelNow(ctx, ev.id);
      await ctx.api.patch(`/events/${ev.id}`, {
        startTime: futureTime(NEW_START_IN_MIN),
        endTime: futureTime(NEW_START_IN_MIN + 60),
      });
      await awaitProcessing(ctx.api);
      await assertReleased(ctx, ev.id, channelId);
    } finally {
      await teardown(ctx, ev.id, channelId);
    }
  },
};

export const ephemeralVoiceRescheduleTests: SmokeTest[] = [
  releaseOnStartMovedLater,
];
