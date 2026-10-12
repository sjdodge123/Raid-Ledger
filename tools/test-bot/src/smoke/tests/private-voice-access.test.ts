/**
 * ROK-1769 — members who lose a private ephemeral voice channel get back in
 * by signing up again, and are told so in exactly one DM.
 *
 * The companion bot's Discord id is linked to `ctx.dmRecipientUserId`, so the
 * private channel's member overwrite for `ctx.testBotDiscordId` IS that
 * member's voice access, read straight from Discord.
 *
 *  1. Organizer removal → overwrite gone; ONE `Removed from Event` DM carrying
 *     the voice line and a `Sign Up` link button; NO standalone voice DM;
 *     re-sign-up → overwrite back.
 *  2. Departure (`/admin/test/trigger-departure`, event made live first) →
 *     overwrite gone; ONE `Voice Channel Access Removed` DM with `Sign Up`;
 *     re-sign-up reactivates the departed row → overwrite back.
 *
 * DM content is asserted on the notification mirror plus the REAL DM builder
 * via `/admin/test/render-dm-embed` (bots cannot read bot DMs — 50007).
 * Serial: both flip the GLOBAL ephemeral-voice config, which ROK-1352's
 * lifecycle smoke also flips. Deterministic polling only.
 */
import { DiscordAPIError } from 'discord.js';
import { getGuild } from '../../client.js';
import { pollForCondition } from '../../helpers/polling.js';
import {
  assertConditionNeverMet,
  awaitProcessing,
  createEvent,
  deleteEvent,
  futureTime,
  removeSignup,
  signupAs,
  triggerDeparture,
} from '../fixtures.js';
import {
  DEPARTURE_TITLE,
  REMOVAL_TITLE,
  VOICE_LINE,
  assertRenderedDm,
  awaitOverwrite,
  awaitPrivateChannel,
  departureMessage,
  eventNotifications,
  fail,
  removalMessage,
  resolveCategoryId,
  resolveGameId,
  setEphemeralVoiceConfig,
  type MirroredNotification,
} from '../private-voice-access.js';
import type { SmokeTest, TestContext } from '../types.js';

/** Window in which a second (duplicate) DM for the same removal must NOT appear. */
const ONE_DM_WINDOW_MS = 8_000;

interface Fixture {
  eventId: number;
  title: string;
  signupId: number;
  channelId: string;
}

/** Private event in the create window, member signed up, channel locked. */
async function setUp(ctx: TestContext, tag: string, track: (id: number) => void): Promise<Fixture> {
  const categoryId = await resolveCategoryId(ctx.api);
  const gameId = await resolveGameId(ctx);
  await setEphemeralVoiceConfig(ctx.api, { enabled: true, categoryId });
  const ev = await createEvent(ctx.api, tag, {
    gameId,
    startTime: futureTime(10),
    endTime: futureTime(70),
    ephemeralVoiceEnabled: true,
    privateVoice: true,
  });
  track(ev.id);
  const res = (await signupAs(ctx.api, ev.id, ctx.dmRecipientUserId)) as { id?: number };
  if (!res.id) fail('signup returned no id');
  await awaitProcessing(ctx.api);
  const channelId = await awaitPrivateChannel(ctx, ev.id);
  await awaitOverwrite(ctx, channelId, true, 'after first sign-up');
  return { eventId: ev.id, title: ev.title, signupId: res.id, channelId };
}

/** Poll until exactly one notification titled `title` exists, then return it. */
async function awaitSingleDm(
  ctx: TestContext,
  eventId: number,
  title: string,
): Promise<MirroredNotification> {
  let seen: MirroredNotification[] = [];
  await assertConditionNeverMet(
    async () => {
      seen = await eventNotifications(ctx, eventId);
      return seen.length > 1;
    },
    ONE_DM_WINDOW_MS,
    'more than one DM for a single removal',
  ).catch(() =>
    fail(`expected ONE DM for this removal, got ${seen.length}: [${seen.map((n) => n.title).join(' | ')}]`),
  );
  const only = seen[0];
  if (seen.length !== 1 || !only || only.title !== title) {
    fail(`expected exactly one "${title}" DM, got [${seen.map((n) => n.title).join(' | ')}]`);
  }
  return only;
}

