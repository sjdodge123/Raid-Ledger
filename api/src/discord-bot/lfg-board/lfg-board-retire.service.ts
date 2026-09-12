/**
 * ROK-1523 — retiring the board's live posts when the operator switches it off.
 *
 * ROK-1471 E4 left open posts alone on disable: a live post is an in-flight
 * group's only Discord surface, and deleting it strands people mid-coordination.
 * That is right for the GROUP and wrong for the ADMIN, who disables the board
 * because it is cluttered or in the wrong channel and then watches it stay
 * populated for up to the 14-day intent horizon. "Off" did not look off.
 *
 * The resolution is neither of the two obvious ones. Each open post gets a
 * FAREWELL edit — the ordinary terminal render plus `LFG_BOARD_RETIRED_NOTE`,
 * which says the board was switched off and that the group is still live on
 * the site — and is then archived by the SAME `isTerminalRender` path every
 * other ending uses (`LfgBoardService.editThread`). No deletion path exists
 * here on purpose: the post stays readable, the group keeps its web surface,
 * and the forum actually empties.
 *
 * The row is closed on every path the post can still be REACHED on. An `open`
 * row left behind after its post is archived holds its game hostage to
 * `uq_lfg_group_messages_game_open` — the same hazard ROK-1520 hit from the
 * other direction. The one exception is a TRANSIENT Discord failure: see
 * `lfg-board-retire.helpers.ts`, which is where that judgement lives.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import { SettingsService } from '../../settings/settings.service';
import type { LfgDb } from '../../lfg/lfg-query.helpers';
import type { EmbedContext } from '../services/discord-embed.factory';
import {
  closeLfmMessage,
  findOpenLfmMessage,
  listOpenLfmMessages,
  loadLfmGame,
  type LfmMessageRow,
} from '../lfm/lfm-embed.db-helpers';
import type { LfmGroupView } from '../lfm/lfm-embed.helpers';
import { currentView } from '../lfm/lfm-embed.views';
import { LfgBoardService } from './lfg-board.service';
import { LfgGameChainService } from './lfg-game-chain.service';
import {
  boardOffView,
  describeError,
  isPermanentRefusal,
} from './lfg-board-retire.helpers';

@Injectable()
export class LfgBoardRetireService {
  private readonly logger = new Logger(LfgBoardRetireService.name);

  constructor(
    @Inject(DrizzleAsyncProvider) private readonly db: LfgDb,
    private readonly board: LfgBoardService,
    private readonly settingsService: SettingsService,
    private readonly chain: LfgGameChainService,
  ) {}

  /**
   * Retire every live forum post: farewell edit, archive, close the row.
   *
   * Sequential on purpose. Each row costs an edit, a rename/tag flush and an
   * archive against Discord's per-thread `PATCH /channels` bucket; firing a
   * whole board's worth concurrently is the fastest way to get the tail of the
   * list 429'd and left half-retired.
   *
   * NEVER THROWS, and that is enforced rather than asserted: the whole pass is
   * guarded (the worklist read and the settings read can both reject) and so is
   * every row (one unreadable game must not abandon the rest of the board). Its
   * caller is awaited inside the admin `PUT`'s emitter, so an escaping
   * rejection is both a 500 on a saved setting and — under Node 22 — an
   * unhandled rejection that takes the process down.
   *
   * @returns How many rows were closed.
   */
  async retireOpenPosts(): Promise<number> {
    try {
      return await this.retirePass();
    } catch (err) {
      this.logger.warn(
        `The LFG board retire pass could not run: ${describeError(err)}. ` +
          'Live posts are untouched and their rows are still open, so the ' +
          'reconnect reconciliation still owns them.',
      );
      return 0;
    }
  }

  /** The pass proper. Guarded end-to-end by {@link retireOpenPosts}. */
  private async retirePass(): Promise<number> {
    const rows = (await listOpenLfmMessages(this.db)).filter(
      (row) => row.postKind === 'forum',
    );
    if (rows.length === 0) return 0;
    const context = await this.context();
    let retired = 0;
    for (const row of rows) {
      retired += await this.retireRowGuarded(row, context);
    }
    this.logger.log(
      `LFG board disabled — retired ${String(retired)} of ` +
        `${String(rows.length)} live forum post${rows.length === 1 ? '' : 's'}. ` +
        'Each one says the board was switched off and links its group on the ' +
        'site; the groups themselves are untouched.',
    );
    return retired;
  }

  /**
   * One row, on the game's own chain, with its failure contained.
   *
   * The chain is `LfmEmbedService`'s: a `GROUP_CHANGED` for the same game
   * arriving mid-pass would otherwise render an OPEN embed over the farewell
   * and re-open nothing — the row is already closed, so no reconcile revisits
   * it. Joining the queue makes the retire the last writer by construction.
   *
   * @returns 1 when the row was closed, 0 when it was left for reconcile.
   */
  private async retireRowGuarded(
    row: LfmMessageRow,
    context: EmbedContext,
  ): Promise<number> {
    let closed = 0;
    try {
      await this.chain.serialized(row.gameId, async () => {
        closed = await this.retireRow(row, context);
      });
    } catch (err) {
      this.logger.warn(
        `Could not retire the LFG board row ${row.id} (game ` +
          `${String(row.gameId)}): ${describeError(err)}. Leaving it open ` +
          'and moving on to the next post.',
      );
      return 0;
    }
    return closed;
  }

  /**
   * One row: farewell edit, then close — unless the edit failed TRANSIENTLY.
   *
   * A permanently refused edit does NOT abandon the row: closing anyway is the
   * same rule `LfmEmbedService.editRow` applies to a refused terminal render,
   * because an unclosable `open` row is the wedge class. A transient failure is
   * the opposite case and is left open on purpose — the post is still there,
   * and `LfmEmbedService.reconcileOpenRows` (which now knows the board is off,
   * and only ever sees `open` rows) gets to finish the job on the next
   * reconnect.
   *
   * The row is RE-READ first. `retirePass`'s worklist is a snapshot taken
   * before this joined the game's chain, and a `GROUP_CHANGED` queued ahead of
   * it can terminalise the same row meanwhile — a conversion, an expiry. Acting
   * on the stale snapshot then unarchives that final card, overwrites it with
   * "the board was switched off, the group is still live on the site" over a
   * group that actually got SCHEDULED, and rewrites `converted` back to
   * `closed`. Whoever got there first wins.
   *
   * @returns 1 when the row was closed, 0 when it was left open or was gone.
   */
  private async retireRow(
    row: LfmMessageRow,
    context: EmbedContext,
  ): Promise<number> {
    const live = await findOpenLfmMessage(this.db, row.gameId);
    if (!live || live.id !== row.id) return 0;
    const view = await this.retiredView(live);
    if (view && !(await this.edited(live, view, context))) return 0;
    await closeLfmMessage(
      this.db,
      live.id,
      'closed',
      view?.memberCount ?? live.lastMemberCount,
    );
    return 1;
  }

  /**
   * The farewell edit.
   *
   * @returns True when the post was edited or is unreachable for good; false
   *   when Discord merely could not answer and the row should stay open.
   */
  private async edited(
    row: LfmMessageRow,
    view: LfmGroupView,
    context: EmbedContext,
  ): Promise<boolean> {
    try {
      await this.board.editThread(row, view, context);
      return true;
    } catch (err) {
      const permanent = isPermanentRefusal(err);
      this.logger.warn(
        `Could not retire the LFG board post for game ${String(row.gameId)}: ` +
          `${describeError(err)}. ${
            permanent
              ? 'Discord says it is gone for good, so the row is closed ' +
                'anyway — an unclosable open row would wedge the game.'
              : 'Treating it as transient: the row stays OPEN so the ' +
                'reconnect reconciliation retries it.'
          }`,
      );
      return permanent;
    }
  }

  /**
   * The farewell render: the group exactly as it stands, ended and annotated.
   *
   * `currentView`, never a bare `liveView` — the post keeps naming the people
   * actually in the group, and a group whose session has already spawned has an
   * EMPTY live read (every intent converted), which would print "0 still
   * looking / Nobody yet" on a card whose players are in voice right now.
   *
   * @param row - The tracked forum row being retired.
   * @returns The view, or null when the game is gone (E13) — then there is
   *   nothing to edit and only the row is closed.
   */
  private async retiredView(row: LfmMessageRow): Promise<LfmGroupView | null> {
    const game = await loadLfmGame(this.db, row.gameId);
    if (!game) return null;
    return boardOffView(await currentView(this.db, game));
  }

  /** Community branding + URL + timezone for the chrome. */
  private async context(): Promise<EmbedContext> {
    const [branding, clientUrl, timezone] = await Promise.all([
      this.settingsService.getBranding(),
      this.settingsService.getClientUrl(),
      this.settingsService.getDefaultTimezone(),
    ]);
    return { communityName: branding.communityName, clientUrl, timezone };
  }
}
