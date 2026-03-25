import type { ApiClient } from './api.js';
import type { DiscordChannel, TestContext } from './types.js';

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
  if (channels.length === 0) throw new Error('No channels available');
  return channels[index % channels.length];
}

/**
 * Select a channel for a test from the channel pool.
 * Falls back to defaultChannelId when no pool is configured.
 */
export function channelForTest(
  ctx: Pick<TestContext, 'defaultChannelId' | 'channelPool'>,
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
  ctx: Pick<TestContext, 'defaultChannelId' | 'channelPool'>,
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
  const event = await api.post<Record<string, unknown>>('/events', body);
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
    channelType: 'text' | 'voice';
    purpose: string;
    gameId?: number;
    config?: Record<string, unknown>;
  },
) {
  const res = await api.post<{ data: { id: string } }>(
    '/admin/discord/bindings',
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
  return api.post('/admin/test/link-discord', {
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
  opts?: { characterId?: string; status?: string; linkDiscord?: boolean },
) {
  return api.post('/admin/test/signup', {
    eventId,
    userId,
    preferredRoles,
    characterId: opts?.characterId,
    status: opts?.status,
    linkDiscord: opts?.linkDiscord,
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
    role: role ?? 'dps',
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
  return api.post('/admin/test/add-game-interest', { userId, gameId });
}

/** Trigger a departure grace expiry (0ms delay) — DEMO_MODE only. */
export async function triggerDeparture(
  api: ApiClient,
  eventId: number,
  signupId: number,
  discordUserId: string,
) {
  return api.post('/admin/test/trigger-departure', {
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
  return api.post('/admin/test/cancel-signup', { eventId, userId });
}

/** Query a user's notifications — DEMO_MODE only (smoke tests). */
export async function getNotificationsFor(
  api: ApiClient,
  userId: number,
  type?: string,
  limit = 20,
) {
  const params = new URLSearchParams({ userId: String(userId), limit: String(limit) });
  if (type) params.set('type', type);
  return api.get<{ type: string; payload?: Record<string, unknown> }[]>(
    `/admin/test/notifications?${params}`,
  );
}

/** Flush the roster notification buffer immediately — DEMO_MODE only. */
export async function flushNotificationBuffer(api: ApiClient) {
  return api.post<{ flushed: number }>(
    '/admin/test/flush-notification-buffer',
    {},
  );
}

/** Flush voice attendance sessions to the DB — DEMO_MODE only. */
export async function flushVoiceSessions(
  api: ApiClient,
): Promise<void> {
  await api.post('/admin/test/flush-voice-sessions', {});
}

/** Drain the embed sync BullMQ queue — DEMO_MODE only. */
export async function flushEmbedQueue(api: ApiClient): Promise<void> {
  await api.post('/admin/test/flush-embed-queue', {});
}

/** Wait for all BullMQ queues to finish processing — DEMO_MODE only. */
export async function awaitProcessing(
  api: ApiClient,
  timeoutMs = 10_000,
): Promise<void> {
  await api.post('/admin/test/await-processing', { timeoutMs });
}

/** Trigger voice classification for a specific event — DEMO_MODE only (ROK-943). */
export async function triggerClassify(
  api: ApiClient,
  eventId: number,
): Promise<void> {
  await api.post('/admin/test/trigger-classify', { eventId });
}

/** Delete all Discord scheduled events in the guild — prevents 100-event limit (ROK-969). */
export async function cleanupScheduledEvents(api: ApiClient): Promise<void> {
  await api.post('/admin/test/cleanup-scheduled-events', {});
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
  await api.post('/admin/test/inject-voice-session', p);
}
