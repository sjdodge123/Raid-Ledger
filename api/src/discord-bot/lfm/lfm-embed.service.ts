/**
 * ROK-1454 D8/D9 — the LFM embed consumer.
 *
 * One Discord message per LFM group, edited in place for its whole life and
 * edited ONE last time when the group ends. There is no separate closing
 * message and no second post: `lfg_group_messages` plus its partial unique
 * index is what makes "one" true, and what lets the message survive a restart.
 *
 * Two rules govern every path here:
 *
 *  1. **Never throw into the emitter.** These handlers run inside
 *     `EventEmitter2`'s call stack, which for `LFM_REACHED` is `POST /lfg` —
 *     a throw would surface to the player as a 500 on a successful signup.
 *     Every entry point catches and warns.
 *  2. **Never guess the roster.** D6: the three terminal reasons use three
 *     different reads on purpose. `converted` goes through provenance,
 *     `withdrawn` through the live read, and `expired` has no readable roster
 *     at all so it renders from the stored count. Unifying them is exactly the
 *     defect that got round 1 of this story rejected.
 */
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { PluginRegistryService } from '../../plugins/plugin-host/plugin-registry.service';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import { SettingsService } from '../../settings/settings.service';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { ChannelBindingsService } from '../services/channel-bindings.service';
import { DISCORD_BOT_EVENTS } from '../discord-bot.constants';
import { isUnknownMessageError } from '../services/embed-poster.helpers';
import type { EmbedContext } from '../services/discord-embed.factory';
import {
  LFG_EVENTS,
  type LfgGroupChangedPayload,
  type LfgHandRaisedPayload,
  type LfgLfmReachedPayload,
} from '../../lfg/lfg.constants';
import type { LfgDb } from '../../lfg/lfg-query.helpers';
import { isVisibleGame } from '../../igdb/igdb-visibility.helpers';
import { getLfgBoardEnabled } from '../../settings/settings-lfg-board.helpers';
import {
  retireOpenRow,
  type RetireRowDeps,
} from '../lfg-board/lfg-board-retire.helpers';
import { LfgBoardService } from '../lfg-board/lfg-board.service';
import { LfgGameChainService } from '../lfg-board/lfg-game-chain.service';
import { LFG_BOARD_EVENTS } from '../lfg-board/lfg-board.constants';
import type { LfgBoardSurfaceDeps } from '../lfg-board/lfg-board-surface.helpers';
import type { LfmChannelDeps } from './lfm-channel.helpers';
import {
  postNew,
  replaceDeletedPost,
  type LfmPostDeps,
} from './lfm-embed.post.helpers';
import {
  buildLfmEmbed,
  isTerminalRender,
  TERMINAL_STATE,
  type LfmGroupView,
} from './lfm-embed.helpers';
import { liveFloorFor, viewForChange } from './lfm-embed.views';
import {
  anyGroupScope,
  nothingToPost,
  readAnyGroup,
} from './lfm-embed.any-group.helpers';
import { createKeyedPostBudget } from './lfm-embed.groups.helpers';
import {
  reconcileKeyedGroups,
  runKeyedPass,
  type LfmKeyedPassDeps,
} from './lfm-embed.keyed-pass.helpers';
import {
  closeLfmMessage,
  findOpenLfmMessage,
  loadLfmGame,
  recordLfmRender,
  type LfmMessageRow,
} from './lfm-embed.db-helpers';
import {
  reconcileOpenRows,
  reconcileUntrackedGroups,
  type LfmReconcileDeps,
} from './lfm-embed.reconcile.helpers';

/** Below this many live members a group is over, not merely thinner (E12). */
@Injectable()
export class LfmEmbedService {
  private readonly logger = new Logger(LfmEmbedService.name);
  /** ROK-2352 Q11 — new keyed posts per game, the rename budget's ration. */
  private readonly keyedPostBudget = createKeyedPostBudget();

  constructor(
    @Inject(DrizzleAsyncProvider) private readonly db: LfgDb,
    private readonly clientService: DiscordBotClientService,
    private readonly channelBindings: ChannelBindingsService,
    private readonly settingsService: SettingsService,
    private readonly board: LfgBoardService,
    private readonly events: EventEmitter2,
    private readonly chain: LfgGameChainService,
    // ROK-2352: global in production; optional so unit specs that predate
    // groups construct the service unchanged (keyed pass then skipped).
    @Optional() private readonly pluginRegistry?: PluginRegistryService,
  ) {}

  /**
   * Per-game work chain (ROK-1454 D8). The map itself moved to
   * `LfgGameChainService` in ROK-1523 so the board's retire pass can queue on
   * the SAME chain — see that file for why two lifecycle events for one game
   * must not interleave. This stays as the service's own seam so every call
   * site reads unchanged.
   */
  private serialized(gameId: number, work: () => Promise<void>): Promise<void> {
    return this.chain.serialized(gameId, work);
  }

