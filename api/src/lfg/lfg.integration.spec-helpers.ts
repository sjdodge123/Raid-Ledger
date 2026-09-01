/**
 * Shared helpers + response contracts for the ROK-1451 LFG integration spec.
 *
 * TDD NOTE: this file deliberately does NOT import anything from `./lfg.*`.
 * The spec must stay *compilable* before the implementation exists so every
 * test fails on its own real assertion (404 / missing relation) rather than
 * the whole file dying on a module-resolution error. It still imports no
 * `./lfg.*` module; DB-state assertions go through the drizzle schema, which
 * is shared infrastructure rather than this story's implementation.
 */
import { and, asc, eq, sql } from 'drizzle-orm';
import * as schema from '../drizzle/schema';
import { type TestApp } from '../common/testing/test-app';

/** Scheduler-registry name the expiry cron must register under (AC9). */
export const LFG_EXPIRY_JOB_NAME = 'LfgExpiryService_expireIntents';

/** Hourly at :15 — the schedule the spec pins for the expiry sweep. */
export const LFG_EXPIRY_CRON_EXPRESSION = '0 15 * * * *';

/** Single global expiry horizon (AC13). */
export const LFG_EXPIRY_DAYS = 14;

export const DAY_MS = 24 * 60 * 60 * 1000;

// ─── Response contracts (the DTO shape this story is being built against) ────

export interface LfgIntentDto {
  id: number;
  userId: number;
  gameId: number;
  status: string;
  visibility: string;
  createdAt: string;
  expiresAt: string;
  convertedToPollId: number | null;
  convertedToEventId: number | null;
}

export interface LfgGroupSummaryDto {
  gameId: number;
  gameName: string;
  gameCoverUrl: string | null;
  activeCount: number;
  state: 'lfg' | 'lfm' | null;
  viabilityThreshold: number | null;
  isViable: boolean;
  hasOwnIntent: boolean;
  soonestExpiresAt: string | null;
}

export interface LfgMemberDto {
  userId: number;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  expiresAt: string;
  joinedAt: string;
}

export interface LfgGroupDetailDto extends LfgGroupSummaryDto {
  members: LfgMemberDto[];
  ownIntent: LfgIntentDto | null;
}

/** `POST /lfg` body: the intent, plus the derived group so callers can render
 * without a second round-trip. */
export interface LfgIntentResponseDto extends LfgIntentDto {
  group: LfgGroupSummaryDto;
}

export interface LfgHeartedGameDto {
  gameId: number;
  gameName: string;
  gameCoverUrl: string | null;
  heartedAt: string;
  activeCount: number;
}

/** Raw `lfg_intents` row as returned by the raw-SQL readers below.
 * A type alias (not an interface) so it satisfies the
 * `Record<string, unknown>` constraint on `db.execute<T>()`. */
export type LfgIntentRow = {
  id: number;
  user_id: number;
  game_id: number;
  status: string;
  visibility: string;
  created_at: Date;
  expires_at: Date;
  converted_to_poll_id: number | null;
  converted_to_event_id: number | null;
};

// ─── Fixtures ───────────────────────────────────────────────────────────────

let gameSeq = 0;

/** Create a game. `cooptimusOnlineMax` drives the viability signal (AC14). */
export async function createGame(
  testApp: TestApp,
  name: string,
  overrides: Partial<typeof schema.games.$inferInsert> = {},
): Promise<typeof schema.games.$inferSelect> {
  gameSeq += 1;
  const [game] = await testApp.db
    .insert(schema.games)
    .values({
      name,
      slug: `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${gameSeq}`,
      coverUrl: null,
      igdbId: null,
      ...overrides,
    })
    .returning();
  return game;
}

/** Insert a `game_interests` heart for a user (LFG only ever reads these). */
export async function heartGame(
  testApp: TestApp,
  userId: number,
  gameId: number,
  source = 'manual',
): Promise<void> {
  await testApp.db
    .insert(schema.gameInterests)
    .values({ userId, gameId, source });
}

/**
 * Create a community lineup + match so `convert { pollId }` has a real row to
 * point its provenance FK at.
 */
export async function createLineupMatch(
  testApp: TestApp,
  createdBy: number,
  gameId: number,
): Promise<number> {
  const [lineup] = await testApp.db
    .insert(schema.communityLineups)
    .values({
      title: 'LFG convert target',
      createdBy,
      publicSlug: `lfg${Date.now().toString(36)}${gameSeq}`.slice(0, 16),
    })
    .returning();
  const [match] = await testApp.db
    .insert(schema.communityLineupMatches)
    // NOTE: `status` / `threshold_met` / `vote_count` are declared with
    // Drizzle-side defaults but the migrated columns are NOT NULL with no DB
    // default, so they must be supplied explicitly here.
    .values({
      lineupId: lineup.id,
      gameId,
      status: 'suggested',
      thresholdMet: false,
      voteCount: 0,
    })
    .returning();
  return match.id;
}

