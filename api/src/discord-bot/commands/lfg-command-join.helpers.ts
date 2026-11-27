/**
 * `/lfg` join resolution, pulled out of `lfg.command.ts` (line cap): the game
 * a typed value names, the ROK-2352 `dungeon` option for that game, and the
 * `createIntent` request the command sends.
 */
import { and, eq, ilike, type SQL } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { escapeLikePattern } from '../../common/search.util';
import * as schema from '../../drizzle/schema';
import { VISIBILITY_FILTER } from '../../igdb/igdb-visibility.helpers';
import {
  resolveLfgGrouping,
  type LfgGroupingRegistry,
} from '../../lfg/lfg-grouping.helpers';
import type { LfgService } from '../../lfg/lfg.service';
import type { LfgReplyContext } from './lfg.command.helpers';
import type { resolveLfgCommandUrgency } from './lfg-command-urgency.helpers';
import {
  buildDungeonChoices,
  resolveDungeonGroup,
  type LfgDungeonChoice,
  type LfgDungeonGroup,
} from './lfg-dungeon.helpers';

/** `games.id` is an int4; anything larger is not a pick, it is noise. */
const PG_INT4_MAX = 2147483647;

type Db = PostgresJsDatabase<typeof schema>;

/** A resolved, visible game: its id and the slug the grouping keys on. */
export interface LfgGamePick {
  id: number;
  slug: string;
}

/** What the caller typed into `/lfg`'s three options. */
export interface LfgJoinOptions {
  game: string;
  urgency: string | null;
  dungeon: string | null;
}

/**
 * The first VISIBLE game satisfying `where`, or null. A hidden or banned game
 * falls through to the unknown-game reply rather than reaching
 * `createIntent`'s 404 (which would surface as "Something went wrong").
 */
async function findGame(db: Db, where: SQL): Promise<LfgGamePick | null> {
  const [match] = await db
    .select({ id: schema.games.id, slug: schema.games.slug })
    .from(schema.games)
    .where(and(where, VISIBILITY_FILTER()))
    .limit(1);
  return match ?? null;
}

/**
 * Free-typed text first: one exact (case-insensitive) title match, with LIKE
 * metacharacters escaped so `%` cannot select an arbitrary game and then
 * WRITE an intent for it. Only when no title matches is an all-digit value
 * read as an autocomplete pick (`autocompleteGameIds` values are
 * `String(games.id)`): a game titled `1942` must win over the game whose id
 * happens to be 1942.
 *
 * @param db - Drizzle handle.
 * @param typed - The `game` option value.
 */
export async function findVisibleLfgGame(
  db: Db,
  typed: string,
): Promise<LfgGamePick | null> {
  const byName = await findGame(
    db,
    ilike(schema.games.name, escapeLikePattern(typed)),
  );
  if (byName !== null) return byName;
  const id = Number(typed);
  const isPick =
    /^\d+$/.test(typed) &&
    Number.isSafeInteger(id) &&
    id > 0 &&
    id <= PG_INT4_MAX;
  return isPick ? findGame(db, eq(schema.games.id, id)) : null;
}

/**
 * ROK-2352 — the `dungeon` option for one game; null = an unknown pick.
 *
 * @param registry - Plugin registry (fold when no active adapter).
 * @param game - The resolved game.
 * @param typed - The option value, or null when omitted.
 */
export function resolveGameDungeon(
  registry: LfgGroupingRegistry,
  game: LfgGamePick,
  typed: string | null,
): Promise<LfgDungeonGroup | null> {
  const adapter = resolveLfgGrouping(registry, game.slug);
  const ctx = { gameId: game.id, gameSlug: game.slug };
  return resolveDungeonGroup(adapter, ctx, typed);
}

/**
 * ROK-2352 — `dungeon` autocomplete: the entered game's catalogue filtered by
 * the text; nothing when the game is unknown or folds.
 *
 * @param db - Drizzle handle.
 * @param registry - Plugin registry.
 * @param gameTyped - The `game` option's current value.
 * @param typed - The focused `dungeon` text.
 */
export async function catalogueChoices(
  db: Db,
  registry: LfgGroupingRegistry,
  gameTyped: string | null,
  typed: string,
): Promise<LfgDungeonChoice[]> {
  const game = gameTyped ? await findVisibleLfgGame(db, gameTyped) : null;
  const adapter = game ? resolveLfgGrouping(registry, game.slug) : null;
  if (game === null || adapter === null) return [];
  const groups = await adapter.listGroups({
    gameId: game.id,
    gameSlug: game.slug,
  });
  return buildDungeonChoices(groups, typed);
}

/**
 * The `createIntent` request. ROK-1616: `tonight` expires at 04:00 on the
 * COMMUNITY's wall clock, so the write carries the zone `ctx` already holds
 * (one `getDiscordBotTimezone()` in `loadLfgReplyContext`; never a second
 * settings lookup). ROK-1656: `opts` already joins an open group's horizon
 * when no `urgency:` was given. ROK-2352: only a keyed pick sends a key —
 * `''` and fold send none, so their write is unchanged.
 */
export function joinRequest(
  opts: Awaited<ReturnType<typeof resolveLfgCommandUrgency>>,
  ctx: LfgReplyContext,
  group: LfgDungeonGroup,
): Parameters<LfgService['createIntent']>[2] {
  return {
    ...opts,
    ...(ctx.timezone !== undefined ? { timezone: ctx.timezone } : {}),
    ...(group.groupKey ? { groupKey: group.groupKey } : {}),
  };
}
