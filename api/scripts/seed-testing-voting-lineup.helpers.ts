/**
 * Seed a long-tail demo voting lineup for ROK-1298 Sv composite testing.
 *
 * Operator request 2026-05-19: the Sv composite's sticky-hero behavior
 * only shines when the leaderboard is long enough to scroll past. The
 * standalone smoke fixture (4 entries, 1 voter) doesn't surface that.
 *
 * This helper creates ONE deterministic public lineup:
 *   - Title: "Sv Demo — Voting (25 games · 6 voters)"
 *   - 25 nominated games (first 25 unique-named games from the games table)
 *   - 6 voters from FAKE_GAMERS (created by seedUsers)
 *   - ~30 sample votes distributed across the 25 games so vote-count
 *     fractions vary (1/6, 2/6, 3/6 etc.) — exercises the bar normalization
 *     visual at multiple precisions.
 *
 * Idempotent: if a lineup with the same title exists, skip.
 */
import { eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../src/drizzle/schema';
import { nanoid } from 'nanoid';

type Db = PostgresJsDatabase<typeof schema>;

const DEMO_TITLE = 'Sv Demo — Voting (25 games · 6 voters)';

/** Deterministic vote-count distribution across 25 games. Sum = 18 over 6 voters. */
const VOTE_DISTRIBUTION = [
  6, 5, 3, 2, 1, 1, // top 6 — varied (6/6 = full, 5/6 = strong, etc)
  0, 0, 0, 0, 0,
  0, 0, 0, 0, 0,
  0, 0, 0, 0, 0,
  0, 0, 0, 0, // bottom 19 zero-vote rows exercise the bar floor
];

export async function seedVotingLineup(
  db: Db,
  createdUsers: schema.User[],
): Promise<void> {
  console.log('🗳️  Seeding Sv demo voting lineup...');

  const existing = await db
    .select({ id: schema.communityLineups.id })
    .from(schema.communityLineups)
    .where(eq(schema.communityLineups.title, DEMO_TITLE))
    .limit(1);
  if (existing.length > 0) {
    console.log(`  ⏭️  Skipped — already exists (lineup #${existing[0].id})`);
    return;
  }

  const admin = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.username, 'Admin'))
    .limit(1)
    .then((rows) => rows[0]);
  if (!admin) {
    console.warn('  ⚠️  No Admin user found — skipping voting lineup seed');
    return;
  }

  // 6 voters: Admin (creator) + 5 fake gamers. Lineup is PRIVATE so
  // votingEligibleCount = 1 (creator) + 5 (invitees, none is creator) = 6.
  // Operator wants the bar denominator to track the demo voter pool, not
  // the full 100+ community member count of a public lineup.
  const invitees = createdUsers.slice(0, 5);
  const voters = [admin, ...invitees];
  if (invitees.length < 5) {
    console.warn(
      `  ⚠️  Need 5 fake gamers, found ${invitees.length} — skipping voting lineup seed`,
    );
    return;
  }

  // Pick 25 deterministically-ordered games (by id ASC) with unique names so
  // we don't fall into the dup-name trap (CLAUDE.md "Games-table INSERT paths
  // must use the name-dedup guard").
  const candidates = await db
    .select({
      id: schema.games.id,
      name: schema.games.name,
    })
    .from(schema.games)
    .orderBy(schema.games.id)
    .limit(60);
  const seen = new Set<string>();
  const picked: { id: number; name: string }[] = [];
  for (const g of candidates) {
    if (seen.has(g.name)) continue;
    seen.add(g.name);
    picked.push(g);
    if (picked.length >= 25) break;
  }
  if (picked.length < 25) {
    console.warn(
      `  ⚠️  Need 25 unique-named games, found ${picked.length} — skipping`,
    );
    return;
  }

  // Insert the lineup row.
  const phaseDeadline = new Date(Date.now() + 26 * 60 * 60 * 1000);
  const [lineup] = await db
    .insert(schema.communityLineups)
    .values({
      title: DEMO_TITLE,
      description: 'Long-tail demo for the Sv voting composite.',
      status: 'voting',
      visibility: 'private',
      createdBy: admin.id,
      phaseDeadline,
      maxVotesPerPlayer: 3,
      publicSlug: nanoid(12),
      publicShareEnabled: false,
    })
    .returning();
  console.log(`  ✅ Created lineup #${lineup.id} (private)`);

  // 5 invitees so eligibleCount = 1 (creator) + 5 (invitees) = 6 voters.
  await db.insert(schema.communityLineupInvitees).values(
    invitees.map((u) => ({ lineupId: lineup.id, userId: u.id })),
  );
  console.log(`  ✅ Invited ${invitees.length} voters`);

  // Insert 25 entries (Admin is the nominator for all — fine for demo).
  await db.insert(schema.communityLineupEntries).values(
    picked.map((g) => ({
      lineupId: lineup.id,
      gameId: g.id,
      nominatedBy: admin.id,
    })),
  );
  console.log(`  ✅ Nominated ${picked.length} games`);

  // Distribute sample votes per VOTE_DISTRIBUTION. Pick `n` voters for each
  // game's vote count, rotating through the voter pool so each voter casts
  // roughly the expected 30/6 = 5 votes (≈ max-votes-per-player cap of 3
  // with a few overflowing to keep the data realistic).
  const voteRows: {
    lineupId: number;
    userId: number;
    gameId: number;
  }[] = [];
  let voterCursor = 0;
  for (let i = 0; i < picked.length; i++) {
    const n = VOTE_DISTRIBUTION[i];
    for (let j = 0; j < n; j++) {
      const voter = voters[voterCursor % voters.length];
      voteRows.push({
        lineupId: lineup.id,
        userId: voter.id,
        gameId: picked[i].id,
      });
      voterCursor++;
    }
  }

  if (voteRows.length > 0) {
    // Some voters will land on the same game twice through rotation — dedupe
    // via the natural unique constraint, ignoring conflicts so the seed is
    // self-healing.
    await db
      .insert(schema.communityLineupVotes)
      .values(voteRows)
      .onConflictDoNothing();
  }

  const placed = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.communityLineupVotes)
    .where(eq(schema.communityLineupVotes.lineupId, lineup.id));
  console.log(`  ✅ Recorded ${placed[0]?.count ?? 0} sample votes`);
}
