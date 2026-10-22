import { sql, type SQL } from 'drizzle-orm';
import type { GameActivitySignalKind } from '@raid-ledger/contract';

/**
 * ROK-1430 (spec D1/D2, A1–A4): the game-activity signal registry.
 *
 * Every signal is a SQL fragment selecting exactly three columns —
 * `game_id int`, `item_id text`, `last_at timestamptz` — with one or more rows
 * per ACTIVITY ITEM (A1: an event, a poll match, an event plan, a
 * `(lineup, game)` vote pair). The aggregate query unions them, then counts
 * `DISTINCT item_id` per `(game_id, kind)`, so votes refresh an item's
 * `last_at` but never add items. `hub` is appended later via `registerSignal`.
 */

/** The window every signal is evaluated against. */
export interface SignalWindow {
  now: Date;
  /** `now - windowDays`; an item counts when its activity is on/after this. */
  windowStart: Date;
}

/** One activity source. `select` returns `(game_id, item_id, last_at)` rows. */
export interface GameActivitySignal {
  kind: GameActivitySignalKind;
  select(window: SignalWindow): SQL;
}

/** Binds a Date as a timestamptz parameter (ISO string, explicit cast). */
function ts(value: Date): SQL {
  return sql`${value.toISOString()}::timestamptz`;
}

/** Non-cancelled events (ad-hoc INCLUDED, A4) starting on/after the window start — upcoming always count (A3). */
export const eventSignal: GameActivitySignal = {
  kind: 'event',
  select: ({ now, windowStart }) => sql`
    SELECT e.game_id, e.id::text AS item_id,
           LEAST(lower(e.duration)::timestamptz, ${ts(now)}) AS last_at
      FROM events e
     WHERE e.game_id IS NOT NULL
       AND e.cancelled_at IS NULL
       AND lower(e.duration)::timestamptz >= ${ts(windowStart)}`,
};

/** A scheduling/standalone poll = one match with slots; created, voted or re-voted (stance flip, `updated_at`) in the window (A2, A5). */
export const pollSignal: GameActivitySignal = {
  kind: 'poll',
  select: ({ windowStart }) => sql`
    SELECT m.game_id, m.id::text AS item_id,
           max(GREATEST(m.created_at, v.created_at, v.updated_at))::timestamptz AS last_at
      FROM community_lineup_matches m
      JOIN community_lineup_schedule_slots s ON s.match_id = m.id
      LEFT JOIN community_lineup_schedule_votes v ON v.slot_id = s.id
     GROUP BY m.game_id, m.id
    HAVING max(GREATEST(m.created_at, v.created_at, v.updated_at))::timestamptz >= ${ts(windowStart)}`,
};

/** Event plans (Discord-native time polls) created or poll-started in the window; votes are not stored (A2). */
export const eventPlanSignal: GameActivitySignal = {
  kind: 'event_plan',
  select: ({ windowStart }) => sql`
    SELECT p.game_id, p.id::text AS item_id,
           GREATEST(p.created_at, p.poll_started_at)::timestamptz AS last_at
      FROM event_plans p
     WHERE p.game_id IS NOT NULL
       AND GREATEST(p.created_at, p.poll_started_at)::timestamptz >= ${ts(windowStart)}`,
};

/** Lineup votes: one item per `(lineup, game)` pair with any vote in the window. Nominations never count (A6). */
export const lineupVoteSignal: GameActivitySignal = {
  kind: 'lineup_vote',
  select: ({ windowStart }) => sql`
    SELECT v.game_id, v.lineup_id::text AS item_id,
           v.created_at::timestamptz AS last_at
      FROM community_lineup_votes v
     WHERE v.created_at::timestamptz >= ${ts(windowStart)}`,
};

/** The core signals (spec D2). Never mutated. */
export const DEFAULT_SIGNALS: readonly GameActivitySignal[] = Object.freeze([
  eventSignal,
  pollSignal,
  eventPlanSignal,
  lineupVoteSignal,
]);

/** The live registry the reconciler reads; starts as the core list. */
export const SIGNAL_REGISTRY: GameActivitySignal[] = [...DEFAULT_SIGNALS];

/**
 * Adds a signal to the registry (M7 appends `hub`). Registering a kind that
 * is already present replaces it, so a module re-init never double-counts.
 */
export function registerSignal(signal: GameActivitySignal): void {
  const at = SIGNAL_REGISTRY.findIndex((s) => s.kind === signal.kind);
  if (at === -1) SIGNAL_REGISTRY.push(signal);
  else SIGNAL_REGISTRY.splice(at, 1, signal);
}

/** Restores the registry to `DEFAULT_SIGNALS` (tests). */
export function resetSignalRegistry(): void {
  SIGNAL_REGISTRY.splice(0, SIGNAL_REGISTRY.length, ...DEFAULT_SIGNALS);
}
