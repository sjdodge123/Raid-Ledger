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
   * Per activity name, seconds summed across members, longest first. Empty
   * when nobody's presence produced a game ("no game detected").
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
function clip(startedAt: Date, endedAt: Date | null, span: RoomSpan): Interval | null {
  const start = Math.max(startedAt.getTime(), span.openedAt.getTime());
  const end = Math.min(
    (endedAt ?? span.endedAt).getTime(),
    span.endedAt.getTime(),
  );
  return end > start ? { start, end } : null;
}

/** Milliseconds two intervals share; `0` when they never touch. */
function overlapMs(a: Interval, b: Interval): number {
  return Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
}

/** Longest first, then by label, so equal durations render deterministically. */
function byDurationDesc<T extends { seconds: number }>(
  label: (item: T) => string,
): (a: T, b: T) => number {
  return (a, b) =>
    b.seconds - a.seconds || label(a).localeCompare(label(b));
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
 * Sum each activity name across everyone who played it, counting only the time
 * that player was actually IN the room — a game running through the 30 minutes
 * someone stepped out is not 30 minutes of room activity.
 */
function tallyActivities(
  activities: ActivitySegment[],
  members: Map<string, MemberTally>,
  span: RoomSpan,
): Map<string, number> {
  const totals = new Map<string, number>();
  for (const activity of activities) {
    const member = members.get(activity.discordUserId);
    const interval = member
      ? clip(activity.startedAt, activity.endedAt, span)
      : null;
    if (!member || !interval) continue;
    const played = member.intervals.reduce(
      (sum, stay) => sum + overlapMs(interval, stay),
      0,
    );
    if (played > 0) totals.set(activity.name, (totals.get(activity.name) ?? 0) + played);
  }
  return totals;
}

/**
 * Describe a voice room's session from its occupancy and presence history.
 *
 * @param occupancy - Every stay in the channel; a member may have several.
 * @param activities - Every game run; segments for users with no occupancy are
 *   ignored, and each is intersected with that user's stays.
 * @param span - `opened_at` → `empty_since`. Everything clamps to this window,
 *   so an open-ended segment reports the truth rather than a future end time.
 * @returns The room's members and activities, longest first.
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
    activities: [...tallyActivities(activities, tallies, span).entries()]
      .map(([name, ms]) => ({ name, seconds: Math.round(ms / 1000) }))
      .sort(byDurationDesc((a) => a.name)),
  };
}
