/**
 * Bracket tiebreaker helpers (ROK-938).
 * Build bracket, seed matchups, advance rounds.
 */
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import { countMatchupVotes, findMatchups } from './tiebreaker-query.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/** Pad to next power of 2 (min 4). */
export function nextPowerOf2(n: number): number {
  const p = Math.max(4, Math.pow(2, Math.ceil(Math.log2(n))));
  return Math.min(p, 8);
}

/** Standard bracket seeding order for size N. */
function seedOrder(size: number): number[] {
  if (size === 2) return [0, 1];
  const half = seedOrder(size / 2);
  return half.flatMap((i) => [i, size - 1 - i]);
}

/**
 * Build round-1 bracket matchups from tied game IDs.
 * Sorts by original vote count for seeding. Pads to power of 2 with byes.
 */
export async function buildBracket(
  db: Db,
  tiebreakerId: number,
  tiedGameIds: number[],
): Promise<void> {
  const size = nextPowerOf2(tiedGameIds.length);
  const padded = [...tiedGameIds];
  while (padded.length < size) padded.push(-1); // -1 = bye placeholder

  const order = seedOrder(size);
  const seeded = order.map((i) => padded[i]);
  const matchups = [];

  for (let i = 0; i < seeded.length; i += 2) {
    const gameA = seeded[i];
    const gameB = seeded[i + 1];
    const isBye = gameA === -1 || gameB === -1;
    const realA = gameA === -1 ? gameB : gameA;
    const realB = gameB === -1 ? null : gameB === realA ? null : gameB;

    matchups.push({
      tiebreakerId,
      round: 1,
      position: i / 2,
      gameAId: realA,
      gameBId: realB,
      isBye,
      winnerGameId: isBye ? realA : null,
    });
  }

  await db
    .insert(schema.communityLineupTiebreakerBracketMatchups)
    .values(matchups);
}

/** Get the current (highest incomplete) round number. */
export async function getCurrentRound(
  db: Db,
  tiebreakerId: number,
): Promise<number> {
  const matchups = await findMatchups(db, tiebreakerId);
  const incomplete = matchups.filter((m) => !m.winnerGameId && !m.isBye);
  if (incomplete.length === 0) {
    const maxRound = Math.max(...matchups.map((m) => m.round), 1);
    return maxRound;
  }
  return Math.min(...incomplete.map((m) => m.round));
}

/** Get total number of rounds based on bracket size. */
export function getTotalRounds(bracketSize: number): number {
  return Math.ceil(Math.log2(bracketSize));
}

/** Resolve a matchup winner using vote counts. Tiebreak: gameA (higher seed). */
export async function resolveMatchupWinner(
  db: Db,
  matchupId: number,
  matchup: typeof schema.communityLineupTiebreakerBracketMatchups.$inferSelect,
): Promise<number> {
  const votes = await countMatchupVotes(db, matchupId);
  const aVotes = votes.find((v) => v.gameId === matchup.gameAId)?.count ?? 0;
  const bVotes = votes.find((v) => v.gameId === matchup.gameBId)?.count ?? 0;
  return aVotes >= bVotes ? matchup.gameAId : matchup.gameBId!;
}

/**
 * Advance the bracket by resolving current round and creating next.
 * Returns the final winner game ID if the bracket is complete, else null.
 */
export async function advanceBracket(
  db: Db,
  tiebreakerId: number,
): Promise<number | null> {
  const matchups = await findMatchups(db, tiebreakerId);
  const currentRound = await getCurrentRound(db, tiebreakerId);
  const roundMatchups = matchups.filter((m) => m.round === currentRound);

  // Resolve any unresolved matchups in current round
  for (const m of roundMatchups) {
    if (!m.winnerGameId && !m.isBye) {
      const winner = await resolveMatchupWinner(db, m.id, m);
      await setMatchupWinner(db, m.id, winner);
      m.winnerGameId = winner;
    }
  }

  // Check if this was the final round
  if (roundMatchups.length === 1) {
    return roundMatchups[0].winnerGameId;
  }

  // Create next round matchups
  const winners = roundMatchups
    .sort((a, b) => a.position - b.position)
    .map((m) => m.winnerGameId!);

  await createNextRoundMatchups(db, tiebreakerId, currentRound + 1, winners);
  return null;
}

async function setMatchupWinner(
  db: Db,
  matchupId: number,
  winnerGameId: number,
) {
  await db
    .update(schema.communityLineupTiebreakerBracketMatchups)
    .set({ winnerGameId })
    .where(eq(schema.communityLineupTiebreakerBracketMatchups.id, matchupId));
}

async function createNextRoundMatchups(
  db: Db,
  tiebreakerId: number,
  round: number,
  winners: number[],
) {
  const matchups = [];
  for (let i = 0; i < winners.length; i += 2) {
    const gameA = winners[i];
    const gameB = winners[i + 1] ?? null;
    matchups.push({
      tiebreakerId,
      round,
      position: i / 2,
      gameAId: gameA,
      gameBId: gameB,
      isBye: gameB === null,
      winnerGameId: gameB === null ? gameA : null,
    });
  }
  await db
    .insert(schema.communityLineupTiebreakerBracketMatchups)
    .values(matchups);
}
