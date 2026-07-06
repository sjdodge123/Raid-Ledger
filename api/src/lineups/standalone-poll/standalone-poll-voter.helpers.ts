/**
 * Voter split helper for standalone poll auto-signup (ROK-1031).
 * Separates voters into those who voted for the selected slot
 * vs those who voted for other slots.
 */
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../../drizzle/schema';
import type { SettingsService } from '../../settings/settings.service';
import type { StandalonePollNotificationService } from './standalone-poll-notification.service';
import { resolveUserTimezones } from '../../notifications/timezone.helpers';

/** No-op rejection swallower for fire-and-forget DMs. */
const noop = (): void => {};

/** Split voters into selected-slot voters and other-slot voters. */
export function splitVotersBySlot<T extends { userId: number; slotId: number }>(
  slots: { id: number; proposedTime: Date }[],
  allVoters: T[],
  startTime?: string,
): { selectedVoters: T[]; otherVoters: T[] } {
  if (!startTime) return { selectedVoters: allVoters, otherVoters: [] };
  const selectedSlot = slots.find(
    (s) => new Date(s.proposedTime).getTime() === new Date(startTime).getTime(),
  );
  if (!selectedSlot) return { selectedVoters: allVoters, otherVoters: [] };
  const selectedVoters = allVoters.filter((v) => v.slotId === selectedSlot.id);
  const selectedIds = new Set(selectedVoters.map((v) => v.userId));
  const otherVoters = allVoters.filter(
    (v) => v.slotId !== selectedSlot.id && !selectedIds.has(v.userId),
  );
  return { selectedVoters, otherVoters };
}

/**
 * Format a time for DM display in the recipient's timezone (ROK-1112).
 * `timeZone` is an IANA string (recipient pref → guild default → 'UTC').
 */
export function formatPollTime(isoTime: string, timeZone: string): string {
  return new Date(isoTime).toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone,
  });
}

/** Dependencies for {@link notifyPollVoters}. */
export interface NotifyPollVotersDeps {
  db: PostgresJsDatabase<typeof schema>;
  settingsService: SettingsService;
  notifications: StandalonePollNotificationService;
}

/**
 * Fire-and-forget DMs to all poll voters (ROK-1031). The chosen time is
 * formatted PER RECIPIENT in their own timezone (ROK-1112) — preference →
 * guild default → 'UTC' — so a 9 PM EDT slot never renders as next-day UTC.
 */
export async function notifyPollVoters(
  deps: NotifyPollVotersDeps,
  selected: { userId: number }[],
  others: { userId: number }[],
  chosenTime: string,
  eventId: number,
  gameName: string,
): Promise<void> {
  const guildDefault =
    (await deps.settingsService.getDefaultTimezone()) ?? 'UTC';
  const selectedIds = [...new Set(selected.map((v) => v.userId))];
  const otherIds = [...new Set(others.map((v) => v.userId))];
  // One batch query for every recipient's timezone — no per-voter N+1.
  const tz = await resolveUserTimezones(
    deps.db,
    [...selectedIds, ...otherIds],
    guildDefault,
  );
  for (const uid of selectedIds) {
    const at = formatPollTime(chosenTime, tz.get(uid) ?? guildDefault);
    deps.notifications.notifyAutoSignup(uid, gameName, at, eventId).catch(noop);
  }
  for (const uid of otherIds) {
    const at = formatPollTime(chosenTime, tz.get(uid) ?? guildDefault);
    deps.notifications.notifyPollOutcome(uid, at, eventId).catch(noop);
  }
}