/** Wait for the first notification on the event, then hold the one-DM window. */
async function awaitRemovalDm(ctx: TestContext, eventId: number, title: string) {
  await pollForCondition(
    async () => ((await eventNotifications(ctx, eventId)).length > 0 ? true : null),
    ctx.config.timeoutMs,
    { intervalMs: 1500 },
  ).catch(() => fail(`no "${title}" notification for event ${eventId}`));
  return awaitSingleDm(ctx, eventId, title);
}

async function reSignUp(ctx: TestContext, f: Fixture): Promise<void> {
  await signupAs(ctx.api, f.eventId, ctx.dmRecipientUserId);
  await awaitProcessing(ctx.api);
  await awaitOverwrite(ctx, f.channelId, true, 're-sign-up');
}

/** Product teardown first (event delete destroys the channel), then sweep. */
async function teardown(ctx: TestContext, eventId: number | null): Promise<void> {
  let channelId: string | null = null;
  if (eventId !== null) {
    channelId = await ctx.api
      .get<{ ephemeralVoiceChannelId: string | null }>(`/events/${eventId}`)
      .then((e) => e.ephemeralVoiceChannelId ?? null)
      .catch(() => null);
    await deleteEvent(ctx.api, eventId);
  }
  if (channelId) await removeOrphan(channelId);
  await setEphemeralVoiceConfig(ctx.api, { enabled: false, categoryId: null }).catch(() => undefined);
}

async function removeOrphan(channelId: string): Promise<void> {
  const channel = await Promise.resolve()
    .then(() => getGuild().channels.fetch(channelId, { force: true }))
    .catch(() => null);
  if (!channel) return;
  console.warn(`[ROK-1769] private channel ${channelId} survived event delete`);
  await channel.delete('smoke cleanup (ROK-1769)').catch((err: unknown) => {
    const code = err instanceof DiscordAPIError ? err.code : undefined;
    console.warn(`[ROK-1769] cleanup delete of ${channelId} failed: code=${String(code)}`);
  });
}

const removalRegainsAccess: SmokeTest = {
  name: 'Private voice: organizer removal drops access, one DM, re-sign-up restores (ROK-1769)',
  category: 'voice',
  serial: true,
  async run(ctx) {
    let eventId: number | null = null;
    try {
      const f = await setUp(ctx, 'rok1769-remove', (id) => (eventId = id));
      await removeSignup(ctx.api, f.eventId, f.signupId);
      await awaitProcessing(ctx.api);
      await awaitOverwrite(ctx, f.channelId, false, 'after organizer removal');
      const dm = await awaitRemovalDm(ctx, f.eventId, REMOVAL_TITLE);
      if (dm.message !== removalMessage(f.title)) {
        fail(`removal DM text: expected ${JSON.stringify(removalMessage(f.title))}, got ${JSON.stringify(dm.message)}`);
      }
      await assertRenderedDm(ctx.api, dm, f.eventId, [`You were removed from ${f.title}`, VOICE_LINE]);
      await reSignUp(ctx, f);
    } finally {
      await teardown(ctx, eventId);
    }
  },
};

const departureRegainsAccess: SmokeTest = {
  name: 'Private voice: departure drops access, one DM, re-sign-up restores (ROK-1769)',
  category: 'voice',
  serial: true,
  async run(ctx) {
    let eventId: number | null = null;
    try {
      const f = await setUp(ctx, 'rok1769-depart', (id) => (eventId = id));
      // Departure only applies to a LIVE event; the scan only creates for an
      // upcoming one — so create upcoming, then move it live (ROK-1352 pattern).
      await ctx.api.patch(`/events/${f.eventId}`, {
        startTime: futureTime(-5),
        endTime: futureTime(55),
      });
      await awaitProcessing(ctx.api);
      await triggerDeparture(ctx.api, f.eventId, f.signupId, ctx.testBotDiscordId);
      await awaitProcessing(ctx.api);
      await awaitOverwrite(ctx, f.channelId, false, 'after departure');
      const dm = await awaitRemovalDm(ctx, f.eventId, DEPARTURE_TITLE);
      if (dm.message !== departureMessage(f.title)) {
        fail(`departure DM text: expected ${JSON.stringify(departureMessage(f.title))}, got ${JSON.stringify(dm.message)}`);
      }
      await assertRenderedDm(ctx.api, dm, f.eventId, [departureMessage(f.title)]);
      await reSignUp(ctx, f);
    } finally {
      await teardown(ctx, eventId);
    }
  },
};

export const privateVoiceAccessTests: SmokeTest[] = [
  removalRegainsAccess,
  departureRegainsAccess,
];
