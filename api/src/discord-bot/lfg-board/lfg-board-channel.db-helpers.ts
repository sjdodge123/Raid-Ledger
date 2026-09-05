/**
 * ROK-1471 D3a — the one read `LfgBoardChannelService` makes against Postgres.
 *
 * Split out of the service for the same reason 1454 split `lfm-embed.db-helpers`:
 * the service's job is *choosing* a forum, and that choice is only unit-testable
 * if the binding lookup can be replaced. `ChannelBindingsService` is at 291 of
 * its 300 counted lines, so the query lives here rather than as a method there.
 */
import { and, eq } from 'drizzle-orm';
import * as schema from '../../drizzle/schema';
import type { LfgDb } from '../../lfg/lfg-query.helpers';
import { LFG_BOARD_BINDING_PURPOSE } from './lfg-board.constants';

/**
 * The channel id of the guild's manual `lfg-board` binding, if one exists.
 *
 * This is an override only (D3): the bot creates and owns the forum by
 * default, and an operator who wants a different one binds it by hand. The
 * binding is not validated here — the caller fetches the channel and rejects
 * anything that is not a forum, because a binding can outlive its channel.
 *
 * @param db - Drizzle handle.
 * @param guildId - Guild whose override is being looked up.
 * @returns The bound channel id, or null when the guild has no override.
 */
export async function findLfgBoardBindingChannelId(
  db: LfgDb,
  guildId: string,
): Promise<string | null> {
  const rows = await db
    .select({ channelId: schema.channelBindings.channelId })
    .from(schema.channelBindings)
    .where(
      and(
        eq(schema.channelBindings.guildId, guildId),
        eq(schema.channelBindings.bindingPurpose, LFG_BOARD_BINDING_PURPOSE),
      ),
    )
    .limit(1);
  return rows[0]?.channelId ?? null;
}
