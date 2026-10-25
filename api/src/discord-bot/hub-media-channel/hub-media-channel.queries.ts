import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import type { HubMediaHubRef } from '../../hub-media/hub-media-classifier.registry';

type Db = PostgresJsDatabase<typeof schema>;
const { games, guildProfiles, guilds, hubMedia } = schema;
const CACHE_TTL_MS = 60_000;

/** The hub a media channel feeds (D1 partial unique: at most one). */
export async function findHubForMediaChannel(
  db: Db,
  channelId: string,
): Promise<HubMediaHubRef | null> {
  const [row] = await db
    .select({
      guildId: guilds.id,
      pelicanServerId: guilds.pelicanServerId,
      gameSlug: games.slug,
    })
    .from(guildProfiles)
    .innerJoin(guilds, eq(guilds.id, guildProfiles.guildId))
    .leftJoin(games, eq(games.id, guilds.gameId))
    .where(eq(guildProfiles.mediaChannelId, channelId))
    .limit(1);
  return row ?? null;
}

/** A message's live stored pictures (D11 edit/delete). */
export function findMessageMedia(
  db: Db,
  guildId: number,
  messageId: string,
): Promise<{ id: number; provenanceKey: string; kind: string }[]> {
  return db
    .select({
      id: hubMedia.id,
      provenanceKey: hubMedia.provenanceKey,
      kind: hubMedia.kind,
    })
    .from(hubMedia)
    .where(
      and(
        eq(hubMedia.guildId, guildId),
        eq(hubMedia.discordMessageId, messageId),
        isNull(hubMedia.removedAt),
      ),
    );
}

/** channel → hub with a 60 s cache; PUT/DELETE of the binding invalidate it. */
@Injectable()
export class HubMediaChannelResolver {
  private readonly cache = new Map<
    string,
    { hub: HubMediaHubRef | null; at: number }
  >();

  constructor(@Inject(DrizzleAsyncProvider) private readonly db: Db) {}

  /** The bound hub, or null for an unbound channel (also cached). */
  async resolve(channelId: string): Promise<HubMediaHubRef | null> {
    const hit = this.cache.get(channelId);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.hub;
    const hub = await findHubForMediaChannel(this.db, channelId);
    this.cache.set(channelId, { hub, at: Date.now() });
    return hub;
  }

  /** Drop a channel's cached answer (bind, rebind or unbind). */
  invalidate(channelId: string | null): void {
    if (channelId !== null) this.cache.delete(channelId);
  }
}
