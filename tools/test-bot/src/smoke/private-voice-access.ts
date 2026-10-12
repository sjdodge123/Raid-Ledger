/**
 * ROK-1769 — fixtures for the private-voice access smoke tests.
 *
 * A private ephemeral voice channel is locked with a Connect-deny on
 * `@everyone` plus one member overwrite per rostered Discord id
 * (`applyPrivateVoiceOverwrites`). These helpers read that overwrite straight
 * from Discord, read the DM notification mirror, and render a notification
 * through the API's REAL DM builder (`/admin/test/render-dm-embed`) — the
 * companion bot cannot read a DM another bot sends (Discord 50007).
 */
import { OverwriteType } from 'discord.js';
import { getGuild } from '../client.js';
import { pollForCondition } from '../helpers/polling.js';
import { SmokeAssertionError } from './assert.js';
import { awaitProcessing, getNotificationsFor } from './fixtures.js';
import type { ApiClient } from './api.js';
import type { TestContext } from './types.js';

/** `buildVoiceAccessLostInput` title (api/src/notifications/voice-access-lost.helpers.ts). */
export const DEPARTURE_TITLE = 'Voice Channel Access Removed';
/** `notifyRemovedUser` title (api/src/events/signups-roster-ops.helpers.ts). */
export const REMOVAL_TITLE = 'Removed from Event';
/** `VOICE_ACCESS_LOST_LINE` — appended to the removal DM after a blank line. */
export const VOICE_LINE =
  'You no longer have access to the private voice channel. Sign up for the event again to get it back.';
/** The render seam's fixed notification id (demo-test-render-dm-embed.controller.ts). */
const RENDER_NOTIFICATION_ID = 'demo-render-dm-embed';
/** discord-api-types ButtonStyle.Link. */
const LINK_STYLE = 5;

export function departureMessage(title: string): string {
  return `You no longer have access to the private voice channel for "${title}". Sign up for the event again to get your access back.`;
}

export function removalMessage(title: string): string {
  return `You were removed from ${title}\n\n${VOICE_LINE}`;
}

export function fail(msg: string): never {
  throw new SmokeAssertionError(msg);
}

/** Global ephemeral-voice config (admin) — same route ROK-1352's smoke uses. */
export async function setEphemeralVoiceConfig(
  api: ApiClient,
  cfg: { enabled: boolean; categoryId: string | null },
): Promise<void> {
  await api.put('/admin/settings/discord-bot/ephemeral-voice', {
    ...cfg,
    ...(cfg.enabled ? { createBufferMinutes: 30, idleMinutes: 30 } : {}),
  });
}

/** A real GUILD_CATEGORY to parent the channel (prefers a voice category). */
export async function resolveCategoryId(api: ApiClient): Promise<string> {
  const fromEnv = process.env.SMOKE_EPHEMERAL_CATEGORY_ID;
  if (fromEnv) return fromEnv;
  type Cat = { id: string; name: string };
  const cats = await api
    .get<Cat[]>('/admin/settings/discord-bot/ephemeral-voice/categories')
    .catch(() => [] as Cat[]);
  const list = Array.isArray(cats) ? cats : [];
  const id = list.find((c) => /voice/i.test(c.name))?.id ?? list[0]?.id;
  if (!id) throw new Error('No ephemeral parent category available for smoke run');
  return id;
}

/** ctx.games is empty after reset-to-seed; fall back to the library (ROK-1352). */
export async function resolveGameId(ctx: TestContext): Promise<number> {
  const fromCtx = ctx.games[0]?.id;
  if (fromCtx) return fromCtx;
  const res = await ctx.api.get<{ data: { id: number }[] }>(
    '/admin/settings/games?limit=1',
  );
  const id = res.data[0]?.id;
  if (!id) throw new Error('No games in DB for ROK-1769 private-voice test');
  return id;
}

