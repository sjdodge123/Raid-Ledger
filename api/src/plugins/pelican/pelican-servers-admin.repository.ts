import { Inject, Injectable } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { PelicanServerUpdate } from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import {
  games,
  pelicanServers,
  type NewPelicanServer,
  type PelicanServerRow,
} from '../../drizzle/schema';
import type { PelicanTx } from './pelican-servers.repository';

type Db = PostgresJsDatabase<typeof schema>;

/**
 * A `pelican_servers` row plus the mapped game's name (ROK-1094). The panel
 * uuid and identifier are never selected, so they cannot leak from here.
 * `timezone` is unread since Pelican crons are always UTC (ROK-1795).
 */
export type PelicanAdminServerRow = Omit<
  PelicanServerRow,
  'panelUuid' | 'identifier' | 'timezone'
> & { gameName: string | null; gameSlug: string | null };

/** Outcome of an admin mapping edit; never a caught FK violation. */
export type PelicanMappingUpdateResult =
  | { kind: 'ok'; row: PelicanAdminServerRow }
  | { kind: 'not_found' }
  | { kind: 'unknown_game' }
  | { kind: 'presence_unsupported' };

/** Whether a game slug (null = unmapped) supports Quick Play detection. */
export type PresenceSupportCheck = (gameSlug: string | null) => boolean;

type MappingSet = Pick<
  NewPelicanServer,
  'gameId' | 'showOnCalendar' | 'presenceTracking'
>;

/** Only the keys the admin sent. */
export function toMappingSet(patch: PelicanServerUpdate): MappingSet {
  return {
    ...(patch.gameId !== undefined ? { gameId: patch.gameId } : {}),
    ...(patch.showOnCalendar !== undefined
      ? { showOnCalendar: patch.showOnCalendar }
      : {}),
    ...(patch.presenceTracking !== undefined
      ? { presenceTracking: patch.presenceTracking }
      : {}),
  };
}

/** Admin read/edit of `pelican_servers` — the sync upsert never touches these columns (D4). */
@Injectable()
export class PelicanServersAdminRepository {
  constructor(@Inject(DrizzleAsyncProvider) private readonly db: Db) {}

  /** Every row, missing ones included, ordered by name. */
  listForAdmin(): Promise<PelicanAdminServerRow[]> {
    return this.selectJoined(this.db).orderBy(
      asc(pelicanServers.name),
      asc(pelicanServers.id),
    );
  }

  /**
   * Apply the admin mapping. The server row is locked and the game is
   * pre-checked (`FOR SHARE`) in one transaction, so the update cannot hit
   * the games FK — postgres.js would poison the tx on a caught violation.
   * Turning Quick Play detection on is refused when the resulting game (the
   * patched one, else the current one) fails `supportsPresence` (ROK-1800).
   */
  updateMapping(
    id: number,
    patch: PelicanServerUpdate,
    supportsPresence: PresenceSupportCheck = () => true,
  ): Promise<PelicanMappingUpdateResult> {
    return this.db.transaction(async (tx) => {
      const current = await this.lockServer(tx, id);
      if (!current) return { kind: 'not_found' };
      const gameId = patch.gameId !== undefined ? patch.gameId : current.gameId;
      const game =
        gameId === null ? { slug: null } : await this.lockGame(tx, gameId);
      if (!game) return { kind: 'unknown_game' };
      if (patch.presenceTracking === true && !supportsPresence(game.slug)) {
        return { kind: 'presence_unsupported' };
      }
      await tx
        .update(pelicanServers)
        .set(toMappingSet(patch))
        .where(eq(pelicanServers.id, id));
      const [row] = await this.selectJoined(tx).where(
        eq(pelicanServers.id, id),
      );
      return row ? { kind: 'ok', row } : { kind: 'not_found' };
    });
  }

  private selectJoined(executor: Db | PelicanTx) {
    return executor
      .select({
        ...getServerColumns(),
        gameName: games.name,
        gameSlug: games.slug,
      })
      .from(pelicanServers)
      .leftJoin(games, eq(games.id, pelicanServers.gameId))
      .$dynamic();
  }

  private async lockServer(
    tx: PelicanTx,
    id: number,
  ): Promise<{ gameId: number | null } | undefined> {
    const [row] = await tx
      .select({ gameId: pelicanServers.gameId })
      .from(pelicanServers)
      .where(eq(pelicanServers.id, id))
      .for('update');
    return row;
  }

  private async lockGame(
    tx: PelicanTx,
    gameId: number,
  ): Promise<{ slug: string } | undefined> {
    const [row] = await tx
      .select({ slug: games.slug })
      .from(games)
      .where(eq(games.id, gameId))
      .for('share', { of: games });
    return row;
  }
}

function getServerColumns() {
  return {
    id: pelicanServers.id,
    name: pelicanServers.name,
    gameId: pelicanServers.gameId,
    showOnCalendar: pelicanServers.showOnCalendar,
    presenceTracking: pelicanServers.presenceTracking,
    currentState: pelicanServers.currentState,
    isSuspended: pelicanServers.isSuspended,
    statusCheckedAt: pelicanServers.statusCheckedAt,
    lastSyncedAt: pelicanServers.lastSyncedAt,
    missingSince: pelicanServers.missingSince,
  };
}
