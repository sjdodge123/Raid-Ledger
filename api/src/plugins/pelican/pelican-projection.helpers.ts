/**
 * Pure projection of stored Pelican schedules into calendar windows and
 * markers (ROK-1096 §4). No DB, no Nest — the provider feeds it rows.
 */
import {
  GameServerEffectSchema,
  isValidIanaTimezone,
  type GameServerCalendarItemDto,
  type GameServerEffect,
} from '@raid-ledger/contract';
import type { PelicanScheduleRow } from '../../drizzle/schema';
import {
  PELICAN_PROJECTION_CAP,
  PELICAN_PROVIDER_LABEL,
} from './pelican.constants';
import { redactScheduleLabel, redactServerName } from './pelican-name.helpers';
import {
  expandBetween,
  nextAtOrAfter,
  prevBefore,
  toCronExpression,
} from './pelican-schedule-cron.helpers';
import { hasTzMismatch } from './pelican-tz-check.helpers';
import {
  compareEvents,
  compareSpans,
  overlapsRange,
  pairEvents,
  toCalendarItem,
  type ProjectionEvent,
  type ProjectionServerBase,
} from './pelican-projection-pairing.helpers';

export interface ProjectionSchedule extends Pick<
  PelicanScheduleRow,
  | 'id'
  | 'serverId'
  | 'name'
  | 'cronMinute'
  | 'cronHour'
  | 'cronDayOfMonth'
  | 'cronMonth'
  | 'cronDayOfWeek'
  | 'isActive'
  | 'nextRunAt'
  | 'effect'
  | 'effectOffsetS'
> {
  gameId: number;
  /** Raw panel name — redacted here before it reaches an item. */
  serverName: string;
  serverTimezone: string | null;
}

export interface ProjectionRange {
  from: Date;
  to: Date;
}

export interface ProjectionInput {
  schedules: readonly ProjectionSchedule[];
  defaultTimezone: string;
  range: ProjectionRange;
  gameIds?: readonly number[];
}

export type ProjectionSkipReason = 'bad_tz' | 'bad_cron' | 'bad_effect';

export interface ProjectionSkip {
  serverId: number;
  scheduleId?: number;
  reason: ProjectionSkipReason;
}

export interface ProjectionResult {
  items: GameServerCalendarItemDto[];
  truncatedServerIds: number[];
  tzMismatchServerIds: number[];
  skipped: ProjectionSkip[];
}

const isStop = (e: GameServerEffect): boolean => e === 'stop' || e === 'kill';

/** Active schedules (optionally only `gameIds`) → items, per server (D14). */
export function projectSchedules(input: ProjectionInput): ProjectionResult {
  const result: ProjectionResult = {
    items: [],
    truncatedServerIds: [],
    tzMismatchServerIds: [],
    skipped: [],
  };
  const { gameIds } = input;
  const groups = new Map<number, ProjectionSchedule[]>();
  for (const s of input.schedules) {
    if (!s.isActive || (gameIds !== undefined && !gameIds.includes(s.gameId)))
      continue;
    groups.set(s.serverId, [...(groups.get(s.serverId) ?? []), s]);
  }
  const serverIds = [...groups.keys()].sort((a, b) => a - b);
  for (const id of serverIds)
    projectServer(id, groups.get(id) ?? [], input, result);
  return result;
}

function projectServer(
  serverId: number,
  group: readonly ProjectionSchedule[],
  input: ProjectionInput,
  result: ProjectionResult,
): void {
  const first = group[0];
  if (first === undefined) return;
  const tz = first.serverTimezone ?? input.defaultTimezone;
  if (!isValidIanaTimezone(tz)) {
    result.skipped.push({ serverId, reason: 'bad_tz' });
    return;
  }
  if (hasTzMismatch(group, tz)) result.tzMismatchServerIds.push(serverId);
  const lastStopMs = latestStopBefore(group, tz, input.range.from);
  const events = group.flatMap((s) =>
    scheduleEvents(s, { tz, range: input.range, lastStopMs }, result),
  );
  const { kept, truncated } = capEvents(events);
  if (truncated) result.truncatedServerIds.push(serverId);
  const from = input.range.from.getTime();
  const to = input.range.to.getTime();
  const base = serverBase(serverId, first);
  const spans = pairEvents(kept.sort(compareEvents))
    .filter((s) => overlapsRange(s, from, to))
    .sort(compareSpans);
  result.items.push(...spans.map((s) => toCalendarItem(s, base)));
}

/** Member-safe facts every item of one server carries (D13). */
function serverBase(
  serverId: number,
  first: ProjectionSchedule,
): ProjectionServerBase {
  return {
    serverKey: String(serverId),
    serverName: redactServerName(first.serverName, serverId),
    gameId: first.gameId,
    provider: PELICAN_PROVIDER_LABEL,
  };
}

