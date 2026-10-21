import { and, count, eq, isNull, ne } from 'drizzle-orm';
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

/**
 * Codex r7 P1 apply-time re-check: other bindings on `channelId` besides
 * `bindingId` (one may have appeared since the activity read).
 */
export async function countOtherChannelBindings(
  db: LifecycleDb,
  channelId: string,
  bindingId: string,
): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(schema.channelBindings)
    .where(
      and(
        eq(schema.channelBindings.channelId, channelId),
        ne(schema.channelBindings.id, bindingId),
      ),
    );
  return row?.n ?? 0;
}

/**
 * The binding columns a reconcile re-validates before acting (Codex r9 P2),
 * incl. the routing fields `updateConfig()` can reassign (Codex r10 P2).
 */
export interface LockedBindingState {
  channelId: string;
  autoManaged: boolean;
  pinned: boolean;
  lifecycleState: string;
  gameId: number | null;
  bindingPurpose: string;
  recurrenceGroupId: string | null;
}

/**
 * Codex r9 P2: re-read one binding on the game's tx and row-lock it
 * (`FOR UPDATE`) so a concurrent pin / unbind / re-point waits for — or is
 * seen by — this game's apply. Null when the binding is gone.
 */
export async function lockLifecycleBinding(
  db: LifecycleDb,
  bindingId: string,
): Promise<LockedBindingState | null> {
  const b = schema.channelBindings;
  const [row] = await db
    .select({
      channelId: b.channelId,
      autoManaged: b.autoManaged,
      pinned: b.pinned,
      lifecycleState: b.lifecycleState,
      gameId: b.gameId,
      bindingPurpose: b.bindingPurpose,
      recurrenceGroupId: b.recurrenceGroupId,
    })
    .from(b)
    .where(eq(b.id, bindingId))
    .for('update');
  return row ?? null;
}
