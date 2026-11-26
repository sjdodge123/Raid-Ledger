/**
 * ROK-2352 — the service-side keyed pass: load the game, run
 * {@link syncKeyedGroups}, and the reconnect walk over games holding an open
 * keyed row. Lifted out of `LfmEmbedService` (max-lines); the service hands
 * over its seams through {@link LfmKeyedPassDeps}.
 *
 * Plug-in point (later lane): keyed groups that reached LFM while the bot was
 * offline have NO row, so {@link reconcileKeyedGroups} cannot see them yet —
 * the untracked-keyed-games read joins its game set here.
 */
import { isVisibleGame } from '../../igdb/igdb-visibility.helpers';
import type { LfgGroupingRegistry } from '../../lfg/lfg-grouping.helpers';
import type { LfgDb } from '../../lfg/lfg-query.helpers';
import type { LfmGroupView } from './lfm-embed.helpers';
import {
  listOpenLfmMessages,
  loadLfmGame,
  type LfmMessageRow,
} from './lfm-embed.db-helpers';
import { syncKeyedGroups } from './lfm-embed.groups.helpers';

/** The service collaborators one keyed pass needs. */
export interface LfmKeyedPassDeps {
  db: LfgDb;
  /** Absent in unit specs that predate groups — the pass is then skipped. */
  registry: LfgGroupingRegistry | undefined;
  serialized(gameId: number, work: () => Promise<void>): Promise<void>;
  editRow(row: LfmMessageRow, view: LfmGroupView): Promise<void>;
  postNew(gameId: number, view: LfmGroupView): Promise<void>;
  warn(action: string, err: unknown): void;
}

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
 * Reconnect: the keyed pass for every game holding an open keyed row, each on
 * its own game chain.
 *
 * @param deps - The service seams.
 */
export async function reconcileKeyedGroups(
  deps: LfmKeyedPassDeps,
): Promise<void> {
  if (!deps.registry) return;
  const gameIds = new Set(
    (await listOpenLfmMessages(deps.db))
      .filter((row) => row.groupKey)
      .map((row) => row.gameId),
  );
  for (const gameId of gameIds) {
    await deps.serialized(gameId, () => runKeyedPass(deps, gameId));
  }
}
