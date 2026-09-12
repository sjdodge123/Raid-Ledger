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
 * The row is closed either way. An `open` row left behind after its post is
 * archived holds its game hostage to `uq_lfg_group_messages_game_open` — the
 * same hazard ROK-1520 hit from the other direction — and a later re-enable
 * would find a stale `open` row pointing at an archived thread nobody edits.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import { SettingsService } from '../../settings/settings.service';
import type { LfgDb } from '../../lfg/lfg-query.helpers';
import type { EmbedContext } from '../services/discord-embed.factory';
import {
  closeLfmMessage,
  listOpenLfmMessages,
  loadLfmGame,
  type LfmMessageRow,
} from '../lfm/lfm-embed.db-helpers';
import type { LfmGroupView } from '../lfm/lfm-embed.helpers';
import { liveView } from '../lfm/lfm-embed.views';
import { LfgBoardService } from './lfg-board.service';

/** Best-effort message for a caught `unknown`, never a bare cast. */
function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

@Injectable()
export class LfgBoardRetireService {
  private readonly logger = new Logger(LfgBoardRetireService.name);

  constructor(
    @Inject(DrizzleAsyncProvider) private readonly db: LfgDb,
    private readonly board: LfgBoardService,
    private readonly settingsService: SettingsService,
  ) {}

  /**
   * Retire every live forum post: farewell edit, archive, close the row.
   *
   * Sequential on purpose. Each row costs an edit, a rename/tag flush and an
   * archive against Discord's per-thread `PATCH /channels` bucket; firing a
   * whole board's worth concurrently is the fastest way to get the tail of the
   * list 429'd and left half-retired.
   *
   * Never throws — its caller is the toggle listener, which runs inside the
   * admin `PUT`'s emitter and must return a 200 on a saved setting (E1).
   *
   * @returns How many rows were closed.
   */
  async retireOpenPosts(): Promise<number> {
    const rows = (await listOpenLfmMessages(this.db)).filter(
      (row) => row.postKind === 'forum',
    );
    if (rows.length === 0) return 0;
    const context = await this.context();
    let retired = 0;
    for (const row of rows) {
      retired += await this.retireRow(row, context);
    }
    this.logger.log(
      `LFG board disabled — retired ${String(retired)} live forum ` +
        `post${retired === 1 ? '' : 's'}. Each one says the board was ` +
        'switched off and links its group on the site; the groups themselves ' +
        'are untouched.',
    );
    return retired;
  }

  /**
   * One row: farewell edit (best effort), then close (unconditional).
   *
   * A refused edit does NOT abandon the row. Closing anyway is the same rule
   * `LfmEmbedService.editRow` applies to a refused terminal render: the board
   * is off, the group's board life is over regardless of what Discord would
   * say about it, and an unclosable `open` row is the wedge class.
   *
   * @returns 1 — the row is closed on every path that reaches here.
   */
  private async retireRow(
    row: LfmMessageRow,
    context: EmbedContext,
  ): Promise<number> {
    const view = await this.retiredView(row);
    if (view) await this.editOrWarn(row, view, context);
    await closeLfmMessage(
      this.db,
      row.id,
      'closed',
      view?.memberCount ?? row.lastMemberCount,
    );
    return 1;
  }

  /** The farewell edit, warned rather than thrown. */
  private async editOrWarn(
    row: LfmMessageRow,
    view: LfmGroupView,
    context: EmbedContext,
  ): Promise<void> {
    try {
      await this.board.editThread(row, view, context);
    } catch (err) {
      this.logger.warn(
        `Could not retire the LFG board post for game ${String(row.gameId)}: ` +
          `${describeError(err)}. Closing its row anyway — the board is off ` +
          'and the row must not wedge the game.',
      );
    }
  }

  /**
   * The farewell render: the group exactly as it stands, ended and annotated.
   *
   * `liveView` rather than a synthesised roster — the post keeps naming the
   * people actually in the group, so the last thing anyone reads is who they
   * were coordinating with, not "Nobody yet".
   *
   * @param row - The tracked forum row being retired.
   * @returns The view, or null when the game is gone (E13) — then there is
   *   nothing to edit and only the row is closed.
   */
  private async retiredView(row: LfmMessageRow): Promise<LfmGroupView | null> {
    const game = await loadLfmGame(this.db, row.gameId);
    if (!game) return null;
    const live = await liveView(this.db, game);
    return { ...live, state: 'closed', boardRetired: true };
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
