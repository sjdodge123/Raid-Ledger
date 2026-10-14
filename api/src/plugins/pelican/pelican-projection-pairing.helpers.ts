import type {
  GameServerCalendarItemDto,
  GameServerEffect,
} from '@raid-ledger/contract';

/** One expanded schedule run, effect time in epoch ms (ROK-1096 §4.2). */
export interface ProjectionEvent {
  at: number;
  effect: GameServerEffect;
  label: string;
  /** False for the look-behind / look-ahead runs (D7) — they never count toward the cap. */
  inRange: boolean;
}

/** A paired window or a lone marker, still in epoch ms. */
export type ProjectedSpan =
  | { kind: 'window'; start: number; end: number; label: string }
  | { kind: 'marker'; at: number; effect: GameServerEffect; label: string };

/** Member-safe server facts every item carries. */
export interface ProjectionServerBase {
  serverKey: string;
  serverName: string;
  gameId: number;
  provider: string;
}

const isStop = (effect: GameServerEffect): boolean =>
  effect === 'stop' || effect === 'kill';

/** Same-instant order: stop/kill closes before start reopens, markers last (D6). */
function tieRank(effect: GameServerEffect): number {
  if (isStop(effect)) return 0;
  return effect === 'start' ? 1 : 2;
}

export function compareEvents(a: ProjectionEvent, b: ProjectionEvent): number {
  return a.at - b.at || tieRank(a.effect) - tieRank(b.effect);
}

function marker(e: ProjectionEvent): ProjectedSpan {
  return { kind: 'marker', at: e.at, effect: e.effect, label: e.label };
}

/**
 * Walk time-sorted events (D6, ruling 2): start opens a window, a second
 * start while open is ignored, stop/kill closes it (or is a marker when
 * nothing is open), every other effect is a marker. Starts never closed —
 * the opener and any it absorbed — become `start` markers, so a start
 * schedule with no stop/kill schedule yields one marker per run.
 */
export function pairEvents(
  sorted: readonly ProjectionEvent[],
): ProjectedSpan[] {
  const out: ProjectedSpan[] = [];
  let pending: ProjectionEvent[] = [];
  for (const e of sorted) {
    const open = pending[0];
    if (e.effect === 'start') {
      pending.push(e);
    } else if (isStop(e.effect) && open !== undefined) {
      out.push({
        kind: 'window',
        start: open.at,
        end: e.at,
        label: open.label,
      });
      pending = [];
    } else {
      out.push(marker(e));
    }
  }
  out.push(...pending.map(marker));
  return out;
}

const spanStart = (s: ProjectedSpan): number =>
  s.kind === 'window' ? s.start : s.at;

/** Window overlaps `[from, to)`; marker lies inside it. Windows are not clipped (D7). */
export function overlapsRange(
  s: ProjectedSpan,
  from: number,
  to: number,
): boolean {
  if (s.kind === 'window') return s.start < to && s.end > from;
  return s.at >= from && s.at < to;
}

export function compareSpans(a: ProjectedSpan, b: ProjectedSpan): number {
  return spanStart(a) - spanStart(b);
}

export function toCalendarItem(
  s: ProjectedSpan,
  base: ProjectionServerBase,
): GameServerCalendarItemDto {
  if (s.kind === 'window') {
    const start = new Date(s.start).toISOString();
    const end = new Date(s.end).toISOString();
    return {
      kind: 'window',
      ...base,
      start,
      end,
      label: s.label,
      source: 'schedule',
    };
  }
  const at = new Date(s.at).toISOString();
  return { kind: 'marker', ...base, at, effect: s.effect, label: s.label };
}
