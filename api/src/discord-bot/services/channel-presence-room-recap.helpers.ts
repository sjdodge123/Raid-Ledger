/**
 * ROK-1499 (layer 1) — summarise what happened in a voice ROOM.
 *
 * The recap render's model was events-only: it described the ad-hoc sessions a
 * presence message spawned, so a room where nobody's group ever cleared the
 * quick-play threshold recapped as "No session started." — even after three
 * people sat in it for three hours playing three different games (prod,
 * 2026-09-13). These helpers answer the question the reader actually has:
 * who was in here, for how long, and what were they playing?
 *
 * Pure arithmetic on intervals: no db, no Nest, no Discord. Layer 2 hydrates
 * the segments from the occupancy table + `game_activity_sessions`; layer 1
 * only has to get the clamping right.
 */

/** One continuous stay in the voice channel. `leftAt: null` = still present. */
export interface OccupancySegment {
  discordUserId: string;
  /** Rendered name — rosters are bold plain text, never `<@id>` mentions. */
  displayName: string;
  joinedAt: Date;
  /** `null` clamps to the instant the room emptied. */
  leftAt: Date | null;
}

/** One continuous run of a game, as Discord presence reported it. */
export interface ActivitySegment {
  discordUserId: string;
  /** The mapped game name when there is one, else `discord_activity_name`. */
  name: string;
  startedAt: Date;
  /** `null` clamps to the instant the room emptied. */
  endedAt: Date | null;
}

/** What the room did between `opened_at` and `empty_since`. */
export interface RoomRecap {
  /** `opened_at` → `empty_since`, ms. */
  spanMs: number;
  /** Distinct humans who were in voice, longest stay first. */
  members: { displayName: string; seconds: number }[];
  /**
   * Per activity name, ROOM seconds — the UNION of the intervals its players
   * were in voice running it — longest first. Empty when nobody's presence
   * produced a game ("no game detected").
   *
   * ROK-1608: this used to be a SUM across members, i.e. player-hours, so a
   * 3h 18m room reported "Baldur's Gate 3 (9h 59m)". A union can never exceed
   * `spanMs`, which is the number the title already shows.
   */
  activities: { name: string; seconds: number }[];
}

/** The window the recap covers. */
export interface RoomSpan {
  openedAt: Date;
  endedAt: Date;
}

interface Interval {
  start: number;
  end: number;
}

interface MemberTally {
  displayName: string;
  intervals: Interval[];
}

/**
 * Clip `[startedAt, endedAt)` to the recap window, treating an open upper
 * bound as "still running when the room emptied".
 *
 * @returns `null` for an interval that lands entirely outside the window (or
 *   collapses to zero length) — it contributes nothing and is dropped.
 */
function clip(
  startedAt: Date,
  endedAt: Date | null,
  span: RoomSpan,
): Interval | null {
  const start = Math.max(startedAt.getTime(), span.openedAt.getTime());
  const end = Math.min(
    (endedAt ?? span.endedAt).getTime(),
    span.endedAt.getTime(),
  );
  return end > start ? { start, end } : null;
}

/** The interval two intervals share; `null` when they never touch. */
function intersect(a: Interval, b: Interval): Interval | null {
  const start = Math.max(a.start, b.start);
  const end = Math.min(a.end, b.end);
  return end > start ? { start, end } : null;
}

/**
 * Total milliseconds covered by `intervals`, counting overlap ONCE.
 *
 * Two people playing the same game side by side for an hour is one hour of
 * room time, not two (ROK-1608).
 */
function unionMs(intervals: Interval[]): number {
  let total = 0;
  let cursor = Number.NEGATIVE_INFINITY;
  for (const interval of [...intervals].sort((a, b) => a.start - b.start)) {
    const start = Math.max(interval.start, cursor);
    if (interval.end <= start) continue;
    total += interval.end - start;
    cursor = interval.end;
  }
  return total;
}

/**
 * How long before the room opened an UNCLOSED session may have started and
 * still be believed.
 *
 * `clip` reads a null `endedAt` as "still running when the room emptied", so a
 * row the bot never closed — it missed the presence update hours or days ago —
 * is credited for the member's entire stay. That is ROK-1608's prod report:
 * five people in voice for 3h 18m and the recap crediting a Baldur's Gate 3
 * session one of them had left open since that afternoon. Nothing in the row
 * distinguishes "leaked" from "genuinely still running", so age decides: a
 * real sitting flows into voice within a few hours of launching the game, and
 * a session older than that with no end instant is not evidence of anything.
 *
 * A session with a real `ended_at` is unaffected — it carries its own bound.
 */
