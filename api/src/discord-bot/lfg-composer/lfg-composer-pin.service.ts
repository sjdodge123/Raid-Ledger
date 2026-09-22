/**
 * ROK-1612 AC1 — keeps the composer card pinned in "the LFG channel".
 *
 * Operator ruling 2026-09-22 ("pin it"): the card is a real Discord pin, not a
 * delete-and-repost that chases the last message. So there is no debounce and
 * no race with the board's `flushAll`: this runs on two rare events — the bot
 * connecting, and the board being switched on — and each run EDITS the card it
 * already pinned. `ensurePinnedComposer` owns the idempotency; this file only
 * decides where the card goes.
 *
 * Where "the LFG channel" is:
 *
 *  - **Forum board (the default surface).** A forum holds no plain messages
 *    and Discord allows ONE pinned post per forum — already the board's intro
 *    post ("How this board works", `LfgBoardToggleListener`). A second pinned
 *    post would fail or unpin the intro, so the composer's buttons ride on that
 *    pinned post's starter message instead. Edited in place, never re-posted.
 *  - **A text channel bound with the `lfg-board` purpose.** The card is posted
 *    and pinned there (Manage Messages). A binding is how a guild opts in
 *    (AC6): no binding, no card.
 *
 * Nothing here throws: both triggers are `@OnEvent` handlers and a Discord
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
  getLfgComposerEnabled,
} from '../../settings/settings-lfg-board.helpers';
import { DISCORD_BOT_EVENTS } from '../discord-bot.constants';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { findLfgBoardBindingChannelId } from '../lfg-board/lfg-board-channel.db-helpers';
import { LFG_BOARD_EVENTS } from '../lfg-board/lfg-board.constants';
import { buildComposerCard } from './lfg-composer-card.helpers';
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

  /** AC6 — the admin toggle flipped: place or remove the card right away. */
  @OnEvent(LFG_BOARD_EVENTS.COMPOSER_TOGGLED)
  async onComposerToggled(): Promise<void> {
    await this.reconcile();
  }

  /**
   * Put the composer card where it belongs, editing any card already there.
   *
   * @returns What was done, or null when the attempt failed (already logged).
   */
  async reconcile(): Promise<ComposerReconcileOutcome | null> {
    try {
      const guild = this.clientService.getGuild();
      const botUserId = this.clientService.getBotUser()?.id;
      if (!guild || !botUserId) return 'no-target';
      const enabled = await getLfgComposerEnabled(this.settingsService);
      const intro = await this.forumIntro(guild);
      if (intro) {
        return enabled
          ? await this.attachToIntro(intro, await this.payload(), botUserId)
          : await this.clearIntro(intro, botUserId);
      }
      const channel = await this.boundTextChannel(guild);
      if (!channel) return 'no-target';
      return enabled
        ? await this.pinIn(channel, botUserId)
        : await this.removeFrom(channel, botUserId);
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

  /** AC6 off — take down any card this bot left in the bound channel. */
  private async removeFrom(
    channel: ComposerChannel,
    botUserId: string,
  ): Promise<ComposerReconcileOutcome> {
    const removed = await removeComposers({ channel, botUserId });
    if (removed === 0) return 'no-target';
    this.logger.log(`LFG composer off: removed ${removed} card(s).`);
    return 'removed';
  }

  /** AC6 off on a forum board — strip the buttons, keep the intro copy. */
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

  /** The board's pinned intro post, when the forum board is on and seeded. */
  private async forumIntro(guild: Guild): Promise<ThreadChannel | null> {
    if (!(await getLfgBoardEnabled(this.settingsService))) return null;
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
   * Content is left alone — the intro text is the board's own copy; only the
   * button row is set, so a second run writes the same row over itself.
   */
  private async attachToIntro(
    thread: ThreadChannel,
    payload: ComposerPayload,
    botUserId: string,
  ): Promise<ComposerReconcileOutcome> {
    const starter = await thread.fetchStarterMessage();
    if (!starter || starter.author.id !== botUserId) return 'no-target';
    await starter.edit({ components: payload.components });
    this.logger.log(`LFG composer buttons set on the intro post ${thread.id}.`);
    return 'intro-edited';
  }
}
