/**
 * ROK-2311 — lineup and scheduling-poll DMs live under two types now. Specs
 * that read both (`inArray(type, [...])`) pin each row's type by its title so
 * a poll notice that slipped back to `community_lineup` still fails here.
 */
import type { NotificationType } from '../../drizzle/schema/notification-preferences';

/** A lineup's "X is happening!" stays `community_lineup`; every poll DM
 *  ("Auto-signed up", "On the bench", "Scheduling poll result") is
 *  `scheduling_poll`. */
export function expectedLineupDmType(title: string): NotificationType {
  return title.endsWith(' is happening!')
    ? 'community_lineup'
    : 'scheduling_poll';
}

/** Fail, naming the row, when any row's type is not the one its title implies. */
export function expectLineupDmTypes(
  rows: ReadonlyArray<{ title: string; type: string }>,
): void {
  expect(rows.map(({ title, type }) => ({ title, type }))).toEqual(
    rows.map(({ title }) => ({ title, type: expectedLineupDmType(title) })),
  );
}