const OPEN_SESSION_GRACE_MS = 3 * 60 * 60 * 1000;

/** An unclosed session that predates the room by more than the grace. */
function isLeakedOpenSegment(
  activity: ActivitySegment,
  span: RoomSpan,
): boolean {
  if (activity.endedAt !== null) return false;
  const floor = span.openedAt.getTime() - OPEN_SESSION_GRACE_MS;
  return activity.startedAt.getTime() < floor;
}

/** Longest first, then by label, so equal durations render deterministically. */
function byDurationDesc<T extends { seconds: number }>(
  label: (item: T) => string,
): (a: T, b: T) => number {
  return (a, b) => b.seconds - a.seconds || label(a).localeCompare(label(b));
}

/**
 * Fold every stay into one tally per human — a member who left and re-joined
 * is ONE person in the room, not two, however many segments they produced.
 */
function tallyMembers(
  occupancy: OccupancySegment[],
  span: RoomSpan,
): Map<string, MemberTally> {
  const tallies = new Map<string, MemberTally>();
  for (const segment of occupancy) {
    const interval = clip(segment.joinedAt, segment.leftAt, span);
    if (!interval) continue;
    const tally = tallies.get(segment.discordUserId) ?? {
      displayName: segment.displayName,
      intervals: [],
    };
    tally.intervals.push(interval);
    tallies.set(segment.discordUserId, tally);
  }
  return tallies;
}

/**
 * Collect, per activity name, every interval it was running while one of its
 * players was actually IN the room — a game running through the 30 minutes
 * someone stepped out is not 30 minutes of room activity.
 *
 * Intervals rather than a running total, because the caller unions them: the
 * same game played by three people at once is one stretch of room time.
 */
function collectActivityIntervals(
  activities: ActivitySegment[],
  members: Map<string, MemberTally>,
  span: RoomSpan,
): Map<string, Interval[]> {
  const byName = new Map<string, Interval[]>();
  for (const activity of activities) {
    const member = members.get(activity.discordUserId);
    if (!member || isLeakedOpenSegment(activity, span)) continue;
    const interval = clip(activity.startedAt, activity.endedAt, span);
    if (!interval) continue;
    const played = member.intervals
      .map((stay) => intersect(interval, stay))
      .filter((slice): slice is Interval => slice !== null);
    if (played.length === 0) continue;
    byName.set(activity.name, [...(byName.get(activity.name) ?? []), ...played]);
  }
  return byName;
}

/**
 * Describe a voice room's session from its occupancy and presence history.
 *
 * @param occupancy - Every stay in the channel; a member may have several.
 * @param activities - Every game run; segments for users with no occupancy are
 *   ignored, each is intersected with that user's stays, and an unclosed one
 *   that predates the room by more than `OPEN_SESSION_GRACE_MS` is dropped as
 *   a leaked row (ROK-1608).
 * @param span - `opened_at` → `empty_since`. Everything clamps to this window,
 *   so an open-ended segment reports the truth rather than a future end time.
 * @returns The room's members and activities, longest first. Every activity
 *   figure is ROOM time, so none of them can exceed `spanMs`.
 */
export function summariseRoom(
  occupancy: OccupancySegment[],
  activities: ActivitySegment[],
  span: RoomSpan,
): RoomRecap {
  const tallies = tallyMembers(occupancy, span);
  return {
    spanMs: Math.max(0, span.endedAt.getTime() - span.openedAt.getTime()),
    members: [...tallies.values()]
      .map((tally) => ({
        displayName: tally.displayName,
        seconds: Math.round(
          tally.intervals.reduce((sum, i) => sum + (i.end - i.start), 0) / 1000,
        ),
      }))
      .sort(byDurationDesc((m) => m.displayName)),
    activities: [...collectActivityIntervals(activities, tallies, span)]
      .map(([name, intervals]) => ({
        name,
        seconds: Math.round(unionMs(intervals) / 1000),
      }))
      .sort(byDurationDesc((a) => a.name)),
  };
}
