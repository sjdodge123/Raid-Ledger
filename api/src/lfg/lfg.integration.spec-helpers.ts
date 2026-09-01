/**
 * Shared helpers + response contracts for the ROK-1451 LFG integration spec.
 *
 * TDD NOTE: this file deliberately does NOT import anything from `./lfg.*`.
 * The spec must stay *compilable* before the implementation exists so every
 * test fails on its own real assertion (404 / missing relation) rather than
 * the whole file dying on a module-resolution error. DB-state assertions go
 * through raw SQL for the same reason — `schema.lfgIntents` does not exist yet
 * and would break the build.
 */
import { sql } from 'drizzle-orm';
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

// ─── Raw-SQL readers/writers over `lfg_intents` ──────────────────────────────

/** Every intent row for a game, oldest first. */
export async function readIntentsForGame(
  testApp: TestApp,
  gameId: number,
): Promise<LfgIntentRow[]> {
  const rows = await testApp.db.execute<LfgIntentRow>(
    sql`SELECT * FROM lfg_intents WHERE game_id = ${gameId} ORDER BY id ASC`,
  );
  return [...rows];
}

/** The single intent row for a `(user, game)` pair, or null. */
export async function readIntent(
  testApp: TestApp,
  userId: number,
  gameId: number,
): Promise<LfgIntentRow | null> {
  const rows = await testApp.db.execute<LfgIntentRow>(
    sql`SELECT * FROM lfg_intents
        WHERE user_id = ${userId} AND game_id = ${gameId}
        ORDER BY id ASC`,
  );
  return rows[0] ?? null;
}

/** Force an intent's `expires_at` — used to build stale / near-expiry states. */
export async function setExpiresAt(
  testApp: TestApp,
  intentId: number,
  expiresAt: Date,
): Promise<void> {
  // ISO string, not a bare Date: drizzle passes raw template params straight
  // through to postgres.js, whose Bind path cannot serialize a Date without a
  // column mapper. Postgres casts the text to `timestamp` on assignment.
  await testApp.db.execute(
    sql`UPDATE lfg_intents SET expires_at = ${expiresAt.toISOString()} WHERE id = ${intentId}`,
  );
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
