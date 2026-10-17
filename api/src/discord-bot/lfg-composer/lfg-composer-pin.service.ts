/**
 * ROK-1612 AC1 — keeps the composer card pinned in "the LFG channel".
 *
 * ROK-1658: there is no separate opt-in. The composer is on whenever the LFG
 * board is on (`lfg_board_enabled`), and comes down when the board is turned
 * off.
 *
 * Operator ruling 2026-09-22 ("pin it"): the card is a real Discord pin, not a
 * delete-and-repost that chases the last message. So there is no debounce and
 * no race with the board's `flushAll`: this runs on three rare events — the bot
 * connecting, the board being switched on (after provisioning) and the board
 * being switched off — and each run EDITS the card it already pinned.
 * `ensurePinnedComposer` owns the idempotency; this file only decides where
 * the card goes.
 *
 * Where "the LFG channel" is:
 *
 *  - **Forum board (the default surface).** A forum holds no plain messages
 *    and Discord allows ONE pinned post per forum — already the board's intro
 *    post (`LFG_BOARD_INTRO_TITLE`, `LfgBoardToggleListener`). A second pinned
 *    post would fail or unpin the intro, so the composer's buttons ride on that
 *    pinned post's starter message instead. Edited in place, never re-posted.
 *  - **A text channel bound with the `lfg-board` purpose** (a legacy row: new
 *    `lfg-board` bindings are forum-only). The card is posted and pinned there
 *    (Manage Messages), on whenever the board is on (ROK-1658).
 *
 * Runs are SERIALISED on one promise chain. The triggers (connect, board on,
 * board off) can overlap, and two interleaved runs would each scan an
 * empty channel and post a card apiece — or an OFF run would scan before an
 * ON run's post landed and leave the card up. One chain, not one per
 * channel: the target is resolved INSIDE the run from the current settings,
 * so each queued run acts on the state at its turn, never at its trigger.
 *
 * Nothing here throws: every trigger is an `@OnEvent` handler and a Discord
 * refusal must be one log line, never a crash-loop (AC7).
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ChannelType, type Guild, type ThreadChannel } from 'discord.js';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import type { LfgDb } from '../../lfg/lfg-query.helpers';
import { SettingsService } from '../../settings/settings.service';
import {
  getLfgBoardEnabled,
  getLfgBoardIntroThreadId,
} from '../../settings/settings-lfg-board.helpers';
import { DISCORD_BOT_EVENTS } from '../discord-bot.constants';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { findLfgBoardBindingChannelId } from '../lfg-board/lfg-board-channel.db-helpers';
import { isLegacyIntroTitle } from '../lfg-board/lfg-board-discovery.helpers';
import {
  LFG_BOARD_EVENTS,
  LFG_BOARD_INTRO_BODY,
  LFG_BOARD_INTRO_TITLE,
  type LfgBoardToggledPayload,
} from '../lfg-board/lfg-board.constants';
import { buildComposerCard, sameComponents } from './lfg-composer-card.helpers';
import {
  ensurePinnedComposer,
  isOwnComposer,
  removeComposers,
  type ComposerChannel,
  type ComposerPayload,
  type ComposerPinOutcome,
} from './lfg-composer-pin.helpers';

/** What a reconcile did — returned so the spec can assert without a logger. */
export type ComposerReconcileOutcome =
  | ComposerPinOutcome
  | 'intro-edited'
  | 'intro-unchanged'
  | 'intro-cleared'
  | 'removed'
  | 'no-target';

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

