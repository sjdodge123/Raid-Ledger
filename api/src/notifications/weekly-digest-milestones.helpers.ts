/**
 * ROK-1771 slice L2 — weekly digest "🏆 Firsts & milestones" data (spec §2
 * table B, §4.1 row 4, rulings Q7/Q8).
 *
 *  - B1 new members: new to Raid Ledger this week AND seen in the guild.
 *  - B3 event milestones: a member's attended-event count crossed 10/25/50.
 *  - B2 first-time games: first activity ever (presence or attended event).
 *  - B4 hour milestones: a game's community hours crossed 100/250/500/1000.
 *
 * Every list is already privacy-filtered (`show_activity = false` members are
 * never named nor counted toward a line) and capped. Names are RAW — the
 * renderer (L5) escapes, sanitises and bolds them. Each list is empty when its
 * data source has nothing (presence tracking off → B4 and B2's presence half
 * are simply empty; nothing throws).
 */
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../drizzle/schema';
import {
  buildEventMilestonesQuery,
  buildFirstGamesQuery,
  buildHourMilestonesQuery,
  buildNewMembersQuery,
} from './weekly-digest-milestones-sql.helpers';

/** Attended-event milestones (Q8 ruling 2026-10-12). Ascending. */
export const EVENT_MILESTONE_THRESHOLDS: readonly number[] = [10, 25, 50];
/** Community-hour milestones per game (Q8 ruling 2026-10-12). Ascending. */
export const HOUR_MILESTONE_THRESHOLDS: readonly number[] = [
  100, 250, 500, 1000,
];
/** Max items per list — the rendered field holds 5 lines in total (§4.1). */
export const MILESTONE_LIST_CAP = 5;
/** Max new-member names on the collapsed welcome line; `total` keeps the count. */
export const NEW_MEMBER_NAME_CAP = 5;

const SECONDS_PER_HOUR = 3600;

/** B1 — one collapsed line: "Welcome **A**, **B** and **C** (3 new members)". */
export interface DigestNewMembers {
  /** Display names to bold, oldest account first, at most NEW_MEMBER_NAME_CAP. */
  names: string[];
  /** Every qualifying new member, including those beyond the name cap. */
  total: number;
}

/** B3 — "**Kael** reached **25** events". Bold: `name`, `threshold`. */
export interface DigestEventMilestone {
  userId: number;
  name: string;
  /** The highest threshold crossed this week (only one line per member). */
  threshold: number;
}

/** B2 — "First time the community played **Valheim**". Bold: `name`. */
export interface DigestFirstGame {
  gameId: number;
  name: string;
}

/** B4 — "**Deep Rock Galactic** passed **250** community hours". Bold: `name`, `threshold`. */
export interface DigestHourMilestone {
  gameId: number;
  name: string;
  /** The highest hour threshold crossed this week. */
  threshold: number;
}

/**
 * The whole section. Render priority (§4.1): newMembers → eventMilestones →
 * firstGames → hourMilestones, 5 lines total, hidden when `isEmptyDigestMilestones`.
 */
export interface DigestMilestones {
  newMembers: DigestNewMembers;
  eventMilestones: DigestEventMilestone[];
  firstGames: DigestFirstGame[];
  hourMilestones: DigestHourMilestone[];
}

type Numeric = number | string | null | undefined;

export type NewMemberRow = { user_id: Numeric; name: string | null };
export type EventMilestoneRow = {
  user_id: Numeric;
  name: string | null;
  before_count: Numeric;
  through_count: Numeric;
};
export type FirstGameRow = { game_id: Numeric; name: string | null };
export type HourMilestoneRow = {
  game_id: Numeric;
  name: string | null;
  seconds_before: Numeric;
  seconds_through: Numeric;
};

