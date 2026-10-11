/**
 * ROK-1596 D4 + F11: how a copy presents on the user's calendar, shared by
 * every write adapter so Google and the fake cannot drift apart.
 *
 * - confirmed → Busy, plain title
 * - tentative → Free, "(Tentative) <title>"
 * - benched   → Free, "(Bench) <title>" (operator ruling F11, 2026-10-11)
 *
 * Precedence: bench wins over tentative. A tentative player parked on the
 * bench is not going to play unless promoted, which is what "(Bench)" says;
 * both are Free, so only the title differs.
 */
import type { CopyEventInput } from './calendar-provider.interface';

/** Title prefix on tentative copies (spec §4.2; interface `tentative`). */
export const TENTATIVE_TITLE_PREFIX = '(Tentative) ';
/** Title prefix on benched copies (spec §4 F11; interface `benched`). */
export const BENCH_TITLE_PREFIX = '(Bench) ';

type Presentable = Pick<CopyEventInput, 'title' | 'tentative' | 'benched'>;

/** The title the copy carries on the calendar, prefix included. */
export function copySummary(input: Presentable): string {
  if (input.benched) return `${BENCH_TITLE_PREFIX}${input.title}`;
  if (input.tentative) return `${TENTATIVE_TITLE_PREFIX}${input.title}`;
  return input.title;
}

/** Busy only for a confirmed, rostered sign-up; tentative / bench are Free. */
export function copyIsBusy(input: Presentable): boolean {
  return !input.tentative && !input.benched;
}
