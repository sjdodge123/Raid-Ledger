/**
 * ROK-2352 Q11 — keyed groups past the open-post cap
 * (`LFG_BOARD_MAX_GROUP_POSTS_PER_GAME`) get no post of their own; they are
 * listed as ONE line on the `''` ("Any") post instead.
 *
 * The keyed pass computes the overflow after the `''` pass has rendered, so
 * the service keeps the last overflow per game in an {@link LfmOverflowCache}:
 * every `''` render reads it, and a changed overflow re-edits the `''` post
 * once ({@link refreshAnyPostOverflow}).
 */
import type { LfgGroupingRegistry } from '../../lfg/lfg-grouping.helpers';
import type { LfgDb } from '../../lfg/lfg-query.helpers';
import type { LfmGroupView } from './lfm-embed.helpers';
import {
  findOpenLfmMessage,
  loadLfmGame,
  type LfmMessageRow,
} from './lfm-embed.db-helpers';
import { nothingToPost, readAnyGroup } from './lfm-embed.any-group.helpers';
import type { LfmOverflowGroup } from './lfm-embed.overflow-line';

function signature(groups: readonly LfmOverflowGroup[]): string {
  return groups.map((g) => `${g.label}\u0000${String(g.count)}`).join('\u0001');
}

/** The last overflow per game id. In memory: a restart re-derives it. */
export class LfmOverflowCache {
  private readonly byGame = new Map<number, readonly LfmOverflowGroup[]>();

  get(gameId: number): readonly LfmOverflowGroup[] {
    return this.byGame.get(gameId) ?? [];
  }

  /** Store the game's overflow; true when it differs from the last one. */
  set(gameId: number, groups: readonly LfmOverflowGroup[]): boolean {
    const changed = signature(this.get(gameId)) !== signature(groups);
    if (groups.length === 0) this.byGame.delete(gameId);
    else this.byGame.set(gameId, groups);
    return changed;
  }

  /** `view` with the overflow line, when it is the open `''` post. */
  decorate(view: LfmGroupView): LfmGroupView {
    if ((view.groupKey ?? '') !== '' || view.state !== 'open') return view;
    const groups = this.get(view.gameId);
    return groups.length > 0 ? { ...view, overflowGroups: groups } : view;
  }
}

/** What {@link refreshAnyPostOverflow} needs from the service. */
export interface LfmOverflowRefreshDeps {
  db: LfgDb;
  registry?: LfgGroupingRegistry | undefined;
  cache: LfmOverflowCache;
  editRow(row: LfmMessageRow, view: LfmGroupView): Promise<void>;
}

/**
 * Record the keyed pass's overflow and, when it changed, re-render the open
 * `''` post so its line follows. No `''` post (or a non-open one) → nothing
 * to edit; the next `''` render picks the cached overflow up.
 *
 * @param deps - The service seams.
 * @param gameId - The game, already on its chain.
 * @param groups - The over-cap keyed groups this pass found.
 */
export async function refreshAnyPostOverflow(
  deps: LfmOverflowRefreshDeps,
  gameId: number,
  groups: readonly LfmOverflowGroup[],
): Promise<void> {
  if (!deps.cache.set(gameId, groups)) return;
  const row = await findOpenLfmMessage(deps.db, gameId);
  if (!row) return;
  const game = await loadLfmGame(deps.db, gameId);
  if (!game) return;
  const read = await readAnyGroup(deps.db, deps.registry, game);
  if (nothingToPost(read) || read.view.state !== 'open') return;
  await deps.editRow(row, read.view);
}

/** {@link refreshAnyPostOverflow} bound to `deps` — the keyed pass's hook. */
export function overflowRefresher(
  deps: LfmOverflowRefreshDeps,
): (gameId: number, groups: LfmOverflowGroup[]) => Promise<void> {
  return (gameId, groups) => refreshAnyPostOverflow(deps, gameId, groups);
}
