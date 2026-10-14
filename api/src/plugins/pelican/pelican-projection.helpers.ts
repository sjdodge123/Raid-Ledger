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
import { PELICAN_PROJECTION_CAP, PELICAN_PROVIDER_LABEL } from './pelican.constants';
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

export interface ProjectionSchedule
  extends Pick<
    PelicanScheduleRow,
    | 'id' | 'serverId' | 'name' | 'cronMinute' | 'cronHour' | 'cronDayOfMonth'
    | 'cronMonth' | 'cronDayOfWeek' | 'isActive' | 'nextRunAt' | 'effect'
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
    if (!s.isActive || (gameIds !== undefined && !gameIds.includes(s.gameId))) continue;
    groups.set(s.serverId, [...(groups.get(s.serverId) ?? []), s]);
  }
  const serverIds = [...groups.keys()].sort((a, b) => a - b);
  for (const id of serverIds) projectServer(id, groups.get(id) ?? [], input, result);
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
  const events = group.flatMap((s) => scheduleEvents(s, tz, input.range, result));
  const { kept, truncated } = capEvents(events);
  if (truncated) result.truncatedServerIds.push(serverId);
  const from = input.range.from.getTime();
  const to = input.range.to.getTime();
  const base: ProjectionServerBase = {
    serverKey: String(serverId),
    serverName: redactServerName(first.serverName, serverId),
    gameId: first.gameId,
    provider: PELICAN_PROVIDER_LABEL,
  };
  const spans = pairEvents(kept.sort(compareEvents))
    .filter((s) => overlapsRange(s, from, to))
    .sort(compareSpans);
  result.items.push(...spans.map((s) => toCalendarItem(s, base)));
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
  const kept = events.filter((e) => (e.inRange ? allowed.has(e) : e.at <= last.at));
  return { kept, truncated: true };
}

function parseEffect(effect: string): GameServerEffect | null {
  const parsed = GameServerEffectSchema.safeParse(effect);
  return parsed.success ? parsed.data : null;
}

/** In-range runs + the look-behind/look-ahead runs (D4, D7) of one schedule. */
function scheduleEvents(
  s: ProjectionSchedule,
  tz: string,
  range: ProjectionRange,
  result: ProjectionResult,
): ProjectionEvent[] {
  const effect = parseEffect(s.effect);
  if (effect === null) {
    result.skipped.push({ serverId: s.serverId, scheduleId: s.id, reason: 'bad_effect' });
    return [];
  }
  try {
    return expandSchedule(s, effect, tz, range);
  } catch {
    result.skipped.push({ serverId: s.serverId, scheduleId: s.id, reason: 'bad_cron' });
    return [];
  }
}

function expandSchedule(
  s: ProjectionSchedule,
  effect: GameServerEffect,
  tz: string,
  range: ProjectionRange,
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
  if (effect === 'start' || isStop(effect)) out.push(event(prevBefore(expr, tz, from), false));
  if (isStop(effect)) out.push(event(nextAtOrAfter(expr, tz, to), false));
  return out;
}