  /**
   * Resolve once every queued handler for `gameId` has run. The emitter never
   * awaits these handlers (rule 1), so a caller that has just emitted has no
   * other way to observe the row the handler will leave behind — the ROK-1505
   * AC4 parity walk reads the ledger through this. Not used by product code.
   *
   * @param gameId - Game whose chain to drain.
   */
  settle(gameId: number): Promise<void> {
    return this.chain.settle(gameId);
  }

  /**
   * ROK-1523 — the board came back on: re-post the groups that are still live.
   *
   * The disable pass closed every row it retired, so from here every live
   * group is simply UNTRACKED — which is precisely the condition
   * {@link reconcileUntrackedGroups} already exists to heal (it is the same
   * shape as "the group crossed the floor while the bot was down"). No new
   * posting path, and no new hand required: a card appears for every game that
   * still has a live hand up.
   *
   * Subscribed here rather than called by the board: `LfmEmbedModule` imports
   * `LfgBoardModule`, so a direct call in the other direction is a module
   * cycle. The event is emitted only AFTER the toggle listener has finished
   * provisioning the forum, so this never races it into creating a second one.
   */
  @OnEvent(LFG_BOARD_EVENTS.ENABLED)
  async onBoardEnabled(): Promise<void> {
    if (!this.clientService.isConnected()) return; // E1
    try {
      await this.reconcileUntrackedGroups();
    } catch (err) {
      this.warn('re-post the LFM messages after the board was enabled', err);
    }
  }

  /**
   * ROK-1505 D1 — the 0 → 1 transition: post the board's LOOKING thread.
   *
   * The same walk as `onLfmReached`: an existing `open` row is a re-fire or a
   * restart and is edited; no row means `postNew`, which applies D3's
   * forum-only rule — below `LFM_FLOOR` nothing is posted to a text channel.
   *
   * @param payload - `HAND_RAISED`, the same shape as `LFM_REACHED`.
   */
  @OnEvent(LFG_EVENTS.HAND_RAISED)
  onHandRaised(payload: LfgHandRaisedPayload): Promise<void> {
    if (!this.clientService.isConnected()) return Promise.resolve(); // E1
    return this.serialized(payload.gameId, () => this.postOrHeal(payload));
  }

  /**
   * The 1 → 2 transition: post the group's message, or heal a re-fire.
   *
   * An existing `open` row means the event fired twice, fired again after a
   * restart, or (ROK-1505 D2) is the LOOKING post the first hand created —
   * either way the group already has a message, so this edits it in place
   * rather than posting a second one. Same thread, same starter message.
   *
   * @param payload - `LFM_REACHED`, carrying only the game.
   */
  @OnEvent(LFG_EVENTS.LFM_REACHED)
  onLfmReached(payload: LfgLfmReachedPayload): Promise<void> {
    if (!this.clientService.isConnected()) return Promise.resolve(); // E1
    return this.serialized(payload.gameId, () => this.postOrHeal(payload));
  }

  private async postOrHeal(payload: LfgLfmReachedPayload): Promise<void> {
    try {
      const game = await loadLfmGame(this.db, payload.gameId);
      if (!game) return;
      // ROK-2352: the `''` row; with an adapter active its read is `''` only.
      const existing = await findOpenLfmMessage(this.db, game.id);
      // A hidden or banned game never gets a NEW public post (the rule
      // `requireVisibleGame` applies to every LFG write); an open one is still
      // edited, like the group page still reads it.
      if (!existing && !isVisibleGame(game)) return;
      // ROK-1494 AC7 — `currentView`, never a bare `liveView`: a game whose
      // session has already spawned has an empty live group, and a second
      // LFM_REACHED would otherwise paint `0 looking` over `PLAYING NOW`.
      const read = await readAnyGroup(this.db, this.pluginRegistry, game);
      if (nothingToPost(read)) {
        // Only keyed hands are up — the keyed pass below owns them.
      } else if (existing) await this.editRow(existing, read.view);
      else await this.postNew(game.id, read.view);
    } catch (err) {
      this.warn(`post the LFM message for game ${payload.gameId}`, err);
    }
    await this.syncKeyed(payload.gameId);
  }

  /** ROK-2352 — the keyed pass (`lfm-embed.keyed-pass.helpers.ts`). */
  private syncKeyed(gameId: number): Promise<void> {
    return runKeyedPass(this.keyedDeps(), gameId);
  }

  /** {@link reconcileDeps} plus the registry and the post seam. */
  private keyedDeps(): LfmKeyedPassDeps {
    return {
      ...this.reconcileDeps(),
      registry: this.pluginRegistry,
      postBudget: this.keyedPostBudget,
      postNew: (gameId, view) => this.postNew(gameId, view),
    };
  }

