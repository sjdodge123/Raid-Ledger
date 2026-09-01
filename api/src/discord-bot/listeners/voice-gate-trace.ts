/**
 * ROK-1417 (plan B4, Tier 1+2) — per-join Quick Play gate trace.
 *
 * The voice-join → ad-hoc-spawn decision chain has many silent early returns.
 * When Quick Play stops spawning in prod there is nothing in the logs to say
 * WHICH branch dropped the join. `traceGate` emits one `logger.log` line at
 * every terminal outcome so the chain is greppable at the prod default log
 * threshold (INFO) — hence `logger.log`, never `logger.debug`.
 *
 * Tier 2 (`warnInertOnce`) escalates the ROK-1415 incident shape (a null-game
 * `game-voice-monitor` bind) to `logger.warn` + a Sentry message that GROUPS
 * with the bot-ready `reportBindingHealthWarnings` alert (same stable string).
 *
 * Both throttles are module-scope Maps — a Redis/PG round-trip per voice join
 * is unacceptable on this hot path, and `perfLog` (DEBUG-gated, closed category
 * union) / `NotificationDedupService` are the wrong tools here.
 */
import type { Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import type { ResolvedBinding } from './voice-state.helpers';

/** Terminal outcomes of the join → spawn decision chain (greppable tokens). */
export type GateOutcome =
  | 'unbound-channel'
  | 'suppressed-scheduled'
  | 'joined-existing'
  | 'below-threshold'
  | 'below-threshold-inert'
  | 'spawn-scheduled'
  | 'spawned-immediate'
  | 'feature-disabled'
  | 'lobby-no-game-detected'
  | 'no-trigger-user'
  // ROK-1445: a general-lobby game group that did not clear `minPlayers` and
  // was therefore dropped (never folded into another game's roster).
  | 'group-below-threshold';

/**
 * Fields rendered into the trace line. `gameId: null` is printed literally —
 * the null IS the signal (ROK-1415). The numeric threshold fields are optional
 * and omitted from the line when a call site can't cheaply compute them.
 */
export interface GateCtx {
  channelId: string;
  bindingId: string;
  /** Omitted from the line when a call site (e.g. the kill-switch) can't resolve it. */
  purpose?: string;
  gameId: number | null;
  members?: number;
  minPlayers?: number;
  counted?: number;
  confirmed?: number;
}

/** Build the gate trace context from a resolved binding (+ optional metrics). */
export function gateCtx(
  binding: ResolvedBinding,
  channelId: string,
  extra?: Partial<GateCtx>,
): GateCtx {
  return {
    channelId,
    bindingId: binding.bindingId,
    purpose: binding.bindingPurpose,
    gameId: binding.gameId,
    ...extra,
  };
}

const THROTTLE_WINDOW_MS = 60 * 1000;
const THROTTLE_PRUNE_MS = 10 * 60 * 1000;
const INERT_WARN_WINDOW_MS = 15 * 60 * 1000;

interface ThrottleBucket {
  windowStart: number;
  count: number;
}

/**
 * `${channelId}:${bindingId}:${gameId}:${outcome}` → open 60s window.
 *
 * ROK-1445 added `gameId`: one general-lobby channel now holds N concurrent
 * per-game events, so a channel-wide bucket let one game's drop silently mask
 * another's for a full minute.
 */
const throttleBuckets = new Map<string, ThrottleBucket>();
/** `bindingId` → last inert-warn timestamp (15-min dedupe). */
const inertWarnedAt = new Map<string, number>();

/** Build the fixed-key-order line; undefined threshold keys are omitted. */
function renderLine(outcome: GateOutcome, ctx: GateCtx): string {
  const parts = [
    `outcome=${outcome}`,
    `ch=${ctx.channelId}`,
    `binding=${ctx.bindingId}`,
  ];
  if (ctx.purpose !== undefined) parts.push(`purpose=${ctx.purpose}`);
  parts.push(`game=${ctx.gameId === null ? 'null' : ctx.gameId}`);
  if (ctx.members !== undefined) parts.push(`members=${ctx.members}`);
  if (ctx.minPlayers !== undefined) parts.push(`min=${ctx.minPlayers}`);
  if (ctx.counted !== undefined) parts.push(`counted=${ctx.counted}`);
  if (ctx.confirmed !== undefined) parts.push(`confirmed=${ctx.confirmed}`);
  return `[voice-gate] ${parts.join(' ')}`;
}

/** Drop buckets whose window opened more than 10 minutes ago. */
function pruneThrottle(now: number): void {
  for (const [key, bucket] of throttleBuckets) {
    if (now - bucket.windowStart > THROTTLE_PRUNE_MS)
      throttleBuckets.delete(key);
  }
}

/**
 * Emit one INFO trace line for a terminal outcome, throttled to one line per
 * `${channelId}:${bindingId}:${gameId}:${outcome}` per 60s. The first emit AFTER a window
 * closes carries `repeat=N` — N being the total emits collapsed in the window
 * that just closed — so a hot loop is visible without flooding the log.
 */
export function traceGate(
  logger: Logger,
  outcome: GateOutcome,
  ctx: GateCtx,
): void {
  const now = Date.now();
  pruneThrottle(now);
  const key = `${ctx.channelId}:${ctx.bindingId}:${ctx.gameId ?? 'null'}:${outcome}`;
  const bucket = throttleBuckets.get(key);
  if (bucket && now - bucket.windowStart < THROTTLE_WINDOW_MS) {
    bucket.count += 1;
    return;
  }
  const closed = bucket ? bucket.count : 0;
  throttleBuckets.set(key, { windowStart: now, count: 1 });
  const line = renderLine(outcome, ctx);
  logger.log(closed > 1 ? `${line} repeat=${closed}` : line);
}

/**
 * Escalate a null-game monitor (the ROK-1415 inert shape) once per 15 min per
 * binding: WARN + a Sentry message using the SAME stable string as the
 * bot-ready binding-health reporter so both group into one Sentry issue.
 */
export function warnInertOnce(logger: Logger, ctx: GateCtx): void {
  const now = Date.now();
  // Codex P3: keep this hot-path Map bounded — drop entries whose dedupe
  // window has lapsed (recreated bindings would otherwise accrete forever).
  for (const [key, at] of inertWarnedAt) {
    if (now - at >= INERT_WARN_WINDOW_MS) inertWarnedAt.delete(key);
  }
  const last = inertWarnedAt.get(ctx.bindingId);
  if (last !== undefined && now - last < INERT_WARN_WINDOW_MS) return;
  inertWarnedAt.set(ctx.bindingId, now);
  logger.warn(
    `[voice-gate] INERT binding=${ctx.bindingId} ch=${ctx.channelId} ` +
      `purpose=${ctx.purpose} game=null — null-game monitor, Quick Play degraded (ROK-1415)`,
  );
  Sentry.captureMessage('Inert Quick Play binding', {
    level: 'warning',
    tags: { context: 'binding-health', channelId: ctx.channelId },
  });
}

/** Test-only: clear both throttle Maps between cases. */
export function __resetTraceState(): void {
  throttleBuckets.clear();
  inertWarnedAt.clear();
}
