/**
 * Community-wide archetype re-titling (ROK-1939 D6-D8).
 *
 * The vector title is community-relative (`archetype-community.helpers.ts`),
 * so a player's noun can change when OTHER players change. The daily
 * aggregate therefore re-titles every profile after its per-user loop
 * (`retitleAllArchetypes`, D7), and the weekly intensity job computes the
 * same community once per run (`loadCommunityAxisStats`, D8).
 *
 * D6 community = every ACTIVE user with a `player_taste_vectors` row whose
 * dimensions are not all zero (Newcomers included).
 */
import { eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  TASTE_PROFILE_AXIS_POOL,
  type TasteProfileDimensionsDto,
} from '@raid-ledger/contract';
import * as schema from '../drizzle/schema';
import { activeUsersFilter } from '../users/users-active.helpers';
import {
  computeCommunityAxisStats,
  type CommunityAxisStats,
} from './archetype-community.helpers';
import {
  loadPresenceUserIds,
  retitleFromIntensity,
} from './archetype-retitle.helpers';

type Db = PostgresJsDatabase<typeof schema>;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

function hasSignal(dimensions: TasteProfileDimensionsDto): boolean {
  return TASTE_PROFILE_AXIS_POOL.some((axis) => dimensions[axis] !== 0);
}

/** D6 — community stats over the given rows (active, non-zero only). */
export function communityFromRows(
  rows: ReadonlyArray<{
    active: boolean;
    dimensions: TasteProfileDimensionsDto;
  }>,
): CommunityAxisStats {
  return computeCommunityAxisStats(
    rows
      .filter((r) => r.active && hasSignal(r.dimensions))
      .map((r) => r.dimensions),
  );
}

/** D6 community stats read from the stored dimensions (no row lock). */
export async function loadCommunityAxisStats(
  db: Db | Tx,
): Promise<CommunityAxisStats> {
  const rows = await db
    .select({ dimensions: schema.playerTasteVectors.dimensions })
    .from(schema.playerTasteVectors)
    .innerJoin(
      schema.users,
      eq(schema.users.id, schema.playerTasteVectors.userId),
    )
    .where(activeUsersFilter());
  return communityFromRows(rows.map((r) => ({ ...r, active: true })));
}

/** Every vector row (with its owner's active flag), locked FOR UPDATE. */
function lockVectorRows(tx: Tx) {
  return tx
    .select({
      userId: schema.playerTasteVectors.userId,
      dimensions: schema.playerTasteVectors.dimensions,
      intensityMetrics: schema.playerTasteVectors.intensityMetrics,
      active: sql<boolean>`${schema.users.deactivatedAt} IS NULL`,
    })
    .from(schema.playerTasteVectors)
    .innerJoin(
      schema.users,
      eq(schema.users.id, schema.playerTasteVectors.userId),
    )
    .for('update', { of: schema.playerTasteVectors });
}

/**
 * D7 — re-derive every stored archetype against the current community.
 * One transaction: the rows are locked `FOR UPDATE` before they are read,
 * so a concurrent weekly-intensity write cannot be overwritten with stale
 * metrics, and all titles land in one batched `UPDATE … FROM (VALUES …)`.
 * Returns the number of rows re-titled.
 */
export async function retitleAllArchetypes(db: Db): Promise<number> {
  return db.transaction(async (tx) => {
    const rows = await lockVectorRows(tx);
    if (rows.length === 0) return 0;
    const community = communityFromRows(rows);
    const presenceUserIds = await loadPresenceUserIds(tx);
    const valueTuples = rows.map((row) => {
      const { archetype } = retitleFromIntensity(
        row.intensityMetrics,
        row.dimensions,
        presenceUserIds.has(row.userId),
        community,
      );
      return sql`(${row.userId}::integer, ${JSON.stringify(archetype)}::jsonb)`;
    });
    await tx.execute(sql`
      UPDATE ${schema.playerTasteVectors} AS t
      SET archetype = v.archetype
      FROM (VALUES ${sql.join(valueTuples, sql`, `)}) AS v(user_id, archetype)
      WHERE t.user_id = v.user_id
    `);
    return rows.length;
  });
}
