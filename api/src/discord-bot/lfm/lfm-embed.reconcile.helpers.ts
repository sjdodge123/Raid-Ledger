/**
 * ROK-1454 D9 — the reconnect reconcile of every `open` LFM row.
 *
 * Extracted from `LfmEmbedService` (the extraction ROK-1454.md:177 named) so
 * the reconcile can grow without pushing the service past its line cap. The
 * behaviour is the service's, unchanged: it still owns the per-game chain, the
 * edit / heal / close write and the warn sink, and hands them in as
 * {@link LfmReconcileDeps}.
 */
import type { LfgDb } from '../../lfg/lfg-query.helpers';
import type { LfmGroupView } from './lfm-embed.helpers';
import {
  convertedView,
  endedView,
  liveFloorFor,
  liveView,
  sessionView,
} from './lfm-embed.views';
import {
  conversionSincePosted,
  listOpenLfmMessages,
  loadLfmGame,
  type LfmGameRow,
  type LfmMessageRow,
} from './lfm-embed.db-helpers';

/** The service collaborators the reconcile walk needs. */
export interface LfmReconcileDeps {
  db: LfgDb;
  /** Queue `work` on the game's chain (`LfgGameChainService`). */
  serialized: (gameId: number, work: () => Promise<void>) => Promise<void>;
  /** The service's edit-then-persist write (heal + close rules included). */
  editRow: (row: LfmMessageRow, view: LfmGroupView) => Promise<void>;
  /** Log and swallow — one bad row must not abort the rest. */
  warn: (action: string, err: unknown) => void;
}

/**
 * One pass over the worklist. One bad row must not abort the rest.
 *
 * ROK-1523 — this pass is the stated recovery for a retire whose farewell
 * edit failed transiently. It needs no board-off branch of its own: every
 * row goes through `editRow`, which is where "board off means retire" lives
 * for EVERY writer.
 *
 * @param deps - The service's collaborators.
 */
export async function reconcileOpenRows(deps: LfmReconcileDeps): Promise<void> {
  for (const row of await listOpenLfmMessages(deps.db)) {
    try {
      await deps.serialized(row.gameId, () => reconcileRow(deps, row));
    } catch (err) {
      deps.warn(`reconcile the LFM message for game ${row.gameId}`, err);
    }
  }
}

/**
 * Re-render one `open` row. A group still at or above the floor is simply
 * re-rendered; below it the group ended offline, and the only surviving
 * evidence of HOW is the provenance FK the conversion wrote.
 *
 * @param deps - The service's collaborators.
 * @param row - The `open` row being reconciled.
 */
export async function reconcileRow(
  deps: LfmReconcileDeps,
  row: LfmMessageRow,
): Promise<void> {
  const game = await loadLfmGame(deps.db, row.gameId);
  if (!game) return;
  await deps.editRow(row, await reconcileView(deps.db, row, game));
}

/**
 * ROK-1494 review — the LIVE SESSION is checked FIRST, before the floor.
 *
 * A restart during a spawned session is the one path into a terminal render
 * that carries no `playing` payload, and every signal it reads points the
 * wrong way: the spawn converted every intent, so the live read returns an
 * EMPTY group (below the floor) and `latestConversionTarget` finds the
 * spawn's own event. Reconcile therefore rendered SCHEDULED and closed the
 * row — after which `findOpenLfmMessage` returns nothing and every later
 * voice join early-returns out of `editForChange`, freezing the head-count
 * for the rest of the session. That is precisely the failure D3 exists to
 * prevent, so the session read has to come before the group is judged dead.
 *
 * TDB:953 — the CONVERSION is checked SECOND, still before the floor. A
 * group that converted while the bot was down, followed by a NEW group for
 * the same game crossing the floor, used to pass the live check below and
 * re-render the old message AS the new group: the conversion was never
 * rendered, and the new group never got a post of its own. A conversion
 * stamped after this row's `posted_at` is its group's ending, whatever the
 * live read says now; closing the row frees the partial unique index, so
 * `reconcileUntrackedGroups` posts the new group fresh in the same CONNECTED.
 *
 * @param db - Drizzle handle.
 * @param row - The `open` row being reconciled.
 * @param game - Its game, already loaded.
 * @returns The view to render.
 */
export async function reconcileView(
  db: LfgDb,
  row: LfmMessageRow,
  game: LfmGameRow,
): Promise<LfmGroupView> {
  // ROK-1494 AC7 — `sessionView` is the SHARED answer; `viewForChange` asks
  // the same helper, so the hot path and the reconcile cannot disagree.
  const session = await sessionView(db, game);
  if (session) return session;
  const converted = await conversionSincePosted(db, row);
  if (converted) return convertedView(db, game, converted);
  const liveGroup = await liveView(db, game);
  if (liveGroup.memberCount >= liveFloorFor(row.postKind)) return liveGroup;
  return endedView(db, game, row);
}
