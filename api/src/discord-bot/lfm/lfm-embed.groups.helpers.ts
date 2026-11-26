/**
 * ROK-2352 — the board's keyed groups: one post per live WoW instance group.
 *
 * The `''` (whole-game) post keeps its ROK-1454/1471 path untouched; this
 * module runs BESIDE it on the same per-game chain and owns only the rows
 * whose `group_key` is not `''`:
 *
 * - adapter active → every open keyed row is re-rendered from its group's own
 *   live read (or ends when the group fell below its floor), and every keyed
 *   group at LFM (≥ {@link LFM_FLOOR} hands) without a row gets a post, up to
 *   {@link LFG_BOARD_MAX_GROUP_POSTS_PER_GAME} open keyed posts per game;
 * - adapter inactive (plugin off / suspended — the fold) → every open keyed
 *   row ends. Nothing stored about the hands changes (Q10).
 *
 * A game with no keyed rows and no adapter reads ONE empty query and returns,
 * so a non-WoW game's board behaves byte for byte as before.
 */
import { and, countDistinct, eq, ne } from 'drizzle-orm';
import { LFG_ANY_GROUP_KEY } from '@raid-ledger/contract';
import * as schema from '../../drizzle/schema';
import {
  resolveLfgGrouping,
  type LfgGroupingRegistry,
} from '../../lfg/lfg-grouping.helpers';
import {
  eligibleUser,
  liveIntent,
  type LfgDb,
} from '../../lfg/lfg-query.helpers';
import { ThreadRenameBudget } from '../lfg-board/lfg-board-thread.helpers';
import type { LfgGroupingAdapter } from '../../plugins/plugin-host/lfg-grouping.adapter';
import type { LfmGroupView } from './lfm-embed.helpers';
import type { LfmOverflowGroup } from './lfm-embed.overflow-line';
import {
  LFM_FLOOR,
  type LfmGameRow,
  type LfmMessageRow,
} from './lfm-embed.db-helpers';
import { expiredView, liveFloorFor, liveView } from './lfm-embed.views';

/** Spec Q11: at most this many open keyed posts per game. */
export const LFG_BOARD_MAX_GROUP_POSTS_PER_GAME = 4;

/** Spec Q11: at most this many NEW keyed posts per game per window. */
export const LFG_BOARD_NEW_GROUP_POSTS_PER_WINDOW = 3;

/** The window {@link LFG_BOARD_NEW_GROUP_POSTS_PER_WINDOW} is counted over. */
export const LFG_BOARD_NEW_GROUP_POSTS_WINDOW_MS = 10 * 60 * 1000;

/**
 * The new-post ration, keyed by game id — the board's `ThreadRenameBudget`
 * (a sliding-window ration) built with the limits above. Over budget, the
 * group simply waits for the next render pass.
 */
export interface LfmKeyedPostBudget {
  trySpend(key: string, now?: number): boolean;
}

/** One process-wide ration, held by `LfmEmbedService`. */
export function createKeyedPostBudget(): LfmKeyedPostBudget {
  return new ThreadRenameBudget(
    LFG_BOARD_NEW_GROUP_POSTS_PER_WINDOW,
    LFG_BOARD_NEW_GROUP_POSTS_WINDOW_MS,
  );
}

/** The reads one keyed pass makes — a seam so the pass is unit-testable. */
export interface LfmKeyedReads {
  listOpen(db: LfgDb, gameId: number): Promise<LfmMessageRow[]>;
  countHands(
    db: LfgDb,
    gameId: number,
    now: Date,
  ): Promise<Map<string, number>>;
  liveView(db: LfgDb, game: LfmGameRow, scope: string): Promise<LfmGroupView>;
}

/** What one keyed sync pass needs from the service. */
export interface LfmKeyedSyncDeps {
  db: LfgDb;
  registry: LfgGroupingRegistry;
  /** The service's `editRow` — heal, retire and persist rules included. */
  edit(row: LfmMessageRow, view: LfmGroupView): Promise<void>;
  /** The service's `postNew` for this game. */
  post(view: LfmGroupView): Promise<void>;
  /** Defaults to {@link LFM_KEYED_READS}; specs inject fakes. */
  reads?: LfmKeyedReads;
  /** The ≤3-new-posts-per-10-min ration; absent = unrationed (specs only). */
  postBudget?: LfmKeyedPostBudget;
}

/** Open rows of the game's keyed groups (never the `''` row). */
export async function listOpenKeyedLfmMessages(
  db: LfgDb,
  gameId: number,
): Promise<LfmMessageRow[]> {
  return db
    .select()
    .from(schema.lfgGroupMessages)
    .where(
      and(
        eq(schema.lfgGroupMessages.gameId, gameId),
        eq(schema.lfgGroupMessages.state, 'open'),
        ne(schema.lfgGroupMessages.groupKey, LFG_ANY_GROUP_KEY),
      ),
    );
}

