/**
 * Support demo data generators: game time, availability, notifications, preferences, interests.
 */
import type { Rng } from './demo-data-rng';
import { pick, pickN, randInt, weightedPick } from './demo-data-rng';
import {
  IGDB_GAME_WEIGHTS,
  ARCHETYPES,
  NOTIFICATION_TEMPLATES,
} from './demo-data-generator-templates';
import type {
  GeneratedEvent,
  GeneratedGameTime,
  GeneratedAvailability,
  GeneratedNotification,
  GeneratedNotifPreference,
  GeneratedGameInterest,
} from './demo-data-generator-types';

/** Expand a time slot into individual hour entries, handling midnight wrap. */
function expandSlot(
  username: string,
  day: number,
  startHour: number,
  endHour: number,
): GeneratedGameTime[] {
  const slots: GeneratedGameTime[] = [];
  const effectiveEnd = endHour === 0 ? 24 : endHour;
  if (effectiveEnd > startHour) {
    for (let h = startHour; h < effectiveEnd; h++) {
      slots.push({ username, dayOfWeek: day, startHour: h });
    }
  } else {
    for (let h = startHour; h < 24; h++) {
      slots.push({ username, dayOfWeek: day, startHour: h });
    }
    const nextDay = (day + 1) % 7;
    for (let h = 0; h < endHour; h++) {
      slots.push({ username, dayOfWeek: nextDay, startHour: h });
    }
  }
  return slots;
}

/** Generate game time preferences for all users. */
export function generateGameTime(
  rng: Rng,
  usernames: string[],
): GeneratedGameTime[] {
  const slots: GeneratedGameTime[] = [];
  const archetypeWeights = ARCHETYPES.map((a) => a.weight);
  const weekdays = [0, 1, 2, 3, 4];
  const weekends = [5, 6];
  for (const username of usernames) {
    const archetype = weightedPick(rng, ARCHETYPES, archetypeWeights);
    const selectedWeekdays = pickN(rng, weekdays, randInt(rng, 2, 5));
    const selectedWeekends = pickN(rng, weekends, randInt(rng, 1, 2));
    for (const day of selectedWeekdays) {
      for (const slot of archetype.weekdaySlots) {
        slots.push(...expandSlot(username, day, slot.start, slot.end));
      }
    }
    for (const day of selectedWeekends) {
      for (const slot of archetype.weekendSlots) {
        slots.push(...expandSlot(username, day, slot.start, slot.end));
      }
    }
  }
  return slots;
}

/** Generate availability blocks for all users. */
export function generateAvailability(
  rng: Rng,
  usernames: string[],
  baseTime: Date,
): GeneratedAvailability[] {
  const blocks: GeneratedAvailability[] = [];
  const baseHour = new Date(baseTime);
  baseHour.setMinutes(0, 0, 0);
  const hoursFromBase = (hours: number) =>
    new Date(baseHour.getTime() + hours * 60 * 60 * 1000);
  for (const username of usernames) {
    const numBlocks = randInt(rng, 2, 4);
    for (let i = 0; i < numBlocks; i++) {
      const offsetHours = randInt(rng, -48, 168);
      const durationHours = randInt(rng, 2, 8);
      blocks.push({
        username,
        start: hoursFromBase(offsetHours),
        end: hoursFromBase(offsetHours + durationHours),
        status: rng() < 0.7 ? 'available' : 'blocked',
      });
    }
  }
  return blocks;
}

/** Build a notification message from a template. */
function buildNotifMessage(
  rng: Rng,
  tmpl: (typeof NOTIFICATION_TEMPLATES)[number],
  event: GeneratedEvent,
  usernames: string[],
): string {
  const gameName =
    IGDB_GAME_WEIGHTS.find((g) => g.igdbId === event.igdbId)?.name ??
    event.igdbId;
  const roles = ['Tank', 'Healer', 'DPS'];
  return tmpl.messageTemplate
    .replace('{event}', event.title)
    .replace('{role}', pick(rng, roles))
    .replace('{creator}', pick(rng, usernames))
    .replace('{game}', gameName);
}

/** Generate notifications for all users. */
export function generateNotifications(
  rng: Rng,
  usernames: string[],
  events: GeneratedEvent[],
  baseTime: Date,
): GeneratedNotification[] {
  const notifications: GeneratedNotification[] = [];
  while (notifications.length < 300) {
    const username = pick(rng, usernames);
    const tmpl = pick(rng, NOTIFICATION_TEMPLATES);
    const event = pick(rng, events);
    const hoursAgo = randInt(rng, 1, 168);
    const createdAt = new Date(baseTime.getTime() - hoursAgo * 60 * 60 * 1000);
    const isRead = rng() < 0.4;
    const readAt = isRead
      ? new Date(createdAt.getTime() + randInt(rng, 1, 24) * 60 * 60 * 1000)
      : null;
    notifications.push({
      username,
      type: tmpl.type,
      title: tmpl.title,
      message: buildNotifMessage(rng, tmpl, event, usernames),
      payload: { eventTitle: event.title },
      createdAt,
      readAt,
    });
  }
  return notifications;
}

/** Generate notification channel preferences. */
export function generateNotifPreferences(
  rng: Rng,
  usernames: string[],
): GeneratedNotifPreference[] {
  const types = [
    'slot_vacated',
    'event_reminder',
    'new_event',
    'subscribed_game',
    'achievement_unlocked',
    'level_up',
    'missed_event_nudge',
  ];
  const channels = ['inApp', 'push', 'discord'];
  return usernames.map((username) => {
    const channelPrefs: Record<string, Record<string, boolean>> = {};
    for (const type of types) {
      channelPrefs[type] = {};
      for (const ch of channels) {
        channelPrefs[type][ch] = ch === 'inApp' ? rng() < 0.95 : rng() < 0.6;
      }
    }
    return { username, channelPrefs };
  });
}

/** Generate game interest subscriptions. */
export function generateGameInterests(
  rng: Rng,
  usernames: string[],
  allIgdbIds: number[],
): GeneratedGameInterest[] {
  const interests: GeneratedGameInterest[] = [];
  for (const username of usernames) {
    const selected = pickN(rng, allIgdbIds, randInt(rng, 2, 7));
    for (const igdbId of selected) {
      interests.push({ username, igdbId });
    }
  }
  return interests;
}

/** Collect all unique notification titles produced by the generator. */
export function getAllNotificationTitles(): string[] {
  return [...new Set(NOTIFICATION_TEMPLATES.map((t) => t.title))];
}
