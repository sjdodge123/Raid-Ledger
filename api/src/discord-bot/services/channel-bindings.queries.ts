import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import type { BindingRecord } from './channel-bindings.service';

/** A binding row with its game's name left-joined (null when no game). */
export type BindingWithGameName = BindingRecord & { gameName: string | null };

/** Every binding in a guild, each with its game's name joined in. */
export async function selectBindingsWithGameNames(
  db: PostgresJsDatabase<typeof schema>,
  guildId: string,
): Promise<BindingWithGameName[]> {
  const b = schema.channelBindings;
  return db
    .select({
      id: b.id,
      guildId: b.guildId,
      channelId: b.channelId,
      channelType: b.channelType,
      bindingPurpose: b.bindingPurpose,
      gameId: b.gameId,
      recurrenceGroupId: b.recurrenceGroupId,
      config: b.config,
      createdAt: b.createdAt,
      updatedAt: b.updatedAt,
      gameName: schema.games.name,
    })
    .from(b)
    .leftJoin(schema.games, eq(b.gameId, schema.games.id))
    .where(eq(b.guildId, guildId));
}
