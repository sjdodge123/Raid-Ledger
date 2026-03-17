import type { ApiClient } from './api.js';
import type { DiscordChannel } from './types.js';

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
    config?: Record<string, unknown>;
  },
) {
  const res = await api.post<{ data: { id: string } }>(
    '/admin/discord/bindings',
    {
      channelId: opts.channelId,
      channelType: opts.channelType,
      bindingPurpose: opts.purpose,
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
  return api.patch(`/events/${eventId}`, {
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
  return api.post('/admin/settings/demo/link-discord', {
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
  return api.post('/admin/settings/demo/signup', {
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

export async function deleteEvent(api: ApiClient, eventId: number) {
  return api.delete(`/events/${eventId}`).catch(() => {});
}

export async function deleteBinding(api: ApiClient, bindingId: string) {
  return api.delete(`/admin/discord/bindings/${bindingId}`).catch(() => {});
}

export function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
