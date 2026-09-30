/**
 * ROK-1494 A11 / ROK-1505 — posting a group's message: the first post, and
 * the E3 replacement of one a human deleted (`replaceDeletedPost`).
 *
 * Extracted verbatim out of `LfmEmbedService` (which sat at 292 of its 300
 * counted lines) so the service keeps the orchestration — the per-game chain,
 * the edit/heal/close rules — and this module keeps the one decision it makes
 * exactly once per row: WHICH surface the row lives on (ROK-1471 D2).
 *
 * Nothing here catches: every caller is one of the service's entry points,
 * each of which already warns-and-swallows so an emitter-side throw can never
 * become a 500 on someone's signup. The replacement's `finally` restores the
 * dropped row and then lets the throw carry on to that entry point.
 */
import type { EmbedContext } from '../services/discord-embed.factory';
import type { LfgDb } from '../../lfg/lfg-query.helpers';
import type { LfgBoardService } from '../lfg-board/lfg-board.service';
import type { DiscordBotClientService } from '../discord-bot-client.service';
import {
  resolveLfgBoardSurface,
  type LfgBoardSurface,
  type LfgBoardSurfaceDeps,
} from '../lfg-board/lfg-board-surface.helpers';
import { resolveLfmChannel, type LfmChannelDeps } from './lfm-channel.helpers';
import {
  emitLfgThreadBound,
  type ThreadBoundEmitter,
} from '../thread-mirror/thread-mirror.constants';
import { buildLfmEmbed, type LfmGroupView } from './lfm-embed.helpers';
import {
  deleteLfmMessage,
  insertLfmMessage,
  LFM_FLOOR,
  restoreLfmMessage,
  type LfmMessageRow,
} from './lfm-embed.db-helpers';

/** Everything a first post needs, handed over by the service per call. */
export interface LfmPostDeps {
  db: LfgDb;
  /** The forum adapter — the RESOLVER, never a second event subscriber. */
  board: Pick<LfgBoardService, 'postThread'>;
  clientService: Pick<DiscordBotClientService, 'sendEmbed'>;
  channelDeps: LfmChannelDeps;
  surfaceDeps: LfgBoardSurfaceDeps;
  /** ROK-1483 D4: the mirror binds on the BOUND event, not a service edge. */
  events: ThreadBoundEmitter;
  context: EmbedContext;
}

/**
 * Post the group's message and start tracking it.
 *
 * ROK-1471 D2: the surface is chosen ONCE, here, and then recorded. The
 * forum is preferred; text is the fallback, and is also where a forum that
 * refused the post lands (E2) — the adapter has already warned by then.
 *
 * ROK-1505 D3: below `LFM_FLOOR` the group is LFG, not LFM, and posts to the
 * FORUM ONLY — the text embed is the "looking for MORE" ping to a bound
 * channel and stays quiet until two hands (Q1). The rule lives here rather
 * than in a caller so the hot path, the deleted-message heal and the offline
 * reconcile obey it identically.
 *
 * @param deps - The service's collaborators plus the embed chrome context.
 * @param gameId - Game whose group is being posted.
 * @param view - The render to post.
 * @returns true only when a message was posted AND a row now tracks it.
 */
export async function postNew(
  deps: LfmPostDeps,
  gameId: number,
  view: LfmGroupView,
): Promise<boolean> {
  const surface = await resolveLfgBoardSurface(deps.surfaceDeps, gameId);
  if (!surface) return false; // E2 — warned inside the resolver, never thrown.
  const lfg = view.state !== 'playing' && view.memberCount < LFM_FLOOR; // D3 — a playing group always posts (ROK-1695)
  if (surface.kind === 'forum') {
    if (await postForum(deps, gameId, surface, view)) return true;
    if (lfg) return false; // D3 — a refused forum post has no text fallback at LFG.
    const text = await resolveLfmChannel(deps.channelDeps, gameId);
    if (!text) return false;
    await postText(deps, gameId, text, view);
    return true;
  }
  if (lfg) return false; // D3 — no forum resolved: a one-hand group posts nowhere.
  await postText(deps, gameId, surface, view);
  return true;
}

/**
 * E3 — replace a still-open group's message that a human deleted (TDB:954).
 *
 * The row is dropped first because the partial unique index allows one open
 * row per game, so the replacement's insert would otherwise collide. When no
 * replacement row lands — no surface, no channel, or `sendEmbed`/`postThread`
 * throws — the ORIGINAL row is put back. Without it the group has no row at
 * all, and every later GROUP_CHANGED returns early (E4), so the group never
 * gets a live message again.
 *
 * D3 nuance: when `postNew` deliberately skips (a one-hand group on a text
 * surface) the original row is restored as well. That is accepted: nothing
 * visible changes in Discord, and the next event re-heals or closes the row.
 *
 * A throw still propagates after the restore; the service's entry points warn
 * and swallow it.
 *
 * @param deps - The service's collaborators plus the embed chrome context.
 * @param row - The tracking row whose Discord message is gone.
 * @param view - The render to post in its place.
 */
export async function replaceDeletedPost(
  deps: LfmPostDeps,
  row: LfmMessageRow,
  view: LfmGroupView,
): Promise<void> {
  await deleteLfmMessage(deps.db, row.id);
  let tracked = false;
  try {
    tracked = await postNew(deps, row.gameId, view);
  } finally {
    if (!tracked) await restoreLfmMessage(deps.db, row);
  }
}

/**
 * Post to the board forum.
 *
 * `channel_id` is the THREAD, not the forum: a button interaction inside a
 * forum post carries the thread as its `channelId`, and `findLfmMessageByIds`
 * matches on that — storing the forum id makes the `+1` unresolvable.
 *
 * @returns false when the post could not be made, so the caller falls back.
 */
async function postForum(
  deps: LfmPostDeps,
  gameId: number,
  surface: LfgBoardSurface,
  view: LfmGroupView,
): Promise<boolean> {
  const posted = await deps.board.postThread(
    surface.channelId,
    view,
    deps.context,
  );
  if (!posted) return false;
  await insertLfmMessage(deps.db, {
    gameId,
    guildId: surface.guildId,
    channelId: posted.threadId,
    messageId: posted.starterMessageId,
    threadId: posted.threadId,
    postKind: 'forum',
    lastMemberCount: view.memberCount,
  });
  // ROK-1483 D4: the mirror binds on an EVENT, not on a service edge. A
  // lineup or poll surface emits the same one with a different kind
  // (ROK-1484) and the mirror needs no change.
  emitLfgThreadBound(deps.events, posted.threadId, surface.guildId, gameId);
  return true;
}

/** The 1454 text board, unchanged. `content` is sent on the first post only. */
async function postText(
  deps: LfmPostDeps,
  gameId: number,
  target: { guildId: string; channelId: string },
  view: LfmGroupView,
): Promise<void> {
  const { embed, content } = buildLfmEmbed(view, deps.context);
  const message = await deps.clientService.sendEmbed(
    target.channelId,
    embed,
    undefined,
    content,
  );
  await insertLfmMessage(deps.db, {
    gameId,
    guildId: target.guildId,
    channelId: target.channelId,
    messageId: message.id,
    postKind: 'text',
    lastMemberCount: view.memberCount,
  });
}
