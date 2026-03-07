/**
 * Event reminder query helpers.
 * Extracted from event-reminder.service.ts for file size compliance (ROK-711).
 */
import { and, eq, inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';

/** Character info for a user. */
export interface UserCharacter {
  userId: number;
  name: string;
  charClass: string | null;
  gameId: number;
}

/** Fetch signups grouped by event. */
export async function fetchSignupsByEvent(
  db: PostgresJsDatabase<typeof schema>,
  eventIds: number[],
): Promise<Map<number, number[]>> {
  const signups = await db
    .select({
      eventId: schema.eventSignups.eventId,
      userId: schema.eventSignups.userId,
    })
    .from(schema.eventSignups)
    .where(inArray(schema.eventSignups.eventId, eventIds));
  const map = new Map<number, number[]>();
  for (const signup of signups) {
    if (signup.userId === null) continue;
    if (!map.has(signup.eventId)) map.set(signup.eventId, []);
    map.get(signup.eventId)!.push(signup.userId);
  }
  return map;
}

/** Fetch user discord IDs as a map. */
export async function fetchUserMap(
  db: PostgresJsDatabase<typeof schema>,
  userIds: number[],
): Promise<Map<number, { id: number; discordId: string | null }>> {
  const users = await db
    .select({ id: schema.users.id, discordId: schema.users.discordId })
    .from(schema.users)
    .where(inArray(schema.users.id, userIds));
  return new Map(users.map((u) => [u.id, u]));
}

/** Fetch characters grouped by user. */
export async function fetchCharactersByUser(
  db: PostgresJsDatabase<typeof schema>,
  userIds: number[],
): Promise<Map<number, UserCharacter[]>> {
  if (userIds.length === 0) return new Map();
  const characters = await db
    .select({
      userId: schema.characters.userId,
      name: schema.characters.name,
      charClass: schema.characters.class,
      gameId: schema.characters.gameId,
    })
    .from(schema.characters)
    .where(inArray(schema.characters.userId, userIds));
  const map = new Map<number, UserCharacter[]>();
  for (const char of characters) {
    if (!map.has(char.userId)) map.set(char.userId, []);
    map.get(char.userId)!.push(char);
  }
  return map;
}

/** Fetch user timezones from preferences. */
export async function fetchUserTimezones(
  db: PostgresJsDatabase<typeof schema>,
  userIds?: number[],
): Promise<{ userId: number; timezone: string }[]> {
  const conditions = [eq(schema.userPreferences.key, 'timezone')];
  if (userIds && userIds.length > 0)
    conditions.push(inArray(schema.userPreferences.userId, userIds));
  const rows = await db
    .select({
      userId: schema.userPreferences.userId,
      value: schema.userPreferences.value,
    })
    .from(schema.userPreferences)
    .where(and(...conditions));
  return rows.map((row) => {
    const tz = row.value as string;
    return { userId: row.userId, timezone: tz && tz !== 'auto' ? tz : 'UTC' };
  });
}

/** Build the character display string for a user. */
export function buildCharDisplay(
  charsByUser: Map<number, UserCharacter[]>,
  userId: number,
  gameId: number | null,
): string | null {
  const userChars = charsByUser.get(userId) ?? [];
  const matchingChar = gameId
    ? (userChars.find((c) => c.gameId === gameId) ?? userChars[0])
    : userChars[0];
  if (!matchingChar) return null;
  return `${matchingChar.name}${matchingChar.charClass ? ` (${matchingChar.charClass})` : ''}`;
}

/** Build the reminder message text. */
export function buildReminderMessage(
  eventTitle: string,
  timeStr: string,
  minutesUntil: number,
): string {
  if (minutesUntil <= 1) return `${eventTitle} is starting now!`;
  if (minutesUntil <= 60)
    return `${eventTitle} starts in ${minutesUntil} minutes at ${timeStr}.`;
  const hours = Math.round(minutesUntil / 60);
  if (hours === 1) return `${eventTitle} starts in 1 hour at ${timeStr}.`;
  return `${eventTitle} starts in ${hours} hours at ${timeStr}.`;
}

/** Build the title time label. */
export function buildTitleTimeLabel(minutesUntil: number): string {
  if (minutesUntil <= 1) return 'Now';
  if (minutesUntil <= 60) return `in ${minutesUntil} Minutes`;
  const hours = Math.round(minutesUntil / 60);
  if (hours === 1) return 'in 1 Hour';
  return `in ${hours} Hours`;
}

/** Build the notification payload for a reminder. */
export function buildReminderPayload(input: {
  eventId: number;
  windowType: string;
  characterDisplay: string | null;
  startTime: Date;
  discordUrl?: string | null;
  voiceChannelId?: string | null;
}): Record<string, unknown> {
  return {
    eventId: input.eventId,
    reminderWindow: input.windowType,
    characterDisplay: input.characterDisplay,
    startTime: input.startTime.toISOString(),
    ...(input.discordUrl ? { discordUrl: input.discordUrl } : {}),
    ...(input.voiceChannelId ? { voiceChannelId: input.voiceChannelId } : {}),
  };
}

/** Build reminder message text and title label. */
export function buildReminderStrings(input: {
  title: string;
  startTime: Date;
  minutesUntil: number;
  timezone?: string;
  defaultTimezone?: string;
}): { messageText: string; titleTimeLabel: string } {
  const timezone = input.timezone ?? input.defaultTimezone ?? 'UTC';
  const timeStr = input.startTime.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZoneName: 'short',
    timeZone: timezone,
  });
  return {
    messageText: buildReminderMessage(input.title, timeStr, input.minutesUntil),
    titleTimeLabel: buildTitleTimeLabel(input.minutesUntil),
  };
}
