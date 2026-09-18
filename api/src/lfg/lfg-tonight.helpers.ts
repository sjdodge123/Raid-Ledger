/**
 * The `tonight` horizon's clock (ROK-1616 R2/AC3).
 *
 * A `tonight` hand lapses at the next 04:00 in the COMMUNITY's wall clock, not
 * at a fixed number of minutes from now and not at 04:00 on whatever zone the
 * container happens to boot in. Two consequences fall out of that and they are
 * the entire reason this file exists:
 *
 *  1. **Before 04:00 still counts as tonight.** A hand raised at 01:00 expires
 *     in three hours, not twenty-seven. Games nights routinely run past
 *     midnight, and a player hearting a game at 1am means *this* session.
 *  2. **The horizon is wall-clock, so its real duration moves with DST.** The
 *     spring-forward night is one real hour shorter and the fall-back night one
 *     real hour longer. That is correct: the player asked for "until the
 *     morning", not "for N hours".
 *
 * There is no `date-fns-tz` in this repo. Zone arithmetic goes through
 * `Intl.DateTimeFormat` + `formatToParts`, which is what
 * {@link zonedHourToUtc} already implements for the overlap read — this module
 * composes those helpers rather than growing a second copy of the offset
 * two-pass.
 */
import {
  nextCalendarDay,
  zonedDayKey,
  zonedHourToUtc,
} from './lfg-zoned-time.helpers';
import { LFG_TONIGHT_EXPIRY_HOUR } from './lfg.constants';

/**
 * A usable IANA zone: the argument when it is one, else the runtime default.
 *
 * A bad `app_settings.default_timezone` (or a null one on a fresh install)
 * must never 500 a player raising a hand — `Intl.DateTimeFormat` throws a
 * `RangeError` on an unknown zone, so the probe is the guard.
 *
 * @param timezone - Candidate IANA zone; may be null, empty or nonsense.
 * @returns A zone `Intl` will accept.
 */
function resolveZone(timezone?: string | null): string {
  const runtime = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (!timezone) return runtime;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return timezone;
  } catch {
    return runtime;
  }
}

/**
 * When a `tonight` hand raised at `from` lapses: the next {@link
 * LFG_TONIGHT_EXPIRY_HOUR} on the community's wall clock, as a UTC instant.
 *
 * Today's 04:00 is taken when it is still ahead of `from` (the 01:00 case),
 * otherwise tomorrow's. The comparison is on INSTANTS, which is what makes
 * both DST edges fall out for free rather than needing a special case:
 *
 *  - **Skipped wall time** (a zone that springs forward across 04:00 — rare,
 *    but Lord Howe and friends do shift at odd hours): `zonedHourToUtc`'s
 *    two-pass resolve yields the earliest valid instant at or after the target
 *    wall time. Deterministic, documented, and never a throw.
 *  - **Ambiguous wall time** (a repeated 04:00): the same two-pass picks one
 *    occurrence deterministically. Either is a defensible "morning", and the
 *    strictly-after-`from` guard below means the answer can never be in the
 *    past whichever it picks.
 *
 * @param from - Instant the hand is raised. Defaults to the current time.
 * @param timezone - Community IANA zone; falls back to the runtime default.
 * @returns The expiry instant, always strictly after `from`.
 */
export function tonightExpiresAt(
  from: Date = new Date(),
  timezone?: string | null,
): Date {
  const zone = resolveZone(timezone);
  const today = zonedDayKey(from, zone);
  const thisMorning = zonedHourToUtc(today, LFG_TONIGHT_EXPIRY_HOUR, zone);
  if (thisMorning.getTime() > from.getTime()) return thisMorning;
  return zonedHourToUtc(nextCalendarDay(today), LFG_TONIGHT_EXPIRY_HOUR, zone);
}
