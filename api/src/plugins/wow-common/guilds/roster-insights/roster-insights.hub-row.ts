import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { GuildKind } from '@raid-ledger/contract';
import * as schema from '../../../../drizzle/schema';
import type { RaidHubRow } from './roster-insights.raid-progress';

/**
 * The hub row roster-insights reads once per compute: the hub kind (which
 * picks the roster adapter), its latest snapshot time (the export the presence
 * rows are from), the ROK-1917 pull scope and the ROK-1927 game slug.
 */
export interface InsightsHubRow extends RaidHubRow {
  kind: GuildKind;
  at: string | null;
  gameSlug: string | null;
}

/** Load the hub row for `guildId`; null when the guild does not exist. */
export async function loadInsightsHubRow(
  db: PostgresJsDatabase<typeof schema>,
  guildId: number,
): Promise<InsightsHubRow | null> {
  const g = schema.guilds;
  const [row] = await db
    .select({
      at: g.lastSnapshotAt,
      gameId: g.gameId,
      region: g.region,
      nameKey: g.nameKey,
      kind: g.kind,
      gameSlug: schema.games.slug,
    })
    .from(g)
    .leftJoin(schema.games, eq(schema.games.id, g.gameId))
    .where(eq(g.id, guildId))
    .limit(1);
  return row ? { ...row, at: row.at ? row.at.toISOString() : null } : null;
}
