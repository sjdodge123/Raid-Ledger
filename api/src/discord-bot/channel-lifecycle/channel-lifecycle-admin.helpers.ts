import { eq } from 'drizzle-orm';
import type {
  ChannelLifecycleSettingsDto,
  GameLifecycleActivityDto,
  LifecycleSuppressionDto,
} from '@raid-ledger/contract';
import * as schema from '../../drizzle/schema';
import { decideGame } from './channel-lifecycle.decide';
import type { LifecycleDb } from './channel-lifecycle.store';
import type {
  GameLifecycleActivityRow,
  LifecycleCandidateBinding,
} from './game-activity.types';

/** The binding slice the activity table shows. */
function toBindingSummary(
  b: LifecycleCandidateBinding,
): NonNullable<GameLifecycleActivityDto['binding']> {
  const { id, channelId, lifecycleState, autoManaged, pinned } = b;
  return { id, channelId, lifecycleState, autoManaged, pinned };
}

/** ROK-1432 — map one derived activity row to the admin `GET activity` item. */
export function toActivityDto(
  row: GameLifecycleActivityRow,
  settings: ChannelLifecycleSettingsDto,
): GameLifecycleActivityDto {
  const { action, reason } = decideGame(row, settings);
  const b = row.binding;
  return {
    gameId: row.gameId,
    gameName: row.gameName,
    gameSlug: row.gameSlug,
    signals: row.signals.map((s) => ({
      kind: s.kind,
      itemCount: s.itemCount,
      lastActivityAt: s.lastActivityAt.toISOString(),
    })),
    itemCount: row.itemCount,
    lastActivityAt: row.lastActivityAt?.toISOString() ?? null,
    hubHold: row.hubHold,
    suppressed: row.suppressed,
    binding: b ? toBindingSummary(b) : null,
    action,
    reason,
  };
}

/** Default `GET activity` view: games with signals or a candidate binding. */
export function isListed(row: GameLifecycleActivityRow): boolean {
  return row.itemCount > 0 || row.binding !== null || row.suppressed;
}

/** The guild's suppressions, newest first, with the game name. */
export async function selectSuppressions(
  db: LifecycleDb,
  guildId: string,
): Promise<LifecycleSuppressionDto[]> {
  const s = schema.channelLifecycleSuppressions;
  const rows = await db
    .select({
      gameId: s.gameId,
      gameName: schema.games.name,
      reason: s.reason,
      createdAt: s.createdAt,
    })
    .from(s)
    .innerJoin(schema.games, eq(s.gameId, schema.games.id))
    .where(eq(s.guildId, guildId))
    .orderBy(s.createdAt);
  return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
}
