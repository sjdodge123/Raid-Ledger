import { Logger } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';

/**
 * The characters table carries TWO unique keys that include game_id. Game
 * merge helpers re-point characters between game rows and must detect a
 * collision on either one, so both share this join builder (ROK-1721).
 *
 *   1. unique_user_game_character       (user_id, game_id, name, realm)
 *   2. idx_characters_ruleset_identity  (game_id, region, lower(name))
 *                                       WHERE ruleset IS NOT NULL
 */
export function characterUniqueKeyJoin(l: string, r: string): string {
  const perUser = ['user_id', 'name', 'realm']
    .map((c) => `${l}.${c} IS NOT DISTINCT FROM ${r}.${c}`)
    .join(' AND ');
  const forever =
    `${l}.ruleset IS NOT NULL AND ${r}.ruleset IS NOT NULL` +
    ` AND ${l}.region = ${r}.region AND lower(${l}.name) = lower(${r}.name)`;
  return `((${perUser}) OR (${forever}))`;
}

const logger = new Logger('CharacterUniqueKeys');

/** Anything that can run raw SQL — a db or a transaction handle. */
interface SqlExecutor {
  execute(query: SQL): Promise<unknown>;
}

interface CrossOwnerRow {
  loser_character_id: string;
  loser_user_id: number;
  winner_character_id: string;
  winner_user_id: number;
}

/**
 * A game merge pre-deletes each losing-game character that collides with a
 * winning-game one. On the per-user key both rows share an owner, but the
 * Forever key spans players — so the delete can drop a character that belongs
 * to a DIFFERENT player than the winner's. Run before that delete: logs one
 * structured warning per such row (with ids) and returns how many there are.
 */
export async function reportCrossOwnerCharacterDeletes(
  tx: SqlExecutor,
  loserGameId: number,
  winnerGameId: number,
): Promise<number> {
  const result = await tx.execute(
    sql.raw(
      `SELECT DISTINCT ON (l.id) l.id AS loser_character_id,
              l.user_id AS loser_user_id, w.id AS winner_character_id,
              w.user_id AS winner_user_id
       FROM characters AS l
       JOIN characters AS w ON ${characterUniqueKeyJoin('l', 'w')}
       WHERE l.game_id = ${loserGameId} AND w.game_id = ${winnerGameId}
         AND l.user_id <> w.user_id`,
    ),
  );
  const rows = Array.from((result ?? []) as Iterable<CrossOwnerRow>);
  logCrossOwnerDeletes(rows, { loserGameId, winnerGameId });
  return rows.length;
}

function logCrossOwnerDeletes(
  rows: CrossOwnerRow[],
  games: { loserGameId: number; winnerGameId: number },
): void {
  for (const row of rows)
    logger.warn({
      event: 'game_merge_cross_owner_character_delete',
      ...games,
      loserCharacterId: row.loser_character_id,
      loserUserId: row.loser_user_id,
      winnerCharacterId: row.winner_character_id,
      winnerUserId: row.winner_user_id,
    });
  if (rows.length > 0)
    logger.warn({
      event: 'game_merge_cross_owner_character_delete_count',
      ...games,
      count: rows.length,
    });
}
