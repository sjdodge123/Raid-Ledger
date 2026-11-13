import {
  GUILD_ACTIVITY_MAX,
  GUILD_ACTIVITY_NAMES_MAX,
  GUILD_ACTIVITY_WINDOW_DAYS,
  GUILD_MILESTONE_GROUP_MIN,
  GUILD_ROSTER_IMPORT_MIN,
  type WowGuildActivityEntryDto,
  type WowGuildActivityEntryOf,
  type WowProgressionInstanceDto,
} from '@raid-ledger/contract';
import type { RawDingRow } from '../recent-dings/recent-dings.helpers';

/**
 * ROK-1789 Part B — pure builders for the guild Progression tab's 30-day
 * activity feed (B5–B8, Q-B13/Q-B14/Q-B18). The queries live in
 * `activity.queries.ts`; nothing here touches the database.
 */

type Entry = WowGuildActivityEntryDto;
type MilestoneEntry = WowGuildActivityEntryOf<'milestone'>;

const DAY_MS = 86_400_000;
/** B6: a member created within this long after its guild is from the first import batch. */
export const FIRST_BATCH_SLACK_MS = 10 * 60_000;
/** B8: membership anniversaries (in Raid Ledger) the feed announces. */
export const MILESTONE_MONTHS = [1, 6, 12] as const;
const EVENT_TITLE_MAX = 200;

/** One guild member as `activity.queries.ts` returns it (may repeat per linked character). */
export interface ActivityMemberRow {
  memberId: number;
  characterName: string;
  characterId: string | null;
  className: string | null;
  createdAt: Date;
  guildCreatedAt: Date;
}

/** One ended guild event. */
export interface EndedEventRow {
  id: number;
  title: string;
  endedAt: Date;
}

/** Start of the feed window (B7: last 30 days). */
export function activityWindowStart(now: Date): Date {
  return new Date(now.getTime() - GUILD_ACTIVITY_WINDOW_DAYS * DAY_MS);
}

/** B6: true when the member arrived with the guild's first import batch. */
export function isFirstBatch(
  memberCreatedAt: Date,
  guildCreatedAt: Date,
): boolean {
  return (
    memberCreatedAt.getTime() <= guildCreatedAt.getTime() + FIRST_BATCH_SLACK_MS
  );
}

function inWindow(at: Date, since: Date, now: Date): boolean {
  const t = at.getTime();
  return t >= since.getTime() && t <= now.getTime();
}

function firstPerMember(
  rows: readonly ActivityMemberRow[],
): ActivityMemberRow[] {
  const seen = new Set<number>();
  return rows.filter((r) => !seen.has(r.memberId) && seen.add(r.memberId));
}

function byName(a: ActivityMemberRow, b: ActivityMemberRow): number {
  return (
    a.characterName.localeCompare(b.characterName) || a.memberId - b.memberId
  );
}

function groupBy<T>(
  items: readonly T[],
  key: (t: T) => string,
): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = out.get(k);
    if (list) list.push(item);
    else out.set(k, [item]);
  }
  return out;
}

function namesOf(rows: readonly ActivityMemberRow[]): string[] {
  return [...rows]
    .sort(byName)
    .slice(0, GUILD_ACTIVITY_NAMES_MAX)
    .map((r) => r.characterName);
}

function newMember(r: ActivityMemberRow): Entry {
  return {
    kind: 'new_member',
    id: `join:${r.memberId}`,
    at: r.createdAt.toISOString(),
    characterName: r.characterName,
    characterId: r.characterId,
    className: r.className,
  };
}

/**
 * Joins → feed rows: one per member (first row wins), founding members hidden
 * (B6), and a batch of ≥ `GUILD_ROSTER_IMPORT_MIN` joins sharing one exact
 * `created_at` collapsed into one `roster_import` row (Q-B14).
 */
export function joinEntries(rows: readonly ActivityMemberRow[]): Entry[] {
  const later = firstPerMember(rows).filter(
    (r) => !isFirstBatch(r.createdAt, r.guildCreatedAt),
  );
  const batches = groupBy(later, (r) => r.createdAt.toISOString());
  const out: Entry[] = [];
  for (const [at, batch] of batches) {
    if (batch.length < GUILD_ROSTER_IMPORT_MIN)
      out.push(...batch.map(newMember));
    else
      out.push({
        kind: 'roster_import',
        id: `import:${at}`,
        at,
        count: batch.length,
        names: namesOf(batch),
      });
  }
  return out;
}

/** Calendar-month add in UTC; a missing day clamps to the month's last day (Jan 31 + 1 → Feb 28/29). */
export function addMonthsUtc(d: Date, months: number): Date {
  const out = new Date(d.getTime());
  const day = out.getUTCDate();
  out.setUTCDate(1);
  out.setUTCMonth(out.getUTCMonth() + months);
  const lastDay = new Date(
    Date.UTC(out.getUTCFullYear(), out.getUTCMonth() + 1, 0),
  ).getUTCDate();
  out.setUTCDate(Math.min(day, lastDay));
  return out;
}

