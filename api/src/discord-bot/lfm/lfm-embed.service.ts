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
import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
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
import { LfgBoardService } from '../lfg-board/lfg-board.service';
import type { LfgBoardSurfaceDeps } from '../lfg-board/lfg-board-surface.helpers';
import type { LfmChannelDeps } from './lfm-channel.helpers';
import { postNew, type LfmPostDeps } from './lfm-embed.post.helpers';
import {
  buildLfmEmbed,
  TERMINAL_STATE,
  type LfmGroupView,
} from './lfm-embed.helpers';
import {
  convertedView,
  currentView,
  expiredView,
  liveFloorFor,
  liveView,
  sessionView,
  viewForChange,
} from './lfm-embed.views';
import {
  closeLfmMessage,
  deleteLfmMessage,
  findOpenLfmMessage,
  latestConversionTarget,
  listOpenLfmMessages,
  listUntrackedLfmGames,
  loadLfmGame,
  recordLfmRender,
  type LfmGameRow,
  type LfmMessageRow,
} from './lfm-embed.db-helpers';

/** Below this many live members a group is over, not merely thinner (E12). */
@Injectable()
export class LfmEmbedService {
  private readonly logger = new Logger(LfmEmbedService.name);

  constructor(
    @Inject(DrizzleAsyncProvider) private readonly db: LfgDb,
    private readonly clientService: DiscordBotClientService,
    private readonly channelBindings: ChannelBindingsService,
    private readonly settingsService: SettingsService,
    private readonly board: LfgBoardService,
  ) {}

  /**
   * Per-game work chain. Two lifecycle events for one game can overlap — a
   * third hand arriving while the first post is still awaiting Discord, a
   * withdrawal racing a conversion — and an older render landing after a
   * terminal one would put an OPEN-looking embed back on a row that is
   * closed, which the reconcile then never revisits. Chaining per game makes
   * every handler see exactly the row the previous one left behind.
   */
  private readonly chains = new Map<number, Promise<void>>();

  private serialized(gameId: number, work: () => Promise<void>): Promise<void> {
    const prev = this.chains.get(gameId) ?? Promise.resolve();
    const next = prev.then(work, work).finally(() => {
      if (this.chains.get(gameId) === next) this.chains.delete(gameId);
    });
    this.chains.set(gameId, next);
    return next;
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
    return this.chains.get(gameId) ?? Promise.resolve();
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
      // ROK-1494 AC7 — `currentView`, never a bare `liveView`: a game whose
      // session has already spawned has an empty live group, and a second
      // LFM_REACHED would otherwise paint `0 looking` over `PLAYING NOW`.
      const view = await currentView(this.db, game);
      const existing = await findOpenLfmMessage(this.db, game.id);
      if (existing) await this.editRow(existing, view);
      else await this.postNew(game.id, view);
    } catch (err) {
      this.warn(`post the LFM message for game ${payload.gameId}`, err);
    }
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
      if (!row) return; // E4
      const game = await loadLfmGame(this.db, payload.gameId);
      if (!game) return;
      const view = await viewForChange(
        this.db,
        game,
        row.lastMemberCount,
        payload,
        this.logger,
        liveFloorFor(row.postKind),
      );
      if (view) await this.editRow(row, view);
    } catch (err) {
      this.warn(`edit the LFM message for game ${payload.gameId}`, err);
    }
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
    } catch (err) {
      this.warn('reconcile open LFM messages', err);
    }
  }

  /** D9 — deliberately a no-op. Every byte of state is in the table. */
  @OnEvent(DISCORD_BOT_EVENTS.DISCONNECTED)
  onDisconnected(): void {
    this.logger.debug('LFM message state is persisted; nothing to drop.');
  }

  /** One pass over the worklist. One bad row must not abort the rest. */
  private async reconcileOpenRows(): Promise<void> {
    for (const row of await listOpenLfmMessages(this.db)) {
      try {
        await this.serialized(row.gameId, () => this.reconcileRow(row));
      } catch (err) {
        this.warn(`reconcile the LFM message for game ${row.gameId}`, err);
      }
    }
  }

  /**
   * E1's other half. A group that crossed the floor while the bot was down has
   * NO row at all — `onLfmReached` returned before writing one — so the walk
   * above cannot see it. Post it now, exactly as the dropped `LFM_REACHED`
   * would have.
   */
  private async reconcileUntrackedGroups(): Promise<void> {
    for (const gameId of await listUntrackedLfmGames(this.db)) {
      try {
        await this.serialized(gameId, async () => {
          const game = await loadLfmGame(this.db, gameId);
          if (!game) return;
          await this.postNew(game.id, await currentView(this.db, game));
        });
      } catch (err) {
        this.warn(
          `post the LFM message missed offline for game ${gameId}`,
          err,
        );
      }
    }
  }

  /**
   * Re-render one `open` row. A group still at or above the floor is simply
   * re-rendered; below it the group ended offline, and the only surviving
   * evidence of HOW is the provenance FK the conversion wrote.
   */
  private async reconcileRow(row: LfmMessageRow): Promise<void> {
    const game = await loadLfmGame(this.db, row.gameId);
    if (!game) return;
    await this.editRow(row, await this.reconcileView(row, game));
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
   * @param row - The `open` row being reconciled.
   * @param game - Its game, already loaded.
   * @returns The view to render.
   */
  private async reconcileView(
    row: LfmMessageRow,
    game: LfmGameRow,
  ): Promise<LfmGroupView> {
    // ROK-1494 AC7 — `sessionView` is the SHARED answer; `viewForChange` asks
    // the same helper, so the hot path and the reconcile cannot disagree.
    const session = await sessionView(this.db, game);
    if (session) return session;
    const liveGroup = await liveView(this.db, game);
    if (liveGroup.memberCount >= liveFloorFor(row.postKind)) return liveGroup;
    const target = await latestConversionTarget(
      this.db,
      row.gameId,
      row.postedAt,
    );
    return target
      ? convertedView(this.db, game, target)
      : expiredView(game, row.lastMemberCount);
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
   * message. Terminal: there is nothing left to keep alive, so just close the
   * row — re-posting a final card into a channel someone deliberately cleared
   * would be noise.
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
    await deleteLfmMessage(this.db, row.id);
    await this.postNew(row.gameId, view);
  }

  /**
   * Post the group's message and start tracking it (ROK-1471 D2). The surface
   * decision lives in `lfm-embed.post.helpers.ts`; this is the service's one
   * seam into it, so every caller — first post, heal, offline reconcile —
   * hands over the same collaborators.
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
