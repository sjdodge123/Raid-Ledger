import { Inject, Injectable } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { PelicanServerUpdate } from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import {
  games,
  guilds,
  pelicanServers,
  type NewPelicanServer,
  type PelicanServerRow,
} from '../../drizzle/schema';
import type { PelicanTx } from './pelican-servers.repository';
import {
  applyCommunityHub,
  syncServerHub,
} from './hub/server-hub-toggle.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/**
 * A `pelican_servers` row plus the mapped game's name (ROK-1094). The panel
 * uuid and identifier are never selected, so they cannot leak from here.
 * `timezone` is unread since Pelican crons are always UTC (ROK-1795).
 */
export type PelicanAdminServerRow = Omit<
  PelicanServerRow,
  'panelUuid' | 'identifier' | 'timezone'
> & {
  gameName: string | null;
  gameSlug: string | null;
  /** ROK-1831: the server's community hub, if ever enabled. */
  hubGuildId?: number | null;
  hubHiddenAt?: Date | null;
};

/** Outcome of an admin mapping edit; never a caught FK violation. */
export type PelicanMappingUpdateResult =
  | { kind: 'ok'; row: PelicanAdminServerRow }
  | { kind: 'not_found' }
  | { kind: 'unknown_game' }
  | { kind: 'presence_unsupported' }
  | { kind: 'hub_unmapped' };

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
      if (patch.communityHub === true && gameId === null) {
        return { kind: 'hub_unmapped' };
      }
      await this.applyPatch(tx, { id, name: current.name, gameId }, patch);
      const [row] = await this.selectJoined(tx).where(
        eq(pelicanServers.id, id),
      );
      return row ? { kind: 'ok', row } : { kind: 'not_found' };
    });
  }

  /** Mapping columns, then the ROK-1831 hub toggle (same transaction). */
  private async applyPatch(
    tx: PelicanTx,
    server: { id: number; name: string; gameId: number | null },
    patch: PelicanServerUpdate,
  ): Promise<void> {
    const set = toMappingSet(patch);
    if (Object.keys(set).length > 0) {
      await tx
        .update(pelicanServers)
        .set(set)
        .where(eq(pelicanServers.id, server.id));
    }
    const { gameId } = server;
    await syncServerHub(tx, server, new Date());
    if (patch.communityHub === undefined) return;
    if (patch.communityHub && gameId === null) return;
    await applyCommunityHub(
      tx,
      { id: server.id, name: server.name, gameId: gameId ?? 0 },
      patch.communityHub,
      new Date(),
    );
  }

  private selectJoined(executor: Db | PelicanTx) {
    return executor
      .select({
        ...getServerColumns(),
        gameName: games.name,
        gameSlug: games.slug,
        hubGuildId: guilds.id,
        hubHiddenAt: guilds.hiddenAt,
      })
      .from(pelicanServers)
      .leftJoin(games, eq(games.id, pelicanServers.gameId))
      .leftJoin(guilds, eq(guilds.pelicanServerId, pelicanServers.id))
      .$dynamic();
  }

  private async lockServer(
    tx: PelicanTx,
    id: number,
  ): Promise<{ gameId: number | null; name: string } | undefined> {
    const [row] = await tx
      .select({ gameId: pelicanServers.gameId, name: pelicanServers.name })
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
