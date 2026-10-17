import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import { games, pelicanServers } from '../../../drizzle/schema';
import type { PelicanDb } from '../pelican-plugin-lock.helpers';

/** A presence-tracked server with a mapped game (ROK-1800). */
export interface PresenceServerRow {
  id: number;
  /** Pelican client identifier. Never logged. */
  identifier: string;
  gameId: number;
  gameSlug: string;
  currentState: string | null;
  isSuspended: boolean;
}

/** Reads the servers the presence supervisor may tail. */
@Injectable()
export class PelicanPresenceRepository {
  constructor(@Inject(DrizzleAsyncProvider) private readonly db: PelicanDb) {}

  /** Opted-in, still-listed servers whose game is mapped (inner join). */
  listTracked(): Promise<PresenceServerRow[]> {
    return this.db
      .select({
        id: pelicanServers.id,
        identifier: pelicanServers.identifier,
        gameId: games.id,
        gameSlug: games.slug,
        currentState: pelicanServers.currentState,
        isSuspended: pelicanServers.isSuspended,
      })
      .from(pelicanServers)
      .innerJoin(games, eq(games.id, pelicanServers.gameId))
      .where(
        and(
          eq(pelicanServers.presenceTracking, true),
          isNull(pelicanServers.missingSince),
        ),
      );
  }
}