  /**
   * Any later change of shape: re-read per D6 and edit the message in place.
   *
   * No `open` row means the group never reached LFM (a 1 → 0 withdrawal) or is
   * already closed. Both are the quiet case — return, write nothing (E4).
   *
   * @param payload - `GROUP_CHANGED`, carrying the reason and any provenance.
   */
  @OnEvent(LFG_EVENTS.GROUP_CHANGED)
  onGroupChanged(payload: LfgGroupChangedPayload): Promise<void> {
    if (!this.clientService.isConnected()) return Promise.resolve(); // E1
    return this.serialized(payload.gameId, () => this.editForChange(payload));
  }

  private async editForChange(payload: LfgGroupChangedPayload): Promise<void> {
    try {
      const row = await findOpenLfmMessage(this.db, payload.gameId);
      if (row) await this.editOpenRow(row, payload); // else E4
    } catch (err) {
      this.warn(`edit the LFM message for game ${payload.gameId}`, err);
    }
    await this.syncKeyed(payload.gameId);
  }

  /** The `''` row's edit for one change (the pre-ROK-2352 body). */
  private async editOpenRow(
    row: LfmMessageRow,
    payload: LfgGroupChangedPayload,
  ): Promise<void> {
    const game = await loadLfmGame(this.db, payload.gameId);
    if (!game) return;
    const view = await viewForChange(
      this.db,
      game,
      row.lastMemberCount,
      payload,
      this.logger,
      liveFloorFor(row.postKind),
      anyGroupScope(this.pluginRegistry, game),
    );
    if (view) await this.editRow(row, view);
  }

  /**
   * D9 — reconcile every `open` row against reality after a reconnect.
   *
   * Without this a group that ended while the bot was down leaves an `open`
   * row forever, and the partial unique index then stops that game from EVER
   * posting an LFM message again. A latent permanent wedge, not a cosmetic
   * gap — which is why it runs on every CONNECTED, not just the first.
   */
  @OnEvent(DISCORD_BOT_EVENTS.CONNECTED)
  async onConnected(): Promise<void> {
    try {
      await this.reconcileOpenRows();
      await this.reconcileUntrackedGroups();
      await reconcileKeyedGroups(this.keyedDeps());
    } catch (err) {
      this.warn('reconcile open LFM messages', err);
    }
  }

  /** D9 — deliberately a no-op. Every byte of state is in the table. */
  @OnEvent(DISCORD_BOT_EVENTS.DISCONNECTED)
  onDisconnected(): void {
    this.logger.debug('LFM message state is persisted; nothing to drop.');
  }

  /**
   * D9's worklist pass, in `lfm-embed.reconcile.helpers.ts`. Delegates to the
   * module function of the same name with this service's collaborators.
   */
  private reconcileOpenRows(): Promise<void> {
    return reconcileOpenRows(this.reconcileDeps());
  }

  /** The collaborators the reconcile walk needs, bound to this service. */
  private reconcileDeps(): LfmReconcileDeps {
    return {
      db: this.db,
      registry: this.pluginRegistry,
      serialized: (gameId, work) => this.serialized(gameId, work),
      editRow: (row, view) => this.editRow(row, view),
      warn: (action, err) => this.warn(action, err),
    };
  }

  /** E1's other half — `reconcileUntrackedGroups` in the reconcile module. */
  private reconcileUntrackedGroups(): Promise<void> {
    return reconcileUntrackedGroups(this.keyedDeps());
  }

  /**
   * The collaborators {@link retireOpenRow} needs, bound to this service.
   *
   * @returns The datasource, the thread editor and this logger's warn sink.
   */
  private retireDeps(): RetireRowDeps {
    return {
      db: this.db,
      editThread: (row, view, context) =>
        this.board.editThread(row, view, context),
      warn: (message) => {
        this.logger.warn(message);
      },
      isBoardEnabled: () => getLfgBoardEnabled(this.settingsService),
    };
  }

  /**
   * Edit the tracked message, then persist what the edit rendered.
   *
   * ROK-1471: the SURFACE is pinned on the row, not re-decided here — a row
   * posted to text stays on text even after the operator enables the board
   * (E4/E5). The forum adapter deliberately lets Discord's errors through, so
   * the heal + close-anyway rules below apply identically to both surfaces.
   */
  private async editRow(row: LfmMessageRow, view: LfmGroupView): Promise<void> {
    const context = await this.context();
    if (await this.retiresInstead(row, view)) {
      await retireOpenRow(this.retireDeps(), row, context);
      return;
    }
    try {
      if (row.postKind === 'forum') {
        await this.board.editThread(row, view, context);
      } else {
        const { embed } = buildLfmEmbed(view, context);
        await this.clientService.editEmbed(row.channelId, row.messageId, embed);
      }
    } catch (err) {
      if (isUnknownMessageError(err)) {
        await this.healDeleted(row, view);
        return;
      }
      // A terminal render Discord refused (channel gone, access revoked) still
      // ends the group: close the row anyway, or the partial unique index holds
      // the game hostage to a message nobody can edit — AC9's wedge class. An
      // OPEN render is left for the next event / reconcile to retry.
      if (!TERMINAL_STATE[view.state]) throw err;
      this.warn(`render the final LFM state for game ${row.gameId}`, err);
    }
    await this.persist(row, view);
  }

