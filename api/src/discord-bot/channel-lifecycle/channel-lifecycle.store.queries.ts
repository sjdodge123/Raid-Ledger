import { and, eq, isNull } from 'drizzle-orm';
import * as schema from '../../drizzle/schema';
import type { LifecycleDb } from './channel-lifecycle.store';

/**
 * ROK-1431 §2.5 step 3 pre-check: the non-series game-announcements binding
 * for a game, if one appeared since the activity read (e.g. a manual bind).
 */
export async function findGameAnnouncementBinding(
  db: LifecycleDb,
  guildId: string,
  gameId: number,
): Promise<{ id: string } | null> {
  const [row] = await db
    .select({ id: schema.channelBindings.id })
    .from(schema.channelBindings)
    .where(
      and(
        eq(schema.channelBindings.guildId, guildId),
        eq(schema.channelBindings.gameId, gameId),
        eq(schema.channelBindings.bindingPurpose, 'game-announcements'),
        isNull(schema.channelBindings.recurrenceGroupId),
      ),
    )
    .limit(1);
  return row ?? null;
}
