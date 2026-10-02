/**
 * Collision PREVENTION for partial unique indexes touched by the dedup FK
 * reassignment (ROK-1008). `getConflictColumns` in
 * `igdb-dedup-fk-reassign.helpers.ts` only understands plain column tuples;
 * a partial index needs its WHERE predicate applied to both sides too.
 *
 * These must run BEFORE the reassign UPDATE. Under postgres.js a failed
 * statement poisons the whole transaction — `ROLLBACK TO SAVEPOINT` does not
 * contain it — so catching the 23505 is not an option. Each helper issues one
 * statement that cannot violate, leaving the later UPDATE nothing to collide on.
 */
import { sql } from 'drizzle-orm';
import type { Tx } from './igdb-dedup-fk-reassign.helpers';

/**
 * Clear `is_main` on the loser's characters where the same user already has a
 * main on the winner, so the partial unique index `idx_one_main_per_game`
 * (user_id, game_id) WHERE is_main cannot see two mains for one (user, game)
 * after reassignment.
 */
export async function demoteDuplicateMains(
  tx: Tx,
  loserId: number,
  winnerId: number,
): Promise<void> {
  await tx.execute(
    sql.raw(
      `UPDATE characters l
          SET is_main = false
        WHERE l.game_id = ${loserId}
          AND l.is_main = true
          AND EXISTS (
            SELECT 1 FROM characters w
             WHERE w.game_id = ${winnerId}
               AND w.user_id = l.user_id
               AND w.is_main = true
          )`,
    ),
  );
}

/**
 * Drop the loser's non-series channel bindings that would collide with one the
 * winner already holds (TDB:229 / TDB:254). Index
 * `channel_bindings_nonseries_game_unique` is on
 * (guild_id, channel_id, binding_purpose, game_id)
 * WHERE recurrence_group_id IS NULL AND game_id IS NOT NULL — so a loser
 * `game-voice-monitor` on a channel the winner also monitors would, once
 * repointed, duplicate the winner's row.
 *
 * Policy: keep the WINNER's binding, drop the loser's duplicate — the same rule
 * the other tables in `getConflictColumns` follow. Series rows
 * (recurrence_group_id NOT NULL) are excluded: their index
 * (guild_id, channel_id, recurrence_group_id) has no game_id, so repointing
 * cannot collide. `game_id IS NOT NULL` is implied by the id equalities.
 */
export async function dropCollidingChannelBindings(
  tx: Tx,
  loserId: number,
  winnerId: number,
): Promise<void> {
  await tx.execute(
    sql.raw(
      `DELETE FROM channel_bindings AS l
        USING channel_bindings AS w
        WHERE l.game_id = ${loserId}
          AND w.game_id = ${winnerId}
          AND l.recurrence_group_id IS NULL
          AND w.recurrence_group_id IS NULL
          AND l.guild_id = w.guild_id
          AND l.channel_id = w.channel_id
          AND l.binding_purpose = w.binding_purpose`,
    ),
  );
}

/**
 * Distinct Discord channels holding a binding for `gameId`. Read before the
 * reassignment so the caller can tell the per-channel binding caches which
 * entries the merge rewrote (repointed or dropped as colliding).
 *
 * Raw `execute`, not the select builder — the result is a plain row list.
 */
export async function selectBindingChannelIdsForGame(
  tx: Tx,
  gameId: number,
): Promise<string[]> {
  const rows: unknown = await tx.execute(
    sql`SELECT DISTINCT channel_id FROM channel_bindings WHERE game_id = ${gameId}`,
  );
  const list = Array.isArray(rows) ? (rows as { channel_id: unknown }[]) : [];
  return list.map((r) => String(r.channel_id));
}

/** Append `gameId`'s bound channels to `sink`; no read when there is no sink. */
export async function collectBindingChannelIds(
  tx: Tx,
  gameId: number,
  sink: string[] | undefined,
): Promise<void> {
  if (sink) sink.push(...(await selectBindingChannelIdsForGame(tx, gameId)));
}
