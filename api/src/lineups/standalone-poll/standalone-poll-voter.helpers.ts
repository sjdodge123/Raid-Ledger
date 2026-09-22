/**
 * Voter split helper for standalone poll auto-signup (ROK-1031).
 * Separates voters into those who voted for the selected slot
 * vs those who voted for other slots.
 */
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import type { SettingsService } from '../../settings/settings.service';
import type { StandalonePollNotificationService } from './standalone-poll-notification.service';
import { resolveUserTimezones } from '../../notifications/timezone.helpers';
import { insertPollInterests } from '../scheduling/scheduling-auto-heart.helpers';
import { yesVotesOnly } from '../scheduling/scheduling-stance.helpers';

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
 * {@link splitVotersBySlot} over the YES votes only (ROK-1617).
 *
 * Both halves of the split act on the member's behalf: `selectedVoters` are
 * auto-signed-up to the locked-in event, and `otherVoters` get the "you voted
 * for another time" DM. An anti-vote is neither — a member whose only answer
 * was `no` picked no time at all, so telling them they voted for another one
 * is a lie and rostering them onto the one they rejected is the inversion
 * ROK-1617 exists to stop. They deliberately receive NOTHING from this path;
 * the event announcement still reaches them like any other lineup member.
 *
 * @param slots - The match's schedule slots.
 * @param allVoters - Every vote row, in any stance mix.
 * @param startTime - The locked-in start time, when one was chosen.
 * @returns The yes-voters split into selected-slot and other-slot audiences.
 */
export function splitYesVotersBySlot<
  T extends { userId: number; slotId: number; stance?: 'yes' | 'no' | null },
>(
  slots: { id: number; proposedTime: Date }[],
  allVoters: T[],
  startTime?: string,
): { selectedVoters: T[]; otherVoters: T[] } {
  return splitVotersBySlot(slots, yesVotesOnly(allVoters), startTime);
}

/**
 * The members a standalone poll auto-hearts the game for (ROK-1617 item E).
 *
 * Operator ruling 2026-09-20: only a member who said YES to a time. A member
 * whose only answer was "doesn't work" asked for nothing, so writing a heart
 * onto their profile is the same inversion the lock-in path already refuses
 * (`scheduling-event.helpers.ts` → `yesVotesOnly` → `fireAutoHeartForVoters`).
 * The rule is imported, never re-derived: one definition of "yes-voter".
 *
 * The heart is on the GAME, so a member who said yes to any slot qualifies
 * (yes on one time and no on another is still a yes), and the set is
 * deduplicated — one heart per member no matter how many slots they picked.
 *
 * @param allVoters - Every vote row for the poll's slots, in any stance mix.
 * @returns Deduplicated user ids of the yes-voters, in first-vote order.
 */
export function pollHeartRecipientIds(
  allVoters: readonly { userId: number; stance?: 'yes' | 'no' | null }[],
): number[] {
  return [...new Set(yesVotesOnly(allVoters).map((v) => v.userId))];
}

/**
 * Heart the poll's game for its yes-voters and report the game's name.
 *
 * Extracted from `StandalonePollService.fireAutoSignup` (behaviour-neutral) so
 * the service stays inside the 300-line cap. It belongs next to
 * {@link pollHeartRecipientIds}: the rule for WHO gets a heart and the write
 * that applies it are one decision, and a caller cannot reach the write
 * without going through the rule. The game name comes back because the same
 * row feeds the lock-in DMs.
 *
 * A poll whose match row or game is gone hearts nobody and yields null — the
 * caller falls back to a generic name rather than failing the lock-in.
 *
 * @param db - Drizzle database handle.
 * @param matchId - The poll's match id.
 * @param allVoters - Every vote row for the poll's slots, in any stance mix.
 * @returns The game's name, or null when the match/game row is missing.
 */
export async function heartPollGameForVoters(
  db: PostgresJsDatabase<typeof schema>,
  matchId: number,
  allVoters: readonly { userId: number; stance?: 'yes' | 'no' | null }[],
): Promise<string | null> {
  const [match] = await db
    .select({
      gameId: schema.communityLineupMatches.gameId,
      gameName: schema.games.name,
    })
    .from(schema.communityLineupMatches)
    .innerJoin(
      schema.games,
      eq(schema.games.id, schema.communityLineupMatches.gameId),
    )
    .where(eq(schema.communityLineupMatches.id, matchId))
    .limit(1);
  if (!match?.gameId) return null;
  // ROK-1617 (item E, operator ruling 2026-09-20 "The yes voter"): the heart
  // is on the GAME rather than the time, but only a member who said YES to
  // some time asked for anything — a `no`-only answer must not write a heart
  // onto their profile. Same rule as the lock-in path.
  await insertPollInterests({
    db,
    gameId: match.gameId,
    voterUserIds: pollHeartRecipientIds(allVoters),
  });
  return match.gameName ?? null;
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