/** Coerce a pg aggregate (bigint arrives as text) to a finite number ≥ 0. */
function toNumber(value: Numeric): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Positive integer id, or null for junk. */
function toId(value: Numeric): number | null {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * The highest threshold `t` with `before < t <= through`, or null when the
 * window crossed none. 9→10 gives 10, 10→11 gives null, 9→26 gives 25.
 */
export function crossedThreshold(
  before: number,
  through: number,
  thresholds: readonly number[],
): number | null {
  let crossed: number | null = null;
  for (const t of thresholds) {
    if (before < t && t <= through) crossed = t;
  }
  return crossed;
}

/** Biggest milestone first, then name — the most notable line leads. */
function byThresholdThenName<T extends { threshold: number; name: string }>(
  a: T,
  b: T,
): number {
  return b.threshold - a.threshold || a.name.localeCompare(b.name);
}

export function shapeNewMembers(
  rows: readonly NewMemberRow[],
): DigestNewMembers {
  const named = rows.filter((r) => toId(r.user_id) !== null && r.name);
  return {
    names: named.slice(0, NEW_MEMBER_NAME_CAP).map((r) => r.name ?? ''),
    total: named.length,
  };
}

export function shapeEventMilestones(
  rows: readonly EventMilestoneRow[],
): DigestEventMilestone[] {
  const out: DigestEventMilestone[] = [];
  for (const r of rows) {
    const userId = toId(r.user_id);
    const threshold = crossedThreshold(
      toNumber(r.before_count),
      toNumber(r.through_count),
      EVENT_MILESTONE_THRESHOLDS,
    );
    if (userId === null || !r.name || threshold === null) continue;
    out.push({ userId, name: r.name, threshold });
  }
  return out.sort(byThresholdThenName).slice(0, MILESTONE_LIST_CAP);
}

export function shapeFirstGames(
  rows: readonly FirstGameRow[],
): DigestFirstGame[] {
  const out: DigestFirstGame[] = [];
  for (const r of rows) {
    const gameId = toId(r.game_id);
    if (gameId !== null && r.name) out.push({ gameId, name: r.name });
  }
  return out.slice(0, MILESTONE_LIST_CAP);
}

export function shapeHourMilestones(
  rows: readonly HourMilestoneRow[],
): DigestHourMilestone[] {
  const out: DigestHourMilestone[] = [];
  for (const r of rows) {
    const gameId = toId(r.game_id);
    const threshold = crossedThreshold(
      toNumber(r.seconds_before) / SECONDS_PER_HOUR,
      toNumber(r.seconds_through) / SECONDS_PER_HOUR,
      HOUR_MILESTONE_THRESHOLDS,
    );
    if (gameId === null || !r.name || threshold === null) continue;
    out.push({ gameId, name: r.name, threshold });
  }
  return out.sort(byThresholdThenName).slice(0, MILESTONE_LIST_CAP);
}

/** An all-empty section — what the digest gets when nothing happened. */
export function emptyDigestMilestones(): DigestMilestones {
  return {
    newMembers: { names: [], total: 0 },
    eventMilestones: [],
    firstGames: [],
    hourMilestones: [],
  };
}

/** True when the section has no line to render (L5 omits the field). */
export function isEmptyDigestMilestones(m: DigestMilestones): boolean {
  return (
    m.newMembers.total === 0 &&
    m.eventMilestones.length === 0 &&
    m.firstGames.length === 0 &&
    m.hourMilestones.length === 0
  );
}

/** Lowest threshold of a non-empty ascending list (0 when empty). */
function lowest(thresholds: readonly number[]): number {
  return thresholds[0] ?? 0;
}

/** Run the four reads against the live database and shape the section. */
export async function fetchDigestMilestones(
  db: PostgresJsDatabase<typeof schema>,
): Promise<DigestMilestones> {
  const minSeconds = lowest(HOUR_MILESTONE_THRESHOLDS) * SECONDS_PER_HOUR;
  const [members, events, games, hours] = await Promise.all([
    db.execute<NewMemberRow>(buildNewMembersQuery()),
    db.execute<EventMilestoneRow>(
      buildEventMilestonesQuery(lowest(EVENT_MILESTONE_THRESHOLDS)),
    ),
    db.execute<FirstGameRow>(buildFirstGamesQuery()),
    db.execute<HourMilestoneRow>(buildHourMilestonesQuery(minSeconds)),
  ]);
  return {
    newMembers: shapeNewMembers(Array.from(members)),
    eventMilestones: shapeEventMilestones(Array.from(events)),
    firstGames: shapeFirstGames(Array.from(games)),
    hourMilestones: shapeHourMilestones(Array.from(hours)),
  };
}
