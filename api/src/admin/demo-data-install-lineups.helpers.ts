/**
 * Demo community lineups installer (ROK-1346 follow-on).
 *
 * The base demo installer seeds users/games/events but no community
 * lineups, so the lineup features — most recently the Participants button
 * (ROK-1346) — can't be exercised in any fleet/dev env. This helper seeds a
 * handful of lineups across phases + visibilities with rich participant
 * rosters so every lineup surface has something to render.
 *
 * It reuses the raw smoke-test fixture helpers (which bypass the
 * LineupsService status-transition guards) rather than driving the real
 * service, so it can pin lineups directly into `voting`/`decided`/`archived`
 * with deterministic rosters. Entries/votes/invitees insert with
 * `onConflictDoNothing` and the whole pass is guarded behind a title check,
 * so it's safe to call once per install or after a `reset-to-seed` wipe.
 */
import { Logger } from '@nestjs/common';
import { eq, inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { defined } from '../common/defined.helpers';
import * as schema from '../drizzle/schema';
import { generatePublicSlug } from '../lineups/public-lineup-slug.helpers';
import { nominateGameForTest } from './demo-test-lineup.helpers';
import {
  advanceLineupToVotingForTest,
  castVoteForTest,
} from './demo-test-lineup-edge.helpers';

type Db = PostgresJsDatabase<typeof schema>;
type User = typeof schema.users.$inferSelect;
type Game = typeof schema.games.$inferSelect;

/** Id of the demo user at `i` — the caller's length guard keeps it in range. */
function userIdAt(users: User[], i: number): number {
  return defined(users[i], `demo user #${i}`).id;
}

/** Id of the demo game at `i` — the caller's length guard keeps it in range. */
function gameIdAt(games: Game[], i: number): number {
  return defined(games[i], `demo game #${i}`).id;
}

const logger = new Logger('DemoCommunityLineups');

/** Titles of the lineups this helper seeds — also the idempotency key. */
export const DEMO_LINEUP_TITLES = [
  'Demo: Public Voting Lineup',
  'Demo: Private Building Lineup',
  'Demo: Decided Lineup',
  'Demo: Archived Lineup',
] as const;

/** Create a demo lineup in `building` status with an explicit title. */
async function createDemoLineup(
  db: Db,
  title: string,
  createdBy: number,
): Promise<number> {
  const [row] = await db
    .insert(schema.communityLineups)
    .values({
      title,
      status: 'building',
      createdBy,
      publicSlug: generatePublicSlug(),
    })
    .returning({ id: schema.communityLineups.id });
  return defined(row, 'inserted demo lineup row').id;
}

/** Insert invitees for a private lineup. Idempotent. */
async function inviteUsers(
  db: Db,
  lineupId: number,
  userIds: number[],
): Promise<void> {
  if (userIds.length === 0) return;
  await db
    .insert(schema.communityLineupInvitees)
    .values(userIds.map((userId) => ({ lineupId, userId })))
    .onConflictDoNothing();
}

/**
 * PUBLIC, voting (AC4 rich roster): four distinct users each nominate a
 * distinct game, then advance to voting. Voter mix is deliberate —
 * `allUsers[1]` both nominated AND voted (must dedup to a single `voted`
 * row), `allUsers[2]` nominated but did NOT vote (stays `nominated`), and
 * `allUsers[5]` votes without having nominated (`participant` / `voted`).
 */
async function seedPublicVotingLineup(
  db: Db,
  creator: number,
  users: User[],
  games: Game[],
): Promise<void> {
  const lineupId = await createDemoLineup(db, DEMO_LINEUP_TITLES[0], creator);
  const nominators = [1, 2, 3, 4];
  for (const [i, nominator] of nominators.entries()) {
    await nominateGameForTest(
      db,
      lineupId,
      gameIdAt(games, i),
      userIdAt(users, nominator),
    );
  }
  await advanceLineupToVotingForTest(db, lineupId);
  // users[1] voted (already nominated → dedup to voted); users[3] votes;
  // users[5] votes without nominating; users[2] deliberately never votes.
  await castVoteForTest(db, lineupId, gameIdAt(games, 0), userIdAt(users, 1));
  await castVoteForTest(db, lineupId, gameIdAt(games, 1), userIdAt(users, 3));
  await castVoteForTest(db, lineupId, gameIdAt(games, 0), userIdAt(users, 5));
}

/**
 * PRIVATE, building (AC3 roster): creator + invitees. Three invitees, two
 * of whom nominate a distinct game so the roster shows mixed
 * `nominated`/`waiting` statuses under the `invitee` role.
 */
async function seedPrivateBuildingLineup(
  db: Db,
  creator: number,
  users: User[],
  games: Game[],
): Promise<void> {
  const lineupId = await createDemoLineup(db, DEMO_LINEUP_TITLES[1], creator);
  await db
    .update(schema.communityLineups)
    .set({ visibility: 'private', updatedAt: new Date() })
    .where(eq(schema.communityLineups.id, lineupId));
  const firstInvitee = userIdAt(users, 6);
  const secondInvitee = userIdAt(users, 7);
  await inviteUsers(db, lineupId, [
    firstInvitee,
    secondInvitee,
    userIdAt(users, 8),
  ]);
  // Two invitees nominate; the third stays `waiting`.
  await nominateGameForTest(db, lineupId, gameIdAt(games, 4), firstInvitee);
  await nominateGameForTest(db, lineupId, gameIdAt(games, 5), secondInvitee);
}

/**
 * DECIDED (AC1 phase coverage): build → nominate → voting → a vote → flip to
 * `decided` with a `decidedGameId`. No helper for the decided transition —
 * the brief calls for a direct update.
 */
async function seedDecidedLineup(
  db: Db,
  creator: number,
  users: User[],
  games: Game[],
): Promise<void> {
  const lineupId = await createDemoLineup(db, DEMO_LINEUP_TITLES[2], creator);
  const decidedGameId = gameIdAt(games, 6);
  await nominateGameForTest(db, lineupId, decidedGameId, userIdAt(users, 9));
  await nominateGameForTest(
    db,
    lineupId,
    gameIdAt(games, 7),
    userIdAt(users, 10),
  );
  await advanceLineupToVotingForTest(db, lineupId);
  await castVoteForTest(db, lineupId, decidedGameId, userIdAt(users, 9));
  await castVoteForTest(db, lineupId, decidedGameId, userIdAt(users, 11));
  await db
    .update(schema.communityLineups)
    .set({
      status: 'decided',
      decidedGameId,
      updatedAt: new Date(),
    })
    .where(eq(schema.communityLineups.id, lineupId));
}

/**
 * ARCHIVED (AC1 fallback header): a minimal lineup parked in `archived`.
 * Archived directly via update (the test helper does the same) rather than
 * importing the smoke-test archive helper, since the title is fixed here.
 */
async function seedArchivedLineup(
  db: Db,
  creator: number,
  users: User[],
  games: Game[],
): Promise<void> {
  const lineupId = await createDemoLineup(db, DEMO_LINEUP_TITLES[3], creator);
  await nominateGameForTest(
    db,
    lineupId,
    gameIdAt(games, 8),
    userIdAt(users, 12),
  );
  await db
    .update(schema.communityLineups)
    .set({ status: 'archived', updatedAt: new Date() })
    .where(eq(schema.communityLineups.id, lineupId));
}

/** True when any demo lineup (by title) already exists — idempotency guard. */
async function demoLineupsExist(db: Db): Promise<boolean> {
  const existing = await db
    .select({ id: schema.communityLineups.id })
    .from(schema.communityLineups)
    .where(inArray(schema.communityLineups.title, [...DEMO_LINEUP_TITLES]))
    .limit(1);
  return existing.length > 0;
}

/**
 * Seed the demo community lineup set. Requires the demo users + games to
 * already exist (call AFTER `installCoreEntities`). Skips entirely when the
 * demo lineups are already present, so it's safe to call on a fresh install
 * or after a `reset-to-seed` wipe.
 *
 * Returns the number of lineups created (0 when skipped) for logging.
 */
export async function installCommunityLineups(
  db: Db,
  allUsers: User[],
  allGames: Game[],
): Promise<{ lineups: number }> {
  // Need a creator + several distinct nominators/voters and distinct games.
  if (allUsers.length < 13 || allGames.length < 9) {
    logger.warn(
      `Skipping community lineups: need ≥13 users + ≥9 games, ` +
        `got ${allUsers.length} users / ${allGames.length} games.`,
    );
    return { lineups: 0 };
  }
  if (await demoLineupsExist(db)) {
    logger.debug('Demo community lineups already present — skipping.');
    return { lineups: 0 };
  }

  const creator = userIdAt(allUsers, 0);
  await seedPublicVotingLineup(db, creator, allUsers, allGames);
  await seedPrivateBuildingLineup(db, creator, allUsers, allGames);
  await seedDecidedLineup(db, creator, allUsers, allGames);
  await seedArchivedLineup(db, creator, allUsers, allGames);

  logger.debug(`Seeded ${DEMO_LINEUP_TITLES.length} demo community lineups.`);
  return { lineups: DEMO_LINEUP_TITLES.length };
}