  /**
   * ROK-1523 — must this write RETIRE the post rather than render `view`?
   *
   * A FORUM row still open while the board is off is a retire that did not
   * finish, whichever writer finds it: the reconnect, or the next +1 / hand /
   * withdraw. Rendering the live view instead would be worse than a no-op —
   * `editThread` unarchives before it edits, so the switched-off board gets
   * its live card back. So every such write re-runs THE retire
   * (`retireOpenRow`, the same function the disable pass runs), whose
   * transient-vs-permanent rules are the ones that belong to a retire.
   *
   * Only a LIVE view is a candidate. A terminal one means the group ended on
   * its own — converted, expired — and a board-off card over it would say
   * "still live on the site" about a group that is not. Text rows are
   * ROK-1454's; the toggle does not govern them.
   *
   * @param row - The open row about to be written.
   * @param view - The render the caller decided on.
   * @returns True when the retire should run instead of the render.
   */
  private async retiresInstead(
    row: LfmMessageRow,
    view: LfmGroupView,
  ): Promise<boolean> {
    if (row.postKind !== 'forum' || isTerminalRender(view.state)) return false;
    return !(await getLfgBoardEnabled(this.settingsService));
  }

  /** Stamp the head-count, and close the row when the render was terminal. */
  private async persist(row: LfmMessageRow, view: LfmGroupView): Promise<void> {
    const terminal = TERMINAL_STATE[view.state];
    if (terminal) {
      await closeLfmMessage(this.db, row.id, terminal, view.memberCount);
    } else {
      await recordLfmRender(this.db, row.id, view.memberCount);
    }
  }

  /**
   * E3 — a human deleted the message.
   *
   * Still open: drop the row and post a replacement, so the group keeps a live
   * message — and put the row back if no replacement lands (TDB:954).
   * Terminal: there is nothing left to keep alive, so just close the row —
   * re-posting a final card into a channel someone deliberately cleared would
   * be noise.
   */
  private async healDeleted(
    row: LfmMessageRow,
    view: LfmGroupView,
  ): Promise<void> {
    const terminal = TERMINAL_STATE[view.state];
    if (terminal) {
      await closeLfmMessage(this.db, row.id, terminal, view.memberCount);
      return;
    }
    await replaceDeletedPost(this.postDeps(await this.context()), row, view);
  }

  /**
   * Post the group's message and start tracking it (ROK-1471 D2). The surface
   * decision lives in `lfm-embed.post.helpers.ts`; this is the seam the first
   * post and the offline reconcile go through. The heal enters the same module
   * via `replaceDeletedPost`, handing over the same `postDeps` bag.
   */
  private async postNew(gameId: number, view: LfmGroupView): Promise<void> {
    await postNew(this.postDeps(await this.context()), gameId, view);
  }

  /** The bag `postNew` reads — the service's collaborators plus the chrome. */
  private postDeps(context: EmbedContext): LfmPostDeps {
    return {
      db: this.db,
      board: this.board,
      clientService: this.clientService,
      channelDeps: this.channelDeps(),
      surfaceDeps: this.surfaceDeps(),
      events: this.events,
      context,
    };
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

  /** The narrowed dependency bag `resolveLfmChannel` reads (D3). */
  private channelDeps(): LfmChannelDeps {
    return {
      clientService: this.clientService,
      channelBindings: this.channelBindings,
      settingsService: this.settingsService,
      logger: this.logger,
    };
  }

  /**
   * `channelDeps` plus the two things the forum branch needs (ROK-1471 D2).
   *
   * `LfgBoardService` is injected as the forum RESOLVER, not as a second event
   * subscriber: exactly one service acts per event, structurally.
   */
  private surfaceDeps(): LfgBoardSurfaceDeps {
    return {
      ...this.channelDeps(),
      settingsService: this.settingsService,
      channelService: this.board,
      guild: this.clientService.getGuild(),
    };
  }

  /** Log and swallow. An emitter-side throw is a 500 on someone's signup. */
  private warn(action: string, err: unknown): void {
    const message = err instanceof Error ? err.message : String(err);
    this.logger.warn(`Failed to ${action}: ${message}`);
  }
}
