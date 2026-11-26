/**
 * ROK-2352 — the service-side keyed pass: load the game, run
 * {@link syncKeyedGroups}, and the reconnect walk over every game that has a
 * keyed group to post, heal or close. Lifted out of `LfmEmbedService`
 * (max-lines); the service hands over its seams through
 * {@link LfmKeyedPassDeps}.
 */
import { and, eq, ne } from 'drizzle-orm';
import { LFG_ANY_GROUP_KEY } from '@raid-ledger/contract';
import * as schema from '../../drizzle/schema';
import { isVisibleGame } from '../../igdb/igdb-visibility.helpers';
import type { LfgGroupingRegistry } from '../../lfg/lfg-grouping.helpers';
import {
  eligibleUser,
  liveIntent,
  type LfgDb,
} from '../../lfg/lfg-query.helpers';
import type { LfmGroupView } from './lfm-embed.helpers';
import {
  listOpenLfmMessages,
  loadLfmGame,
  type LfmMessageRow,
} from './lfm-embed.db-helpers';
import {
  syncKeyedGroups,
  type LfmKeyedPostBudget,
} from './lfm-embed.groups.helpers';

/** The reads the reconnect walk makes — a seam for the unit spec. */
export interface LfmKeyedReconnectReads {
  listOpen(db: LfgDb): Promise<LfmMessageRow[]>;
  listKeyedHandGames(db: LfgDb, now: Date): Promise<number[]>;
}

/** The service collaborators one keyed pass needs. */
export interface LfmKeyedPassDeps {
  db: LfgDb;
  /** Absent in unit specs that predate groups — the pass is then skipped. */
  registry: LfgGroupingRegistry | undefined;
  /** The service's one new-post ration (Q11: ≤3 per game per 10 min). */
  postBudget: LfmKeyedPostBudget;
  serialized(gameId: number, work: () => Promise<void>): Promise<void>;
  editRow(row: LfmMessageRow, view: LfmGroupView): Promise<void>;
  postNew(gameId: number, view: LfmGroupView): Promise<void>;
  warn(action: string, err: unknown): void;
  /** Defaults to {@link LFM_KEYED_RECONNECT_READS}; specs inject fakes. */
  reconnectReads?: LfmKeyedReconnectReads;
}

/**
 * Games holding at least one live, eligible keyed hand — whatever the count
 * (the pass applies the LFM floor). A non-WoW game never appears.
 */
export async function listGamesWithLiveKeyedHands(
  db: LfgDb,
  now: Date = new Date(),
): Promise<number[]> {
  const rows = await db
    .selectDistinct({ gameId: schema.lfgIntents.gameId })
    .from(schema.lfgIntents)
    .innerJoin(schema.users, eq(schema.users.id, schema.lfgIntents.userId))
    .where(
      and(
        ne(schema.lfgIntents.groupKey, LFG_ANY_GROUP_KEY),
        liveIntent(now),
        eligibleUser(),
      ),
    );
  return rows.map((r) => r.gameId);
}

/** The production reconnect reads. */
export const LFM_KEYED_RECONNECT_READS: LfmKeyedReconnectReads = {
  listOpen: (db) => listOpenLfmMessages(db),
  listKeyedHandGames: listGamesWithLiveKeyedHands,
};

/**
 * The game's keyed (per-instance) posts, after the `''` post. Skipped with no
 * registry, so the `''` path stays byte for byte; a non-WoW game reads one
 * empty query and returns. Never throws (the emitter rule).
 *
 * @param deps - The service seams.
 * @param gameId - Game to sync; the caller is already on its chain.
 */
export async function runKeyedPass(
  deps: LfmKeyedPassDeps,
  gameId: number,
): Promise<void> {
  const registry = deps.registry;
  if (!registry) return;
  try {
    const game = await loadLfmGame(deps.db, gameId);
    if (!game) return;
    await syncKeyedGroups(
      {
        db: deps.db,
        registry,
        postBudget: deps.postBudget,
        edit: (row, view) => deps.editRow(row, view),
        post: (view) => deps.postNew(game.id, view),
      },
      game,
      isVisibleGame(game),
    );
  } catch (err) {
    deps.warn(`sync the keyed LFM posts for game ${gameId}`, err);
  }
}

/**
 * Reconnect: the keyed pass for every game holding an open keyed row (heal
 * it, or close it — the plugin may have gone off while the bot was down) and
 * every game holding a live keyed hand (a group that reached LFM offline has
 * NO row yet). Each game runs once, on its own chain.
 *
 * @param deps - The service seams.
 * @param now - Injected clock.
 */
export async function reconcileKeyedGroups(
  deps: LfmKeyedPassDeps,
  now: Date = new Date(),
): Promise<void> {
  if (!deps.registry) return;
  const reads = deps.reconnectReads ?? LFM_KEYED_RECONNECT_READS;
  const tracked = (await reads.listOpen(deps.db))
    .filter((row) => row.groupKey)
    .map((row) => row.gameId);
  const gameIds = new Set([
    ...tracked,
    ...(await reads.listKeyedHandGames(deps.db, now)),
  ]);
  for (const gameId of gameIds) {
    await deps.serialized(gameId, () => runKeyedPass(deps, gameId));
  }
}
