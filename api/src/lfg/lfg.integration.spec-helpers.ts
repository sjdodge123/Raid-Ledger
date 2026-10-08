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
import { nonEmpty } from '../common/testing/narrow';
import { createMemberAndLogin } from '../events/signups.integration.spec-helpers';

/** Scheduler-registry name the expiry cron must register under (AC9). */
export const LFG_EXPIRY_JOB_NAME = 'LfgExpiryService_expireIntents';

/**
 * Every 5 minutes — the schedule the spec pins for the expiry sweep.
 *
 * Was hourly at :15 until ROK-1479 D6 / operator ruling A4: the sweep is the
 * only thing that tells Discord a group died, and a 30-minute `now` group's
 * post must not outlive the group by an hour.
 */
export const LFG_EXPIRY_CRON_EXPRESSION = '0 */5 * * * *';

/**
 * Single global expiry horizon (AC13), re-exported from the app's own constant
 * so a spec can never assert against a second copy that drifted (ROK-1691).
 */
export { LFG_EXPIRY_DAYS } from './lfg.constants';

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
  /** ROK-1479: `'week'` (7 days, ROK-1691) or `'now'` (30/60 minutes). */
  urgency: string;
  /** ROK-1479: the `now` row's own refresh horizon; null on a week row. */
  ttlMinutes: number | null;
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
  /** ROK-1479: how many of `activeCount` are `now`. Never replaces it (D2). */
  nowCount: number;
  soonestNowExpiresAt: string | null;
}

export interface LfgMemberDto {
  userId: number;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  expiresAt: string;
  joinedAt: string;
  /** ROK-1479: which class this member raised their hand on. */
  urgency: string;
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
  urgency: string;
  ttl_minutes: number | null;
  converted_to_poll_id: number | null;
  converted_to_event_id: number | null;
  converted_at: Date | null;
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
  const [game] = nonEmpty(
    await testApp.db
      .insert(schema.games)
      .values({
        name,
        slug: `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${gameSeq}`,
        coverUrl: null,
        igdbId: null,
        ...overrides,
      })
      .returning(),
    'inserted game row',
  );
  return game;
}

/**
 * Insert a `game_interests` heart for a user (LFG only ever reads these).
 *
 * @param createdAt - When the heart was recorded. Omit to let the DB clock
 *   stamp it; pass an explicit instant when a test needs the heart ordered
 *   against a `game_interest_suppressions` row (see `suppressInterest`).
 */
export async function heartGame(
  testApp: TestApp,
  userId: number,
  gameId: number,
  source = 'manual',
  createdAt?: Date,
): Promise<void> {
  await testApp.db
    .insert(schema.gameInterests)
    .values({ userId, gameId, source, ...(createdAt ? { createdAt } : {}) });
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
  const [lineup] = nonEmpty(
    await testApp.db
      .insert(schema.communityLineups)
      .values({
        title: 'LFG convert target',
        createdBy,
        publicSlug: `lfg${Date.now().toString(36)}${gameSeq}`.slice(0, 16),
      })
      .returning(),
    'inserted community lineup row',
  );
  const [match] = nonEmpty(
    await testApp.db
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
      .returning(),
    'inserted lineup match row',
  );
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
    urgency: r.urgency,
    ttl_minutes: r.ttlMinutes,
    converted_to_poll_id: r.convertedToPollId,
    converted_to_event_id: r.convertedToEventId,
    converted_at: r.convertedAt,
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

/**
 * AC2's row-count guard, as raw SQL rather than a drizzle read.
 *
 * The acceptance criterion is literally `SELECT count(*) ... status='active'`
 * — a bump must update the caller's ONE row, never add a second. Counted
 * server-side so a client-side `.length` on a partial read cannot pass it.
 */
export async function countActiveIntents(
  testApp: TestApp,
  userId: number,
  gameId: number,
): Promise<number> {
  const rows = await testApp.db.execute<{ count: string }>(
    sql`SELECT COUNT(*)::text AS count FROM lfg_intents
        WHERE user_id = ${userId} AND game_id = ${gameId}
          AND status = 'active'`,
  );
  return Number(rows[0]?.count ?? '0');
}

/** Minutes between `expiresAt` and now, rounded — horizons differ by hours. */
export function minutesFromNow(expiresAt: string | Date): number {
  return Math.round((new Date(expiresAt).getTime() - Date.now()) / 60_000);
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
  const [event] = nonEmpty(
    await testApp.db
      .insert(schema.events)
      .values({
        title: 'Quick Play session',
        creatorId,
        gameId,
        isAdHoc: true,
        adHocStatus: 'live',
        duration: [
          startedAt,
          new Date(startedAt.getTime() + 2 * 60 * 60 * 1000),
        ],
        ...overrides,
      })
      .returning(),
    'inserted quick play event row',
  );
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

/** A logged-in member created by {@link createMembers}. */
export type LfgMember = { userId: number; token: string; username: string };

/** One {@link LfgMember} per name, positionally: two names give a pair. */
export type MembersFor<N extends string[]> = { [K in keyof N]: LfgMember };

/**
 * A type guard, not a runtime check: {@link createMembers} pushes exactly one
 * member per name, so this only lets the compiler see the positional tuple
 * without a cast.
 */
function isOnePerName<N extends string[]>(
  out: LfgMember[],
  names: N,
): out is MembersFor<N> {
  return out.length === names.length;
}

/**
 * Create one logged-in member per name (username = name, email
 * `<name>@test.local`), typed positionally so
 * `const [a, b] = await createMembers(testApp, 'alpha', 'bravo')` binds two
 * defined members.
 */
export async function createMembers<N extends string[]>(
  testApp: TestApp,
  ...names: N
): Promise<MembersFor<N>> {
  const out: LfgMember[] = [];
  for (const name of names) {
    const m = await createMemberAndLogin(testApp, name, `${name}@test.local`);
    out.push({ ...m, username: name });
  }
  if (!isOnePerName(out, names)) {
    throw new Error(`Expected ${names.length} members, got ${out.length}`);
  }
  return out;
}