/** Flip a user to deactivated (ROK-313 exclusion family). */
export async function deactivateUser(
  testApp: TestApp,
  userId: number,
): Promise<void> {
  await testApp.db.execute(
    sql`UPDATE users SET deactivated_at = now() WHERE id = ${userId}`,
  );
}

/** Flip a user to banned (ROK-313 exclusion family). */
export async function banUser(testApp: TestApp, userId: number): Promise<void> {
  await testApp.db.execute(
    sql`UPDATE users SET banned_at = now() WHERE id = ${userId}`,
  );
}

// ─── Readers/writers over `lfg_intents` ─────────────────────────────────────
//
// TIMEZONE (fleet failure 2026-09-01): these READ through drizzle rather than
// `db.execute(sql\`SELECT * ...\`)`. `expires_at` is a naive `timestamp`, and the
// two paths disagree about what that means — drizzle appends `+0000` and reads
// it as UTC (the convention the app writes with), while a raw `execute` hands
// the string to postgres.js, which parses it in the *runner's* local zone. On a
// UTC-6 fleet runner that made every timestamp read 6h off, so `+14 days` came
// back as 14.25. Reading through drizzle asserts against the app's own
// representation instead of a second, divergent one.

/** Map a drizzle row to the snake_case shape the spec asserts on. */
function toRow(r: typeof schema.lfgIntents.$inferSelect): LfgIntentRow {
  return {
    id: r.id,
    user_id: r.userId,
    game_id: r.gameId,
    status: r.status,
    visibility: r.visibility,
    created_at: r.createdAt,
    expires_at: r.expiresAt,
    converted_to_poll_id: r.convertedToPollId,
    converted_to_event_id: r.convertedToEventId,
  };
}

/** Every intent row for a game, oldest first. */
export async function readIntentsForGame(
  testApp: TestApp,
  gameId: number,
): Promise<LfgIntentRow[]> {
  const rows = await testApp.db
    .select()
    .from(schema.lfgIntents)
    .where(eq(schema.lfgIntents.gameId, gameId))
    .orderBy(asc(schema.lfgIntents.id));
  return rows.map(toRow);
}

/** The single intent row for a `(user, game)` pair, or null. */
export async function readIntent(
  testApp: TestApp,
  userId: number,
  gameId: number,
): Promise<LfgIntentRow | null> {
  const rows = await testApp.db
    .select()
    .from(schema.lfgIntents)
    .where(
      and(
        eq(schema.lfgIntents.userId, userId),
        eq(schema.lfgIntents.gameId, gameId),
      ),
    )
    .orderBy(asc(schema.lfgIntents.id));
  return rows[0] ? toRow(rows[0]) : null;
}

/** Force an intent's `expires_at` — used to build stale / near-expiry states. */
export async function setExpiresAt(
  testApp: TestApp,
  intentId: number,
  expiresAt: Date,
): Promise<void> {
  // Through drizzle, so the write uses the same UTC convention as the read
  // above and as the application itself. A raw `execute` here would need a
  // hand-rolled cast and would reintroduce the timezone split.
  await testApp.db
    .update(schema.lfgIntents)
    .set({ expiresAt })
    .where(eq(schema.lfgIntents.id, intentId));
}

/** Count rows in `game_interests` — proves `GET /lfg/hearted` is read-only. */
export async function countGameInterests(testApp: TestApp): Promise<number> {
  const rows = await testApp.db.execute<{ count: string }>(
    sql`SELECT COUNT(*)::text AS count FROM game_interests`,
  );
  return Number(rows[0]?.count ?? '0');
}

/** Milliseconds between `expiresAt` and now, expressed in days. */
export function daysFromNow(expiresAt: string | Date): number {
  const ms = new Date(expiresAt).getTime() - Date.now();
  return ms / DAY_MS;
}

// ─── Quick Play / ad-hoc fixtures (AC7) ──────────────────────────────────────

/**
 * Create an ad-hoc ("Quick Play") event for a game, started at `startedAt`.
 * Inserted directly: the real spawn path runs off Discord voice state.
 */
export async function createQuickPlayEvent(
  testApp: TestApp,
  creatorId: number,
  gameId: number | null,
  startedAt: Date,
  overrides: Partial<typeof schema.events.$inferInsert> = {},
): Promise<number> {
  const [event] = await testApp.db
    .insert(schema.events)
    .values({
      title: 'Quick Play session',
      creatorId,
      gameId,
      isAdHoc: true,
      adHocStatus: 'live',
      duration: [startedAt, new Date(startedAt.getTime() + 2 * 60 * 60 * 1000)],
      ...overrides,
    })
    .returning();
  return event.id;
}

/** Record a user as a participant in an ad-hoc session. */
export async function addQuickPlayParticipant(
  testApp: TestApp,
  eventId: number,
  userId: number,
  joinedAt: Date = new Date(),
): Promise<void> {
  await testApp.db.insert(schema.adHocParticipants).values({
    eventId,
    userId,
    discordUserId: `discord-${userId}-${eventId}`,
    discordUsername: `player-${userId}`,
    joinedAt,
  });
}
