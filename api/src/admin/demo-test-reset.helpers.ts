/**
 * Reset-to-seed helpers (ROK-1186).
 *
 * Centralises the SQL wipe used by `POST /admin/test/reset-to-seed`.
 * Wipes ALL test-created data — events, signups, lineups (+ entries/
 * votes/invitees/matches/tiebreakers), characters, voice sessions,
 * roster assignments, reminders, pug slots, ad-hoc participants,
 * Discord event messages, availability, event plans, AI lineup
 * suggestions, and WoW Classic quest progress — regardless of creator.
 * Preserves users, games, and app_settings; the demo installer
 * re-creates demo fixtures afterwards.
 *
 * The wipe is split across `wipeChildren` and `wipeParents` for
 * readability, not FK-ordering: `TRUNCATE … CASCADE` on the parents
 * alone would catch everything. Listing the children explicitly
 * documents which tables this endpoint touches.
 */
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';

type Db = PostgresJsDatabase<typeof schema>;

/** Counts of rows deleted by `wipeAllTestData`. */
export interface WipeCounts {
  events: number;
  signups: number;
  lineups: number;
  lineupEntries: number;
  lineupVotes: number;
  characters: number;
  voiceSessions: number;
  rosterAssignments: number;
  availability: number;
  eventPlans: number;
  lineupAiSuggestions: number;
  questProgress: number;
}

function emptyWipeCounts(): WipeCounts {
  return {
    events: 0,
    signups: 0,
    lineups: 0,
    lineupEntries: 0,
    lineupVotes: 0,
    characters: 0,
    voiceSessions: 0,
    rosterAssignments: 0,
    availability: 0,
    eventPlans: 0,
    lineupAiSuggestions: 0,
    questProgress: 0,
  };
}

/**
 * Count rows in a table before truncate.
 * Centralised so the controller's reported counts always match
 * what was actually deleted.
 */
async function countAll(db: Db, table: string): Promise<number> {
  const rows = await db.execute<{ count: string }>(
    sql.raw(`SELECT COUNT(*)::text AS count FROM ${table}`),
  );
  const first = rows[0] as { count: string } | undefined;
  return first ? parseInt(first.count, 10) : 0;
}

/**
 * Tables counted before wipe, in the order they appear in WipeCounts.
 * Centralised so the count snapshot stays in sync with the type.
 */
const COUNT_TABLES = [
  'events',
  'event_signups',
  'community_lineups',
  'community_lineup_entries',
  'community_lineup_votes',
  'characters',
  'event_voice_sessions',
  'roster_assignments',
  'availability',
  'event_plans',
  'lineup_ai_suggestions',
  'wow_classic_quest_progress',
] as const;

/** Capture current counts of every table the wipe touches. */
export async function snapshotCounts(db: Db): Promise<WipeCounts> {
  const counts = await Promise.all(COUNT_TABLES.map((t) => countAll(db, t)));
  return countsFromArray(counts);
}

/** Map ordered count results to the named WipeCounts shape. */
function countsFromArray(counts: number[]): WipeCounts {
  const [
    events,
    signups,
    lineups,
    lineupEntries,
    lineupVotes,
    characters,
    voiceSessions,
    rosterAssignments,
    availability,
    eventPlans,
    lineupAiSuggestions,
    questProgress,
  ] = counts;
  return {
    events,
    signups,
    lineups,
    lineupEntries,
    lineupVotes,
    characters,
    voiceSessions,
    rosterAssignments,
    availability,
    eventPlans,
    lineupAiSuggestions,
    questProgress,
  };
}

/**
 * Wipe child tables that reference events / lineups / characters /
 * users. Listed explicitly (rather than relying solely on the parent
 * TRUNCATE CASCADE) so the wiped surface is documented in code.
 * Includes tables a parent CASCADE would silently truncate as well —
 * `availability`, `event_plans`, `lineup_ai_suggestions`,
 * `wow_classic_quest_progress`.
 */
async function wipeChildren(db: Db): Promise<void> {
  await db.execute(sql`
    TRUNCATE TABLE
      community_lineup_votes,
      community_lineup_entries,
      community_lineup_invitees,
      community_lineup_matches,
      community_lineup_tiebreakers,
      community_lineup_tiebreaker_bracket_matchups,
      community_lineup_tiebreaker_bracket_votes,
      community_lineup_tiebreaker_vetoes,
      lineup_ai_suggestions,
      event_signups,
      roster_assignments,
      event_voice_sessions,
      event_reminders_sent,
      post_event_reminders_sent,
      pug_slots,
      ad_hoc_participants,
      discord_event_messages,
      availability,
      event_plans,
      wow_classic_quest_progress,
      notification_dedup
    RESTART IDENTITY CASCADE
  `);
}

/** Wipe parent tables (events, characters, community_lineups). */
async function wipeParents(db: Db): Promise<void> {
  await db.execute(sql`
    TRUNCATE TABLE
      events,
      characters,
      community_lineups
    RESTART IDENTITY CASCADE
  `);
}

/**
 * Wipe all test-created data. Returns BEFORE counts so the caller
 * can report what was deleted. Preserves users, games, app_settings,
 * and migration metadata.
 */
export async function wipeAllTestData(db: Db): Promise<WipeCounts> {
  const before = await snapshotCounts(db);
  // No-op fast path so reset on an already-clean DB is cheap.
  if (allZero(before)) return emptyWipeCounts();
  await wipeChildren(db);
  await wipeParents(db);
  return before;
}

function allZero(c: WipeCounts): boolean {
  return Object.values(c).every((n) => n === 0);
}
