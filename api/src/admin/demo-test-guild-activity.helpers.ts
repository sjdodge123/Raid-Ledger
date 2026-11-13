/**
 * ROK-1789 B9 — the optional `withActivity: true` half of the DEMO_MODE
 * `POST /admin/test/wow/seed-guild` fixture: everything the Progression tab's
 * 30-day activity feed reads, relative to the seed's `now` (all UTC):
 *   - the guild and its whole roster backdated to now − 400 days (the
 *     founding import batch, which the feed hides);
 *   - filler rows re-stamped as 4 new members, one 12-row roster import
 *     (Q-B14), a 1/6/12-month milestone each, and 4 same-day 1-month
 *     milestones (grouped, Q-B13);
 *   - two ended guild events in the window + one cancelled one;
 *   - extra boss pulls: Molten Core first kills (map 409) and one Lucifron
 *     kill with no map on a second difficulty ("Other bosses").
 * The pulls are wiped by `seedGuildPulls` first, so a re-seed never doubles.
 */
import {
  buildPullRow,
  DIFFICULTY_40,
  SEED_MC_INSTANCE_ID,
  type PullSpec,
  type SeedPullsInput,
} from './demo-test-guild-pulls.helpers';
import type * as schema from '../drizzle/schema';

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
/** The feed's window (mirrors the contract's GUILD_ACTIVITY_WINDOW_DAYS). */
export const ACTIVITY_WINDOW_MS = 30 * DAY_MS;
export const SHOWCASE_GUILD_AGE_DAYS = 400;
export const SHOWCASE_MC_INSTANCE_ID = SEED_MC_INSTANCE_ID;
/** Classic 20-player difficulty — the "second difficulty" first kill. */
const DIFFICULTY_20 = 148;
const ROSTER_IMPORT_ROWS = 12;
const ROSTER_IMPORT_MIN = 10;

export type MilestoneMonths = 1 | 6 | 12;

export interface ActivityTimeline {
  guildCreatedAt: Date;
  newMemberAts: Date[];
  rosterImportAt: Date;
  milestones: { months: MilestoneMonths; at: Date }[];
  groupedMilestoneAt: Date;
}

export type FillerStampKind =
  | 'new_member'
  | 'roster_import'
  | 'milestone'
  | 'grouped_milestone';

export interface FillerStamp {
  memberId: number;
  kind: FillerStampKind;
  createdAt: Date;
}

export interface ActivityEventSpec {
  title: string;
  start: Date;
  end: Date;
  cancelled: boolean;
}

/** `now` minus whole UTC calendar months, the day clamped to the month's end. */
export function monthsBeforeUtc(now: Date, months: number): Date {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth() - months;
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const out = new Date(now.getTime());
  out.setUTCDate(1);
  out.setUTCFullYear(y, m, Math.min(now.getUTCDate(), lastDay));
  return out;
}

/** Every backdated stamp of the showcase, relative to `now` (pure). */
export function activityTimeline(now: Date): ActivityTimeline {
  const ago = (ms: number): Date => new Date(now.getTime() - ms);
  const milestone = (months: MilestoneMonths) => ({
    months,
    at: new Date(monthsBeforeUtc(now, months).getTime() - 3 * DAY_MS),
  });
  return {
    guildCreatedAt: ago(SHOWCASE_GUILD_AGE_DAYS * DAY_MS),
    newMemberAts: [2, 5, 9, 14].map((d) => ago(d * DAY_MS + 4 * HOUR_MS)),
    rosterImportAt: ago(20 * DAY_MS),
    milestones: [milestone(1), milestone(6), milestone(12)],
    groupedMilestoneAt: new Date(
      monthsBeforeUtc(now, 1).getTime() - 10 * DAY_MS,
    ),
  };
}

/** The stamp slots in priority order; the import only when ≥10 rows remain. */
function stampSlots(
  t: ActivityTimeline,
  available: number,
): Omit<FillerStamp, 'memberId'>[] {
  const fresh = t.newMemberAts.map((createdAt) => ({
    kind: 'new_member' as const,
    createdAt,
  }));
  const singles = t.milestones.map((m) => ({
    kind: 'milestone' as const,
    createdAt: m.at,
  }));
  const grouped = Array.from({ length: 4 }, () => ({
    kind: 'grouped_milestone' as const,
    createdAt: t.groupedMilestoneAt,
  }));
  const head = [...fresh, ...singles, ...grouped];
  const left = Math.min(available - head.length, ROSTER_IMPORT_ROWS);
  if (left < ROSTER_IMPORT_MIN) return head;
  const kind = 'roster_import' as const;
  const imports = Array.from({ length: left }, () => ({
    kind,
    createdAt: t.rosterImportAt,
  }));
  return [...fresh, ...imports, ...singles, ...grouped];
}

/** Assigns filler rows to the stamp slots; unassigned rows stay in the founding batch (pure). */
export function fillerJoinStamps(
  fillerIds: readonly number[],
  t: ActivityTimeline,
): FillerStamp[] {
  const out: FillerStamp[] = [];
  stampSlots(t, fillerIds.length).forEach((slot, i) => {
    const memberId = fillerIds[i];
    if (memberId !== undefined) out.push({ memberId, ...slot });
  });
  return out;
}

/** Two ended guild events inside the window and one cancelled one (pure). */
export function activityEventSpecs(now: Date): ActivityEventSpec[] {
  const spec = (title: string, daysAgo: number, cancelled: boolean) => {
    const end = new Date(now.getTime() - daysAgo * DAY_MS);
    return { title, start: new Date(end.getTime() - 3 * HOUR_MS), end, cancelled };
  };
  return [
    spec('Showcase: Molten Core Clear', 3, false),
    spec('Showcase: Onyxia Night', 10, false),
    spec('Showcase: Cancelled Raid', 6, true),
  ];
}

const ACTIVITY_PULLS: readonly PullSpec[] = [
  { encounterId: 665, name: 'Gehennas', offsetMs: 0, success: true, by: 'gm' },
  {
    encounterId: 666,
    name: 'Garr',
    offsetMs: HOUR_MS,
    success: true,
    by: 'officer',
    difficultyId: DIFFICULTY_40,
  },
  {
    encounterId: 663,
    name: 'Lucifron',
    offsetMs: 7 * DAY_MS,
    success: true,
    by: 'gm',
    difficultyId: DIFFICULTY_20,
    instanceId: null,
  },
];

/** The extra pulls, anchored 12 days before `now` (pure). */
export function activityPullRows(
  input: SeedPullsInput,
): schema.AddonEncounterPullInsert[] {
  const anchor = input.now.getTime() - 12 * DAY_MS;
  return ACTIVITY_PULLS.map((p, i) =>
    buildPullRow(input, p, anchor, `seed-activity-pull:${i}`),
  );
}
