/**
 * Pure planning for series signups (ROK-1728). No I/O: the service feeds
 * it the series' occurrences and the user's rows and acts on the plan.
 */
import {
  SeriesSignupSchema,
  SignupStatusSchema,
  type SeriesLeaveNightDto,
  type SeriesNightDto,
  type SeriesNightState,
  type SeriesSignupDto,
  type SeriesSignupStateDto,
} from '@raid-ledger/contract';
import type * as schema from '../drizzle/schema';
import { GRACEFUL_DECLINE_HOURS } from './signup-cancel.helpers';

/** Statuses a series join may attach in place (and leave may cancel). */
export const ACTIVE_SIGNUP_STATUSES = ['signed_up', 'tentative'] as const;

/** One occurrence of the series as read from `events`. */
export interface SeriesOccurrence {
  eventId: number;
  startTime: Date;
  cancelledAt: Date | null;
}

/** A future, non-cancelled occurrence at or after the anchor. */
export interface JoinableNight {
  eventId: number;
  startTime: Date;
}

/** The user's signup row on one night. */
export interface UserSeriesRow {
  id: number;
  eventId: number;
  status: string;
  seriesSignupId: number | null;
}

/** D4 buckets, decided before any write. */
export interface ClassifiedNights {
  /** Active + untagged → tag in place. */
  attach: UserSeriesRow[];
  /** No row → create through `SignupsService.signup`. */
  create: JoinableNight[];
  /** Inactive (declined / roached_out / departed / unknown) → never touched. */
  keep: UserSeriesRow[];
  /** Active + already tagged → nothing to do. */
  inSeries: UserSeriesRow[];
  /** Inactive + untagged, cancelled by the user's last leave → sign up again (Q6). */
  revive: UserSeriesRow[];
}

const MS_PER_HOUR = 60 * 60 * 1000;

/**
 * Anchor at the clicked occurrence forward (OQ-9): keeps occurrences with
 * `startTime >= fromStart` (inclusive) AND `startTime > now`, drops cancelled
 * ones, and sorts by start.
 */
export function selectJoinableNights(
  occurrences: SeriesOccurrence[],
  fromStart: Date,
  now: Date,
): JoinableNight[] {
  return occurrences
    .filter((o) => o.cancelledAt === null)
    .filter((o) => o.startTime.getTime() >= fromStart.getTime())
    .filter((o) => o.startTime.getTime() > now.getTime())
    .sort((a, b) => a.startTime.getTime() - b.startTime.getTime())
    .map((o) => ({ eventId: o.eventId, startTime: o.startTime }));
}

/** `true` for `signed_up` / `tentative`. */
function isActiveStatus(status: string): boolean {
  return ACTIVE_SIGNUP_STATUSES.some((s) => s === status);
}

/**
 * Buckets every night (D4). An active row tagged by ANY membership lands in
 * `inSeries`: `attachSignups` only tags untagged rows, so counting a row
 * tagged by another membership as joinable would promise a night the write
 * skips (unreachable under D9, which untags on every end).
 * `membershipId` is accepted for the tabled contract; the bucket does not
 * depend on it for that reason. An inactive, untagged row whose night is in
 * `revivable` (the nights the user's last leave cancelled) lands in `revive`.
 */
export function classifyNights(
  nights: JoinableNight[],
  rows: UserSeriesRow[],
  membershipId?: number,
  revivable: ReadonlySet<number> = new Set(),
): ClassifiedNights {
  void membershipId;
  const byEvent = new Map(rows.map((r) => [r.eventId, r]));
  const out: ClassifiedNights = {
    attach: [],
    create: [],
    keep: [],
    inSeries: [],
    revive: [],
  };
  for (const night of nights) {
    const row = byEvent.get(night.eventId);
    if (row === undefined) out.create.push(night);
    else if (!isActiveStatus(row.status))
      (isRevivable(row, revivable) ? out.revive : out.keep).push(row);
    else if (row.seriesSignupId === null) out.attach.push(row);
    else out.inSeries.push(row);
  }
  return out;
}

/** An inactive row the last leave cancelled and nothing re-tagged since. */
function isRevivable(
  row: UserSeriesRow,
  revivable: ReadonlySet<number>,
): boolean {
  return row.seriesSignupId === null && revivable.has(row.eventId);
}

/** The preview state of one night given its bucket (`revive` → will_create). */
function nightState(eventId: number, c: ClassifiedNights): SeriesNightState {
  if (c.attach.some((r) => r.eventId === eventId)) return 'will_attach';
  if (c.keep.some((r) => r.eventId === eventId)) return 'stays_inactive';
  if (c.inSeries.some((r) => r.eventId === eventId)) return 'in_series';
  return 'will_create';
}

/** The row status narrowed to the contract enum (`null` when no row). */
function rowStatus(
  eventId: number,
  c: ClassifiedNights,
): SeriesNightDto['signupStatus'] {
  const row = [...c.attach, ...c.keep, ...c.inSeries, ...c.revive].find(
    (r) => r.eventId === eventId,
  );
  const parsed = SignupStatusSchema.safeParse(row?.status);
  return parsed.success ? parsed.data : null;
}

/** Builds `SeriesSignupStateDto`; first/last span the joinable nights only. */
export function buildSeriesState(
  nights: JoinableNight[],
  classified: ClassifiedNights,
  membership: typeof schema.seriesSignups.$inferSelect | undefined,
): SeriesSignupStateDto {
  const dtos: SeriesNightDto[] = nights.map((n) => ({
    eventId: n.eventId,
    startTime: n.startTime.toISOString(),
    state: nightState(n.eventId, classified),
    signupStatus: rowStatus(n.eventId, classified),
  }));
  const joinable = dtos.filter(
    (d) => d.state === 'will_create' || d.state === 'will_attach',
  );
  return {
    membership: membership === undefined ? null : toSeriesSignupDto(membership),
    nights: dtos,
    joinableCount: joinable.length,
    firstNight: joinable[0]?.startTime ?? null,
    lastNight: joinable[joinable.length - 1]?.startTime ?? null,
  };
}

/** Tagged future signups → the state's `leaveNights`, earliest first. */
export function toLeaveNights(
  rows: readonly { eventId: number; startTime: Date }[],
): SeriesLeaveNightDto[] {
  return [...rows]
    .sort((a, b) => a.startTime.getTime() - b.startTime.getTime())
    .map((r) => ({ eventId: r.eventId, startTime: r.startTime.toISOString() }));
}

/** Membership row → DTO (Dates → ISO; enum columns validated). */
export function toSeriesSignupDto(
  row: typeof schema.seriesSignups.$inferSelect,
): SeriesSignupDto {
  return SeriesSignupSchema.parse({
    ...row,
    joinedAt: row.joinedAt.toISOString(),
    endedAt: row.endedAt === null ? null : row.endedAt.toISOString(),
  });
}

/** `true` when cancelling now is a late (<23h) cancel — the 23h rule. */
export function isLateCancel(startTime: Date, now: Date): boolean {
  return (
    (startTime.getTime() - now.getTime()) / MS_PER_HOUR < GRACEFUL_DECLINE_HOURS
  );
}