/**
 * Keep the first CAP in-range events chronologically (D5). When anything
 * was dropped, events after the last kept one go too, so a window cannot
 * silently span the dropped tail.
 */
function capEvents(events: ProjectionEvent[]): {
  kept: ProjectionEvent[];
  truncated: boolean;
} {
  const inRange = events.filter((e) => e.inRange).sort(compareEvents);
  const last = inRange[PELICAN_PROJECTION_CAP - 1];
  if (inRange.length <= PELICAN_PROJECTION_CAP || last === undefined) {
    return { kept: events, truncated: false };
  }
  const allowed = new Set(inRange.slice(0, PELICAN_PROJECTION_CAP));
  const kept = events.filter((e) =>
    e.inRange ? allowed.has(e) : e.at <= last.at,
  );
  return { kept, truncated: true };
}

function parseEffect(effect: string): GameServerEffect | null {
  const parsed = GameServerEffectSchema.safeParse(effect);
  return parsed.success ? parsed.data : null;
}

/** Per-server expansion context shared by every schedule of the server. */
interface ExpandContext {
  tz: string;
  range: ProjectionRange;
  /** Effect time (ms) of the server's latest stop/kill before `from`, if any. */
  lastStopMs: number | null;
}

/**
 * The latest stop/kill effect before `from` across the server's schedules.
 * A bad cron is skipped here — its own expansion records it as `bad_cron`.
 */
function latestStopBefore(
  group: readonly ProjectionSchedule[],
  tz: string,
  from: Date,
): number | null {
  let latest: number | null = null;
  for (const s of group) {
    const effect = parseEffect(s.effect);
    if (effect === null || !isStop(effect)) continue;
    const offsetMs = s.effectOffsetS * 1000;
    try {
      const run = prevBefore(
        toCronExpression(s),
        tz,
        new Date(from.getTime() - offsetMs),
      );
      latest = Math.max(latest ?? -Infinity, run.getTime() + offsetMs);
    } catch {
      continue;
    }
  }
  return latest;
}

/** In-range runs + the look-behind/look-ahead runs (D4, D7) of one schedule. */
function scheduleEvents(
  s: ProjectionSchedule,
  ctx: ExpandContext,
  result: ProjectionResult,
): ProjectionEvent[] {
  const effect = parseEffect(s.effect);
  if (effect === null) {
    result.skipped.push({
      serverId: s.serverId,
      scheduleId: s.id,
      reason: 'bad_effect',
    });
    return [];
  }
  try {
    return expandSchedule(s, effect, ctx);
  } catch {
    result.skipped.push({
      serverId: s.serverId,
      scheduleId: s.id,
      reason: 'bad_cron',
    });
    return [];
  }
}

/**
 * A start's look-behind run: the first run at/after the server's latest
 * stop before `from` — so the opener of a window spanning `from` is stable
 * whatever `from` is (ruling 2: later starts while open are absorbed).
 * With no stop schedule it is simply the last run before `from`.
 */
function startLookBehind(
  expr: string,
  tz: string,
  from: Date,
  lastStopRunMs: number | null,
): Date[] {
  if (lastStopRunMs === null) return [prevBefore(expr, tz, from)];
  const run = nextAtOrAfter(expr, tz, new Date(lastStopRunMs));
  return run.getTime() < from.getTime() ? [run] : [];
}

function expandSchedule(
  s: ProjectionSchedule,
  effect: GameServerEffect,
  { tz, range, lastStopMs }: ExpandContext,
): ProjectionEvent[] {
  const expr = toCronExpression(s);
  const offsetMs = s.effectOffsetS * 1000;
  const from = new Date(range.from.getTime() - offsetMs);
  const to = new Date(range.to.getTime() - offsetMs);
  const label = redactScheduleLabel(s.name, effect);
  const event = (run: Date, inRange: boolean): ProjectionEvent => ({
    at: run.getTime() + offsetMs,
    effect,
    label,
    inRange,
  });
  const out = expandBetween(expr, tz, from, to, PELICAN_PROJECTION_CAP + 1).map(
    (run) => event(run, true),
  );
  if (effect === 'start') {
    const stopRunMs = lastStopMs === null ? null : lastStopMs - offsetMs;
    for (const run of startLookBehind(expr, tz, from, stopRunMs))
      out.push(event(run, false));
  }
  if (isStop(effect)) {
    out.push(event(prevBefore(expr, tz, from), false));
    out.push(event(nextAtOrAfter(expr, tz, to), false));
  }
  return out;
}
