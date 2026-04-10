/**
 * Tiebreaker response mapping (ROK-938).
 * Maps DB rows to contract response shapes.
 */
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { TiebreakerDetailDto } from '@raid-ledger/contract';
import * as schema from '../../drizzle/schema';
import {
  findMatchups,
  countMatchupVotes,
  findUserBracketVote,
} from './tiebreaker-query.helpers';
import {
  getCurrentRound,
  getTotalRounds,
  nextPowerOf2,
} from './tiebreaker-bracket.helpers';
import { buildVetoStatus } from './tiebreaker-veto.helpers';

type Db = PostgresJsDatabase<typeof schema>;
type TiebreakerRow = typeof schema.communityLineupTiebreakers.$inferSelect;

/** Fetch game name + cover URL map for a list of game IDs. */
async function fetchGameMap(db: Db, gameIds: number[]) {
  if (gameIds.length === 0) return new Map();
  const rows = await db
    .select({
      id: schema.games.id,
      name: schema.games.name,
      coverUrl: schema.games.coverUrl,
    })
    .from(schema.games)
    .where(
      gameIds.length === 1
        ? eq(schema.games.id, gameIds[0])
        : eq(schema.games.id, gameIds[0]), // fallback; real impl below
    );
  // Re-fetch properly for multiple IDs
  const allRows =
    gameIds.length > 1
      ? await db
          .select({
            id: schema.games.id,
            name: schema.games.name,
            coverUrl: schema.games.coverUrl,
          })
          .from(schema.games)
      : rows;
  const map = new Map<number, { name: string; coverUrl: string | null }>();
  for (const r of allRows) {
    if (gameIds.includes(r.id)) {
      map.set(r.id, { name: r.name, coverUrl: r.coverUrl });
    }
  }
  return map;
}

/** Build a single matchup response. */
async function mapMatchup(
  db: Db,
  m: typeof schema.communityLineupTiebreakerBracketMatchups.$inferSelect,
  gameMap: Map<number, { name: string; coverUrl: string | null }>,
  currentRound: number,
  userId?: number,
) {
  const votes = await countMatchupVotes(db, m.id);
  const aVotes = votes.find((v) => v.gameId === m.gameAId)?.count ?? 0;
  const bVotes = votes.find((v) => v.gameId === m.gameBId)?.count ?? 0;
  const userVote = userId ? await findUserBracketVote(db, m.id, userId) : [];
  const isActive = m.round === currentRound && !m.winnerGameId && !m.isBye;
  const isCompleted = !!m.winnerGameId;

  const gameA = gameMap.get(m.gameAId);
  const gameB = m.gameBId ? gameMap.get(m.gameBId) : null;

  return {
    id: m.id,
    round: m.round,
    position: m.position,
    gameA: {
      gameId: m.gameAId,
      gameName: gameA?.name ?? `Game ${m.gameAId}`,
      gameCoverUrl: gameA?.coverUrl ?? null,
      originalVoteCount: 0,
    },
    gameB: gameB
      ? {
          gameId: m.gameBId!,
          gameName: gameB.name,
          gameCoverUrl: gameB.coverUrl ?? null,
          originalVoteCount: 0,
        }
      : null,
    isBye: m.isBye,
    winnerGameId: m.winnerGameId,
    voteCountA: aVotes,
    voteCountB: bVotes,
    myVote: userVote[0]?.gameId ?? null,
    isActive,
    isCompleted,
  };
}

/** Build full bracket matchups array. */
async function buildBracketMatchups(
  db: Db,
  tiebreaker: TiebreakerRow,
  userId?: number,
) {
  const matchups = await findMatchups(db, tiebreaker.id);
  if (matchups.length === 0) return [];

  const allGameIds = new Set<number>();
  for (const m of matchups) {
    allGameIds.add(m.gameAId);
    if (m.gameBId) allGameIds.add(m.gameBId);
  }
  const gameMap = await fetchGameMap(db, [...allGameIds]);
  const currentRound = await getCurrentRound(db, tiebreaker.id);

  return Promise.all(
    matchups.map((m) => mapMatchup(db, m, gameMap, currentRound, userId)),
  );
}

/** Build the full tiebreaker detail response. */
export async function buildTiebreakerDetail(
  db: Db,
  tiebreaker: TiebreakerRow,
  userId?: number,
): Promise<TiebreakerDetailDto> {
  const tiedGameIds = tiebreaker.tiedGameIds;
  const gameMap = await fetchGameMap(db, tiedGameIds);

  const isBracket = tiebreaker.mode === 'bracket';
  const matchups = isBracket
    ? await buildBracketMatchups(db, tiebreaker, userId)
    : null;
  const vetoStatus = !isBracket
    ? await buildVetoStatus(db, tiebreaker, userId, gameMap)
    : null;

  const bracketSize = nextPowerOf2(tiedGameIds.length);
  const currentRound = isBracket
    ? await getCurrentRound(db, tiebreaker.id)
    : null;
  const totalRounds = isBracket ? getTotalRounds(bracketSize) : null;

  return {
    id: tiebreaker.id,
    lineupId: tiebreaker.lineupId,
    mode: tiebreaker.mode,
    status: tiebreaker.status,
    tiedGameIds,
    originalVoteCount: tiebreaker.originalVoteCount,
    winnerGameId: tiebreaker.winnerGameId,
    roundDeadline: tiebreaker.roundDeadline?.toISOString() ?? null,
    resolvedAt: tiebreaker.resolvedAt?.toISOString() ?? null,
    currentRound,
    totalRounds,
    matchups,
    vetoStatus,
  };
}
