/**
 * ROK-2352 — the `''` post while a game's `lfg-grouping` adapter is active.
 *
 * With the WoW plugin on, `''` is the "Any dungeon" GROUP (spec §2.1, Q3): its
 * board post counts only the `''` hands, beside one post per keyed instance
 * group (`lfm-embed.groups.helpers.ts`). With no adapter (every non-WoW game,
 * and WoW with the plugin off — the Q10 fold) the scope is `null`: the post
 * reads every live hand of the game, exactly as before ROK-2352.
 *
 * The voice "playing now" session stays game-level and attaches to `''`, so
 * `currentView`'s session read is not scoped.
 */
import { LFG_ANY_GROUP_KEY } from '@raid-ledger/contract';
import type { LfgGroupScope } from '../../lfg/lfg-group-scope.helpers';
import {
  resolveLfgGrouping,
  type LfgGroupingRegistry,
} from '../../lfg/lfg-grouping.helpers';
import type { LfgDb } from '../../lfg/lfg-query.helpers';
import type { LfmGameRow } from './lfm-embed.db-helpers';
import type { LfmGroupView } from './lfm-embed.helpers';
import { currentView } from './lfm-embed.views';

/** What the `''` post renders, and which hands it read. */
export interface LfmAnyGroupRead {
  view: LfmGroupView;
  scope: LfgGroupScope;
}

/**
 * `''` while the game's adapter is active, else `null` (the whole game).
 *
 * @param registry - Plugin registry; absent in unit specs → `null`.
 * @param game - The game the post is for.
 */
export function anyGroupScope(
  registry: LfgGroupingRegistry | undefined,
  game: Pick<LfmGameRow, 'slug'>,
): LfgGroupScope {
  if (!registry) return null;
  return resolveLfgGrouping(registry, game.slug) === null
    ? null
    : LFG_ANY_GROUP_KEY;
}

/** The `''` post's current view, scoped per {@link anyGroupScope}. */
export async function readAnyGroup(
  db: LfgDb,
  registry: LfgGroupingRegistry | undefined,
  game: LfmGameRow,
): Promise<LfmAnyGroupRead> {
  const scope = anyGroupScope(registry, game);
  return { view: await currentView(db, game, scope), scope };
}

/**
 * True when a scoped `''` group has no hands: only keyed hands are up, which
 * the keyed pass owns, so no `''` post is made (or touched) for them. Always
 * false for the whole-game scope, so a non-WoW game is unchanged.
 */
export function nothingToPost(read: LfmAnyGroupRead): boolean {
  return (
    read.scope !== null &&
    read.view.state === 'open' &&
    read.view.memberCount === 0
  );
}