/** Force the create-window scan and wait for the channel id to persist. */
export async function awaitPrivateChannel(
  ctx: TestContext,
  eventId: number,
): Promise<string> {
  await ctx.api.post('/admin/test/ephemeral-voice/scan', {});
  await awaitProcessing(ctx.api);
  return pollForCondition(
    async () => {
      const ev = await ctx.api.get<{ ephemeralVoiceChannelId: string | null }>(
        `/events/${eventId}`,
      );
      return ev.ephemeralVoiceChannelId ?? null;
    },
    ctx.config.timeoutMs,
    { intervalMs: 1500 },
  ).catch(() => fail(`event ${eventId}: private ephemeral channel was never created`));
}

/** True when `discordId` has a MEMBER overwrite on the channel (read from Discord). */
async function hasMemberOverwrite(channelId: string, discordId: string): Promise<boolean> {
  const channel = await getGuild().channels.fetch(channelId, { force: true });
  if (!channel || !('permissionOverwrites' in channel)) {
    fail(`channel ${channelId} is gone or has no permission overwrites`);
  }
  const ow = channel.permissionOverwrites.cache.get(discordId);
  return ow !== undefined && ow.type === OverwriteType.Member;
}

/** Poll until the member overwrite is present (`want=true`) or gone. */
export async function awaitOverwrite(
  ctx: TestContext,
  channelId: string,
  want: boolean,
  phase: string,
): Promise<void> {
  const discordId = ctx.testBotDiscordId;
  await pollForCondition(
    async () => ((await hasMemberOverwrite(channelId, discordId)) === want ? true : null),
    ctx.config.timeoutMs,
    { intervalMs: 2000 },
  ).catch(() =>
    fail(
      `${phase}: expected member overwrite for ${discordId} on ${channelId} to be ${want ? 'PRESENT' : 'ABSENT'}, but it stayed ${want ? 'ABSENT' : 'PRESENT'}`,
    ),
  );
}

export interface MirroredNotification {
  id: number;
  type: string;
  title: string;
  message: string;
  payload?: Record<string, unknown>;
}

/** Every slot_vacated notification the recipient has for this event. */
export async function eventNotifications(
  ctx: TestContext,
  eventId: number,
): Promise<MirroredNotification[]> {
  const rows = (await getNotificationsFor(
    ctx.api,
    ctx.dmRecipientUserId,
    'slot_vacated',
    50,
  )) as unknown as MirroredNotification[];
  return (Array.isArray(rows) ? rows : []).filter(
    (n) => n.payload?.eventId === eventId,
  );
}

interface RenderedDm {
  embed: { title?: string; description?: string };
  components: { components?: { type?: number; style?: number; label?: string; url?: string }[] }[];
}

/**
 * Render the mirrored notification through the REAL DM builder and assert
 * title, both description lines and the `Sign Up` link button's URL. The seam
 * uses a fixed notification id, so the URL's `notif` value is the seam's.
 */
export async function assertRenderedDm(
  api: ApiClient,
  n: MirroredNotification,
  eventId: number,
  expectedLines: string[],
): Promise<void> {
  const r = await api.post<RenderedDm>('/admin/test/render-dm-embed', {
    type: n.type,
    title: n.title,
    message: n.message,
    ...(n.payload ? { payload: n.payload } : {}),
  });
  if (r.embed.title !== n.title) {
    fail(`DM title: expected "${n.title}", got "${String(r.embed.title)}"`);
  }
  const desc = r.embed.description ?? '';
  for (const line of expectedLines) {
    if (!desc.includes(line)) fail(`DM description missing "${line}" — got "${desc}"`);
  }
  const buttons = r.components.flatMap((row) => row.components ?? []);
  const signUp = buttons.filter((b) => b.label === 'Sign Up');
  if (signUp.length !== 1) {
    fail(`DM buttons: expected exactly one "Sign Up", got [${buttons.map((b) => b.label).join(', ')}]`);
  }
  const btn = signUp[0];
  const wantUrl = `/events/${eventId}?notif=${RENDER_NOTIFICATION_ID}`;
  if (btn?.style !== LINK_STYLE || !btn.url?.endsWith(wantUrl)) {
    fail(`"Sign Up" must be a link button ending ${wantUrl}; got style=${String(btn?.style)} url=${String(btn?.url)}`);
  }
}
