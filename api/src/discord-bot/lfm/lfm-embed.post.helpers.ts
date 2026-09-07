/**
 * ROK-1494 A11 / ROK-1505 — the FIRST post of a group's message.
 *
 * Extracted verbatim out of `LfmEmbedService` (which sat at 292 of its 300
 * counted lines) so the service keeps the orchestration — the per-game chain,
 * the edit/heal/close rules — and this module keeps the one decision it makes
 * exactly once per row: WHICH surface the row lives on (ROK-1471 D2).
 *
 * Nothing here catches: every caller is one of the service's entry points,
 * each of which already warns-and-swallows so an emitter-side throw can never
 * become a 500 on someone's signup.
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
import { buildLfmEmbed, type LfmGroupView } from './lfm-embed.helpers';
import { insertLfmMessage, LFM_FLOOR } from './lfm-embed.db-helpers';

/** Everything a first post needs, handed over by the service per call. */
export interface LfmPostDeps {
  db: LfgDb;
  /** The forum adapter — the RESOLVER, never a second event subscriber. */
  board: Pick<LfgBoardService, 'postThread'>;
  clientService: Pick<DiscordBotClientService, 'sendEmbed'>;
  channelDeps: LfmChannelDeps;
  surfaceDeps: LfgBoardSurfaceDeps;
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
 */
export async function postNew(
  deps: LfmPostDeps,
  gameId: number,
  view: LfmGroupView,
): Promise<void> {
  const surface = await resolveLfgBoardSurface(deps.surfaceDeps, gameId);
  if (!surface) return; // E2 — warned inside the resolver, never thrown.
  const lfg = view.memberCount < LFM_FLOOR; // D3
  if (surface.kind === 'forum') {
    if (await postForum(deps, gameId, surface, view)) return;
    if (lfg) return; // D3 — a refused forum post has no text fallback at LFG.
    const text = await resolveLfmChannel(deps.channelDeps, gameId);
    if (!text) return;
    await postText(deps, gameId, text, view);
    return;
  }
  if (lfg) return; // D3 — no forum resolved: a one-hand group posts nowhere.
  await postText(deps, gameId, surface, view);
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
