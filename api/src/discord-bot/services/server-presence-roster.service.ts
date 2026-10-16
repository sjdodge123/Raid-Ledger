/**
 * ROK-1801 layer B — who is on each game server, resolved to RL identities.
 *
 * Reads the Pelican tracker through `SERVER_PRESENCE_READER` (synchronous,
 * in-memory) and maps every SteamID to a linked user in ONE `users` query,
 * plus one `games` query for group names. The plugin being off, unbound or
 * empty yields an empty roster, and a failed read degrades to empty rather
 * than throwing into the voice pipeline.
 */
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import {
  SERVER_PRESENCE_READER,
  type ServerPresenceReader,
  type ServerRosterPlayer,
} from '../../plugins/pelican/presence/server-presence.reader';
import {
  buildServerRoster,
  emptyServerRoster,
  type ServerRoster,
  type ServerRosterSource,
} from './server-presence-roster.helpers';

@Injectable()
export class ServerPresenceRosterService implements ServerRosterSource {
  private readonly logger = new Logger(ServerPresenceRosterService.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    @Optional()
    @Inject(SERVER_PRESENCE_READER)
    private readonly reader: ServerPresenceReader | null = null,
  ) {}

  /** The current per-game roster; empty when nothing is tracked. */
  async snapshot(): Promise<ServerRoster> {
    const players = this.reader?.playersOnGames() ?? [];
    if (players.length === 0) return emptyServerRoster();
    try {
      return await this.resolve(players);
    } catch (err) {
      const name = err instanceof Error ? err.name : 'UnknownError';
      this.logger.warn(`Server roster lookup failed: ${name}`);
      return emptyServerRoster();
    }
  }

  private async resolve(players: ServerRosterPlayer[]): Promise<ServerRoster> {
    const steamIds = [...new Set(players.map((p) => p.steamId))];
    const gameIds = [...new Set(players.map((p) => p.gameId))];
    const u = schema.users;
    const g = schema.games;
    const [users, games] = await Promise.all([
      this.db
        .select({
          id: u.id,
          discordId: u.discordId,
          steamId: u.steamId,
          username: u.username,
        })
        .from(u)
        .where(inArray(u.steamId, steamIds)),
      this.db
        .select({ id: g.id, name: g.name })
        .from(g)
        .where(inArray(g.id, gameIds)),
    ]);
    return buildServerRoster(players, users, games);
  }
}