@Injectable()
export class LfgComposerPinService {
  private readonly logger = new Logger(LfgComposerPinService.name);
  /** Channels already warned about a refused pin — AC7's "log once". */
  private readonly warned = new Set<string>();
  /** The tail of the reconcile queue — every run waits for the one before. */
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly clientService: DiscordBotClientService,
    private readonly settingsService: SettingsService,
    @Inject(DrizzleAsyncProvider) private readonly db: LfgDb,
  ) {}

  @OnEvent(DISCORD_BOT_EVENTS.CONNECTED)
  async onConnected(): Promise<void> {
    await this.reconcile();
  }

  /** Emitted AFTER the toggle listener has seeded + pinned the intro post. */
  @OnEvent(LFG_BOARD_EVENTS.ENABLED)
  async onBoardEnabled(): Promise<void> {
    await this.reconcile();
  }

  /**
   * ROK-1658 — the board was switched OFF: take the composer down now. That
   * strips the intro post's buttons AND deletes any card in a legacy text
   * binding. The ON branch is ignored here: {@link onBoardEnabled} handles it
   * once provisioning has created the intro post.
   *
   * Runs concurrently with the toggle listener's `retireOpenPosts`, which is
   * safe: they touch different messages (retire never touches the intro).
   */
  @OnEvent(LFG_BOARD_EVENTS.TOGGLED)
  async onBoardToggled(payload?: LfgBoardToggledPayload): Promise<void> {
    if (payload?.enabled) return;
    await this.reconcile();
  }

  /**
   * Put the composer card where it belongs, editing any card already there.
   *
   * @returns What was done, or null when the attempt failed (already logged).
   */
  reconcile(): Promise<ComposerReconcileOutcome | null> {
    const run = this.chain.then(() => this.doReconcile());
    this.chain = run.catch(() => undefined);
    return run;
  }

  /** One reconcile, reading the CURRENT settings. Never throws. */
  private async doReconcile(): Promise<ComposerReconcileOutcome | null> {
    try {
      const guild = this.clientService.getGuild();
      const botUserId = this.clientService.getBotUser()?.id;
      if (!guild || !botUserId) return 'no-target';
      // ROK-1658: the composer is on exactly when the board is on.
      if (!(await getLfgBoardEnabled(this.settingsService))) {
        return await this.takeDown(guild, botUserId);
      }
      const intro = await this.forumIntro(guild);
      if (intro) {
        return await this.attachToIntro(intro, await this.payload(), botUserId);
      }
      const channel = await this.boundTextChannel(guild);
      return channel ? await this.pinIn(channel, botUserId) : 'no-target';
    } catch (err) {
      this.logger.warn(
        `Could not place the LFG composer card: ${describe(err)}.`,
      );
      return null;
    }
  }

  private async payload(): Promise<ComposerPayload> {
    return buildComposerCard(await this.settingsService.getClientUrl());
  }

  private async pinIn(
    channel: ComposerChannel,
    botUserId: string,
  ): Promise<ComposerReconcileOutcome> {
    const outcome = await ensurePinnedComposer({
      channel,
      botUserId,
      payload: await this.payload(),
      warn: (message) => this.logger.warn(message),
      warned: this.warned,
    });
    this.logger.log(`LFG composer card in ${channel.id}: ${outcome}.`);
    return outcome;
  }

  /**
   * Board off (ROK-1658) — take down BOTH homes the composer can have. A
   * stored intro id does not rule out a legacy text binding carrying a card
   * pinned while the old composer switch was on, so neither check
   * short-circuits the other — and neither's failure skips the other: each
   * cleanup has its own catch (a deleted intro's 10008 must not leave the
   * text card up).
   *
   * @returns The intro's outcome when it did something, else the text
   *   channel's; null when a cleanup failed and the other did nothing.
   */
  private async takeDown(
    guild: Guild,
    botUserId: string,
  ): Promise<ComposerReconcileOutcome | null> {
    const cleared = await this.tryTakeDown('the intro post', async () => {
      const intro = await this.forumIntro(guild);
      return intro ? this.clearIntro(intro, botUserId) : 'no-target';
    });
    const removed = await this.tryTakeDown('the bound channel', async () => {
      const channel = await this.boundTextChannel(guild);
      return channel ? this.removeFrom(channel, botUserId) : 'no-target';
    });
    if (cleared && cleared !== 'no-target') return cleared;
    if (removed && removed !== 'no-target') return removed;
    return cleared === null || removed === null ? null : 'no-target';
  }

  /** One take-down step, isolated: a failure is logged and returns null. */
  private async tryTakeDown(
    where: string,
    step: () => Promise<ComposerReconcileOutcome>,
  ): Promise<ComposerReconcileOutcome | null> {
    try {
      return await step();
    } catch (err) {
      this.logger.warn(
        `Could not take the LFG composer down from ${where}: ${describe(err)}.`,
      );
      return null;
    }
  }

  /** Board off (ROK-1658) — take down any card this bot left in the bound channel. */
  private async removeFrom(
    channel: ComposerChannel,
    botUserId: string,
  ): Promise<ComposerReconcileOutcome> {
    const removed = await removeComposers({ channel, botUserId });
    if (removed === 0) return 'no-target';
    this.logger.log(`LFG composer off: removed ${removed} card(s).`);
    return 'removed';
  }

  /** Board off (ROK-1658) on a forum board — strip the buttons, keep the intro copy. */
  private async clearIntro(
    thread: ThreadChannel,
    botUserId: string,
  ): Promise<ComposerReconcileOutcome> {
    const starter = await thread.fetchStarterMessage();
    if (!starter || !isOwnComposer(starter, botUserId)) return 'no-target';
    await starter.edit({ components: [] });
    this.logger.log(`LFG composer off: buttons cleared on ${thread.id}.`);
    return 'intro-cleared';
  }

  /**
   * The board's pinned intro post, when one has been seeded. Found whether the
   * board is on or off, so a disabled board's intro still has its buttons
   * stripped (ROK-1658).
   */
  private async forumIntro(guild: Guild): Promise<ThreadChannel | null> {
    const introId = await getLfgBoardIntroThreadId(this.settingsService);
    if (!introId) return null;
    const channel = await guild.channels.fetch(introId).catch(() => null);
    return channel?.isThread() ? channel : null;
  }

  /** The `lfg-board`-bound channel, when it is a plain text channel. */
  private async boundTextChannel(
    guild: Guild,
  ): Promise<ComposerChannel | null> {
    const boundId = await findLfgBoardBindingChannelId(this.db, guild.id);
    if (!boundId) return null;
    const channel = await guild.channels.fetch(boundId).catch(() => null);
    if (channel?.type !== ChannelType.GuildText) return null;
    return channel;
  }

  /**
   * Put the composer buttons on the forum's pinned intro post, in place.
   *
   * The intro is posted once, on first enable, so a board seeded before the
   * current copy keeps its old text. The same edit therefore also brings the
   * content up to {@link LFG_BOARD_INTRO_BODY} (ROK-1658) — ONE edit carrying
   * both, and none at all when both already match. The post is bot-authored,
   * so the bot may edit it.
   */
  private async attachToIntro(
    thread: ThreadChannel,
    payload: ComposerPayload,
    botUserId: string,
  ): Promise<ComposerReconcileOutcome> {
    const starter = await thread.fetchStarterMessage();
    if (!starter || starter.author.id !== botUserId) return 'no-target';
    await this.renameLegacyIntro(thread, botUserId);
    const copyCurrent = starter.content === LFG_BOARD_INTRO_BODY;
    if (copyCurrent && sameComponents(starter.components, payload.components)) {
      return 'intro-unchanged';
    }
    await starter.edit({
      content: LFG_BOARD_INTRO_BODY,
      components: payload.components,
    });
    this.logger.log(`LFG composer buttons set on the intro post ${thread.id}.`);
    return 'intro-edited';
  }

  /**
   * ROK-1658 — give an intro seeded under a legacy title ("How this board
   * works") the current {@link LFG_BOARD_INTRO_TITLE}, which advertises the
   * `Post an LFG` button inside it. Renamed in place (same thread id), so the
   * stored id and the pin survive.
   *
   * Once: only a bot-owned thread still carrying a LEGACY title is renamed, so
   * every later pass finds the current title and does nothing — and a thread
   * someone renamed by hand to anything else is left alone. Advisory: a
   * refusal is one log line and never blocks the buttons/body edit.
   */
  private async renameLegacyIntro(
    thread: ThreadChannel,
    botUserId: string,
  ): Promise<void> {
    if (thread.ownerId !== botUserId || !isLegacyIntroTitle(thread.name)) {
      return;
    }
    try {
      await thread.setName(
        LFG_BOARD_INTRO_TITLE,
        'Raid Ledger LFG board intro title (ROK-1658)',
      );
      this.logger.log(`LFG board intro post ${thread.id} renamed.`);
    } catch (err) {
      this.logger.warn(
        `Could not rename the LFG board intro post ${thread.id}: ` +
          `${describe(err)}. Its buttons and copy are still set.`,
      );
    }
  }
}