interface Anniversary {
  row: ActivityMemberRow;
  months: (typeof MILESTONE_MONTHS)[number];
  at: Date;
}

function anniversaries(
  rows: readonly ActivityMemberRow[],
  since: Date,
  now: Date,
): Anniversary[] {
  return firstPerMember(rows).flatMap((row) =>
    MILESTONE_MONTHS.map((months) => ({
      row,
      months,
      at: addMonthsUtc(row.createdAt, months),
    })).filter((a) => inWindow(a.at, since, now)),
  );
}

function singleMilestone(a: Anniversary): MilestoneEntry {
  const { row, months } = a;
  return {
    kind: 'milestone',
    id: `ms:${row.memberId}:${months}`,
    at: a.at.toISOString(),
    characterName: row.characterName,
    characterId: row.characterId,
    months,
    count: 1,
    names: [row.characterName],
  };
}

function groupedMilestone(
  day: string,
  group: readonly Anniversary[],
): MilestoneEntry[] {
  const lead = [...group].sort((a, b) => byName(a.row, b.row))[0];
  if (lead === undefined) return [];
  const newest = Math.max(...group.map((a) => a.at.getTime()));
  return [
    {
      ...singleMilestone(lead),
      id: `ms:${day}:${lead.months}`,
      at: new Date(newest).toISOString(),
      count: group.length,
      names: namesOf(group.map((a) => a.row)),
    },
  ];
}

/**
 * B8: 1/6/12-month anniversaries of `created_at` that fall in `[since, now]`.
 * ≥ `GUILD_MILESTONE_GROUP_MIN` same-UTC-day, same-months anniversaries
 * become one grouped row, lead (by name) first (Q-B13).
 */
export function milestoneEntries(
  rows: readonly ActivityMemberRow[],
  since: Date,
  now: Date,
): Entry[] {
  const groups = groupBy(
    anniversaries(rows, since, now),
    (a) => `${a.at.toISOString().slice(0, 10)}:${a.months}`,
  );
  const out: Entry[] = [];
  for (const [key, group] of groups) {
    if (group.length < GUILD_MILESTONE_GROUP_MIN)
      out.push(...group.map(singleMilestone));
    else out.push(...groupedMilestone(key.slice(0, 10), group));
  }
  return out;
}

/** First kill per (encounter, difficulty) inside `[since, now]` (Q-B18). */
export function firstKillEntries(
  instances: readonly WowProgressionInstanceDto[],
  since: Date,
  now: Date,
): Entry[] {
  return instances.flatMap((inst) =>
    inst.bosses.flatMap((b): Entry[] =>
      b.firstKillAt !== null && inWindow(new Date(b.firstKillAt), since, now)
        ? [
            {
              kind: 'first_kill',
              id: `kill:${b.encounterId}:${b.difficultyId}`,
              at: b.firstKillAt,
              bossName: b.name,
              difficultyLabel: b.difficultyLabel,
              instanceName: inst.key === 'other' ? null : inst.name,
            },
          ]
        : [],
    ),
  );
}

/** Ended guild events → feed rows (Q-B19: same visibility as the core recent list). */
export function eventEntries(rows: readonly EndedEventRow[]): Entry[] {
  return rows.map((r) => ({
    kind: 'event',
    id: `event:${r.id}`,
    at: r.endedAt.toISOString(),
    eventId: r.id,
    title: r.title.slice(0, EVENT_TITLE_MAX),
  }));
}

/** Level-up rows → feed rows, one per event id (first row wins, as `toDings`). */
export function dingEntries(rows: readonly RawDingRow[]): Entry[] {
  const seen = new Set<number>();
  return rows
    .filter((r) => !seen.has(r.id) && seen.add(r.id))
    .map((r) => ({
      kind: 'ding',
      id: `ding:${r.id}`,
      at: r.occurredAt.toISOString(),
      characterName: r.name,
      characterId: r.characterId,
      toLevel: r.toLevel,
    }));
}

function newestFirst(a: Entry, b: Entry): number {
  const diff = Date.parse(b.at) - Date.parse(a.at);
  if (diff !== 0) return diff;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** All lists → one feed: duplicate ids dropped, `at` desc then `id`, capped at `GUILD_ACTIVITY_MAX`. */
export function mergeActivity(lists: readonly (readonly Entry[])[]): Entry[] {
  const seen = new Set<string>();
  return lists
    .flat()
    .filter((e) => !seen.has(e.id) && seen.add(e.id))
    .sort(newestFirst)
    .slice(0, GUILD_ACTIVITY_MAX);
}
