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
  type LfgLfmReachedPayload,
} from '../../lfg/lfg.constants';
import type { LfgDb } from '../../lfg/lfg-query.helpers';
import { resolveLfmChannel, type LfmChannelDeps } from './lfm-channel.helpers';
import {
  buildLfmEmbed,
  type LfmGroupView,
  type LfmRenderState,
} from './lfm-embed.helpers';
import {
  conversionTarget,
  convertedView,
  expiredView,
  liveView,
} from './lfm-embed.views';
import {
  closeLfmMessage,
  deleteLfmMessage,
  findOpenLfmMessage,
  insertLfmMessage,
  latestConversionTarget,
  listOpenLfmMessages,
  listUntrackedLfmGames,
  loadLfmGame,
  recordLfmRender,
  type LfmGameRow,
  type LfmMessageRow,
  type LfmTerminalState,
  LFM_FLOOR,
} from './lfm-embed.db-helpers';

/**
 * Render state to row state. `open` maps to null — the row stays live and only
 * its head-count is stamped.
 */
const TERMINAL_STATE: Record<LfmRenderState, LfmTerminalState | null> = {
  open: null,
  scheduled: 'converted',
  expired: 'expired',
  closed: 'closed',
};

/** Below this many live members a group is over, not merely thinner (E12). */
@Injectable()
export class LfmEmbedService {
  private readonly logger = new Logger(LfmEmbedService.name);

  constructor(
    @Inject(DrizzleAsyncProvider) private readonly db: LfgDb,
    private readonly clientService: DiscordBotClientService,
    private readonly channelBindings: ChannelBindingsService,
    private readonly settingsService: SettingsService,
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
   * The 1 → 2 transition: post the group's message, or heal a re-fire.
   *
   * An existing `open` row means the event fired twice, or fired again after a
   * restart — either way the group already has a message, so this edits it
   * rather than posting a second one.
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
      const view = await liveView(this.db, game);
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
      const view = await this.viewForReason(game, row, payload);
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
          if (game) await this.postNew(game.id, await liveView(this.db, game));
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
    const liveGroup = await liveView(this.db, game);
    if (liveGroup.memberCount >= LFM_FLOOR) {
      await this.editRow(row, liveGroup);
      return;
    }
    const target = await latestConversionTarget(
      this.db,
      row.gameId,
      row.postedAt,
    );
    const view = target
      ? await convertedView(this.db, game, target)
      : expiredView(game, row.lastMemberCount);
    await this.editRow(row, view);
  }

  /** D6 — the reason picks the read. Null means "cannot render, leave it". */
  private async viewForReason(
    game: LfmGameRow,
    row: LfmMessageRow,
    payload: LfgGroupChangedPayload,
  ): Promise<LfmGroupView | null> {
    if (payload.reason === 'expired') {
      // "A row of this game expired" is not "this group died": an ineligible
      // holder's stale hand expires alone while the eligible members, whose
      // clocks every +1 refreshed, stay live. Re-read exactly as `reconcileRow`
      // does and only go terminal below the floor.
      const live = await liveView(this.db, game);
      return live.memberCount >= LFM_FLOOR
        ? live
        : expiredView(game, row.lastMemberCount);
    }
    if (payload.reason === 'converted') {
      const target = conversionTarget(payload);
      if (!target) {
        this.logger.warn(
          `Converted LFM group for game ${game.id} carries no provenance; leaving the message open for reconcile.`,
        );
        return null;
      }
      return convertedView(this.db, game, target);
    }
    const view = await liveView(this.db, game);
    // E12: 3 -> 2 is still LFM. Only dropping below the floor is terminal.
    if (payload.reason === 'withdrawn' && view.memberCount < LFM_FLOOR) {
      view.state = 'closed';
    }
    return view;
  }

  /** Edit the tracked message, then persist what the edit rendered. */
  private async editRow(row: LfmMessageRow, view: LfmGroupView): Promise<void> {
    const { embed } = buildLfmEmbed(view, await this.context());
    try {
      await this.clientService.editEmbed(row.channelId, row.messageId, embed);
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

  /** Post the group's message and start tracking it. `content` first post only. */
  private async postNew(gameId: number, view: LfmGroupView): Promise<void> {
    const target = await resolveLfmChannel(this.channelDeps(), gameId);
    if (!target) return; // E2 — warned inside the resolver, never thrown.
    const { embed, content } = buildLfmEmbed(view, await this.context());
    const message = await this.clientService.sendEmbed(
      target.channelId,
      embed,
      undefined,
      content,
    );
    await insertLfmMessage(this.db, {
      gameId,
      guildId: target.guildId,
      channelId: target.channelId,
      messageId: message.id,
      lastMemberCount: view.memberCount,
    });
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

  /** Log and swallow. An emitter-side throw is a 500 on someone's signup. */
  private warn(action: string, err: unknown): void {
    const message = err instanceof Error ? err.message : String(err);
    this.logger.warn(`Failed to ${action}: ${message}`);
  }
}