/** Live, eligible hands per keyed group of the game: key → distinct users. */
export async function countLiveKeyedHands(
  db: LfgDb,
  gameId: number,
  now: Date,
): Promise<Map<string, number>> {
  const rows = await db
    .select({
      groupKey: schema.lfgIntents.groupKey,
      n: countDistinct(schema.lfgIntents.userId),
    })
    .from(schema.lfgIntents)
    .innerJoin(schema.users, eq(schema.users.id, schema.lfgIntents.userId))
    .where(
      and(
        eq(schema.lfgIntents.gameId, gameId),
        ne(schema.lfgIntents.groupKey, LFG_ANY_GROUP_KEY),
        liveIntent(now),
        eligibleUser(),
      ),
    )
    .groupBy(schema.lfgIntents.groupKey);
  return new Map(rows.map((r) => [r.groupKey, Number(r.n)]));
}

/** The production reads. */
export const LFM_KEYED_READS: LfmKeyedReads = {
  listOpen: listOpenKeyedLfmMessages,
  countHands: countLiveKeyedHands,
  liveView,
};

/** `"<game> — <instance>"`, or the bare game name for an unknown key. */
export async function keyedGroupTitle(
  adapter: LfgGroupingAdapter,
  game: LfmGameRow,
  groupKey: string,
): Promise<string> {
  const group = await adapter.describeGroup(
    { gameId: game.id, gameSlug: game.slug },
    groupKey,
  );
  return group ? `${game.name} — ${group.label}` : game.name;
}

/** The open view of one keyed group, titled with its instance. */
export async function keyedLiveView(
  deps: Pick<LfmKeyedSyncDeps, 'db' | 'reads'>,
  game: LfmGameRow,
  groupKey: string,
  title: string,
): Promise<LfmGroupView> {
  const reads = deps.reads ?? LFM_KEYED_READS;
  const view = await reads.liveView(deps.db, game, groupKey);
  return { ...view, gameName: title, groupKey };
}

/** A keyed post's ending: EXPIRED, still titled and keyed. */
function keyedEndView(
  game: LfmGameRow,
  row: LfmMessageRow,
  title: string,
): LfmGroupView {
  return {
    ...expiredView(game, row.lastMemberCount),
    gameName: title,
    groupKey: row.groupKey,
  };
}

/**
 * One keyed pass for a game. Runs on the game's chain; never throws for one
 * row's sake beyond what `deps.edit` / `deps.post` already contain.
 *
 * @param deps - The service seams.
 * @param game - The loaded game.
 * @param allowPost - False for a hidden game: open rows still edit, no NEW post.
 * @param now - Injected clock.
 * @returns The keyed groups at LFM the open-post cap kept off the board (the
 *   `''` post's overflow line); empty with no adapter or no new posts allowed.
 */
export async function syncKeyedGroups(
  deps: LfmKeyedSyncDeps,
  game: LfmGameRow,
  allowPost: boolean,
  now: Date = new Date(),
): Promise<LfmOverflowGroup[]> {
  const reads = deps.reads ?? LFM_KEYED_READS;
  const open = await reads.listOpen(deps.db, game.id);
  const adapter = resolveLfgGrouping(deps.registry, game.slug);
  if (adapter === null) {
    for (const row of open)
      await deps.edit(row, keyedEndView(game, row, game.name));
    return [];
  }
  const counts = await reads.countHands(deps.db, game.id, now);
  for (const row of open) {
    const title = await keyedGroupTitle(adapter, game, row.groupKey);
    const live = (counts.get(row.groupKey) ?? 0) >= liveFloorFor(row.postKind);
    await deps.edit(
      row,
      live
        ? await keyedLiveView(deps, game, row.groupKey, title)
        : keyedEndView(game, row, title),
    );
  }
  if (!allowPost) return [];
  return postNewKeyedGroups(deps, adapter, game, open, counts, now);
}

/**
 * Post every keyed group at LFM that has no row yet, inside the open-post cap
 * and the new-post ration (Q11). A group refused either waits for the next
 * render pass — its hands are untouched. Returns the groups the CAP refused
 * (not the ration: those post on a later pass) for the `''` overflow line.
 */
async function postNewKeyedGroups(
  deps: LfmKeyedSyncDeps,
  adapter: LfgGroupingAdapter,
  game: LfmGameRow,
  open: LfmMessageRow[],
  counts: Map<string, number>,
  now: Date,
): Promise<LfmOverflowGroup[]> {
  const tracked = new Set(open.map((r) => r.groupKey));
  let slots = LFG_BOARD_MAX_GROUP_POSTS_PER_GAME - tracked.size;
  let rationed = false;
  const overflow: LfmOverflowGroup[] = [];
  for (const [groupKey, n] of counts) {
    if (tracked.has(groupKey) || n < LFM_FLOOR) continue;
    if (slots <= 0) {
      const label = await overflowLabel(adapter, game, groupKey);
      overflow.push({ label, count: n });
    } else if (
      !rationed &&
      deps.postBudget?.trySpend(String(game.id), now.getTime()) === false
    ) {
      rationed = true;
    } else if (!rationed) {
      const title = await keyedGroupTitle(adapter, game, groupKey);
      await deps.post(await keyedLiveView(deps, game, groupKey, title));
      slots -= 1;
    }
  }
  return overflow;
}

/** The instance name alone (the `''` post is already titled with the game). */
async function overflowLabel(
  adapter: LfgGroupingAdapter,
  game: LfmGameRow,
  groupKey: string,
): Promise<string> {
  const group = await adapter.describeGroup(
    { gameId: game.id, gameSlug: game.slug },
    groupKey,
  );
  return group?.label ?? groupKey;
}
