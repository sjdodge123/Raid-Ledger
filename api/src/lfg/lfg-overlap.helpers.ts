/**
 * Pure window arithmetic for `GET /lfg/:gameId/overlap` (ROK-1463 §A).
 *
 * Nothing here touches the database. The caller resolves the recurring
 * game-time grid (templates + overrides + absences) and the tsrange
 * `availability` rows into `Map<userId, Set<hourStartIso>>` — ONE entry per
 * live member, whose set may be empty — and these helpers do the set
 * arithmetic on top. Keeping the two apart is what makes the ranking rules
 * unit-testable without a fixture per case.
 */
import { LFG_OVERLAP_WINDOWS } from './lfg.constants';

/** Milliseconds in one hour slot. */
const HOUR_MS = 60 * 60 * 1000;

/** One candidate hour and the members who hold it. */
export interface OverlapHour {
  /** ISO instant of the hour's start. */
  start: string;
  /** Member ids free that hour, ascending. */
  members: number[];
}

/** A contiguous run of hours the same members all share. */
export interface OverlapWindow {
  start: string;
  end: string;
  availableCount: number;
  totalCount: number;
  members: number[];
}

/** Per-member hour sets, keyed by user id. */
export type MemberSlots = Map<number, Set<string>>;

/**
 * Invert the per-member slot sets into per-hour member lists.
 *
 * @param memberSlots - One entry per live member; an empty set contributes no
 *   hours but still counts towards the roster size elsewhere.
 * @returns Hour start -> ascending member ids. Hours nobody holds are absent.
 */
export function computeHourCoverage(
  memberSlots: MemberSlots,
): Map<string, number[]> {
  const coverage = new Map<string, number[]>();
  for (const [userId, hours] of memberSlots) {
    for (const hour of hours) {
      const holders = coverage.get(hour);
      if (holders) holders.push(userId);
      else coverage.set(hour, [userId]);
    }
  }
  for (const holders of coverage.values()) holders.sort((a, b) => a - b);
  return coverage;
}

/**
 * Pick the hours worth offering: every hour the WHOLE roster shares, or — when
 * no such hour exists — every hour at the single best coverage of two or more.
 *
 * The fallback never mixes coverage levels: a 3-of-4 hour outranks a 2-of-4
 * one outright, so the group is never shown a thinner window alongside a
 * fuller one.
 *
 * @param memberSlots - One entry per live member (see {@link MemberSlots}).
 * @returns Candidate hours, ascending by start. Empty below two members.
 */
export function selectOverlapHours(memberSlots: MemberSlots): OverlapHour[] {
  const total = memberSlots.size;
  if (total < 2) return [];
  const coverage = computeHourCoverage(memberSlots);
  let best = 0;
  for (const holders of coverage.values()) {
    if (holders.length > best) best = holders.length;
  }
  const target = coverage.size > 0 && best === total ? total : best;
  if (target < 2) return [];
  return [...coverage.entries()]
    .filter(([, holders]) => holders.length === target)
    .map(([start, members]) => ({ start, members }))
    .sort((l, r) => Date.parse(l.start) - Date.parse(r.start));
}

/** Same run? Only when the hours are adjacent AND held by the same members. */
function continues(prev: OverlapHour, next: OverlapHour): boolean {
  if (Date.parse(next.start) - Date.parse(prev.start) !== HOUR_MS) return false;
  return (
    prev.members.length === next.members.length &&
    prev.members.every((id, i) => id === next.members[i])
  );
}

/** Close a run of hours into a window ending one hour after its last slot. */
function toWindow(run: OverlapHour[], totalCount: number): OverlapWindow {
  const first = run[0];
  const last = run[run.length - 1];
  return {
    start: first.start,
    end: new Date(Date.parse(last.start) + HOUR_MS).toISOString(),
    availableCount: first.members.length,
    totalCount,
    members: [...first.members],
  };
}

/**
 * Group consecutive candidate hours into windows.
 *
 * A gap splits, and so does a change of member set — merging two adjacent
 * hours held by DIFFERENT pairs would advertise a window nobody can all
 * attend, which is a real case on the fallback path.
 *
 * @param hours - Candidate hours, ascending (as {@link selectOverlapHours} returns).
 * @param totalCount - Live roster size, carried onto every window.
 */
export function groupIntoWindows(
  hours: OverlapHour[],
  totalCount: number,
): OverlapWindow[] {
  const windows: OverlapWindow[] = [];
  let run: OverlapHour[] = [];
  for (const hour of hours) {
    if (run.length > 0 && !continues(run[run.length - 1], hour)) {
      windows.push(toWindow(run, totalCount));
      run = [];
    }
    run.push(hour);
  }
  if (run.length > 0) windows.push(toWindow(run, totalCount));
  return windows;
}

/**
 * Rank windows by coverage desc, then length desc, then start asc, and cap.
 *
 * @param windows - Candidates. Never mutated.
 * @param limit - Maximum windows to return.
 */
export function rankWindows(
  windows: OverlapWindow[],
  limit: number,
): OverlapWindow[] {
  const length = (w: OverlapWindow): number =>
    Date.parse(w.end) - Date.parse(w.start);
  return [...windows]
    .sort(
      (l, r) =>
        r.availableCount - l.availableCount ||
        length(r) - length(l) ||
        Date.parse(l.start) - Date.parse(r.start),
    )
    .slice(0, limit);
}

/**
 * Full pipeline: coverage -> selection -> grouping -> ranking -> cap.
 *
 * @param memberSlots - One entry per live member, empty set included.
 * @param limit - Window cap. Defaults to {@link LFG_OVERLAP_WINDOWS}.
 */
export function computeOverlapWindows(
  memberSlots: MemberSlots,
  limit: number = LFG_OVERLAP_WINDOWS,
): OverlapWindow[] {
  const hours = selectOverlapHours(memberSlots);
  return rankWindows(groupIntoWindows(hours, memberSlots.size), limit);
}
