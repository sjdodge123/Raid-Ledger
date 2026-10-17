/**
 * ROK-1454 D11 — the `Leave · {game}` buttons on a `/lfg` list reply
 * (labelled `Withdraw · {game}` before ROK-1660; the custom id is unchanged so
 * lists already sent keep working).
 *
 * IDENTITY COMES FROM THE INTERACTION, NEVER FROM THE CUSTOM ID. The button
 * carries only a game id; the user id is resolved from `interaction.user.id`
 * and handed to `LfgService.withdraw`, which scopes its UPDATE to that user's
 * own row. A replayed or hand-crafted custom id therefore withdraws the
 * clicker's intent or nothing at all — never somebody else's.
 *
 * `LFG_BUTTON_IDS.JOIN` is deliberately NOT matched here: ROK-1471 owns the
 * `+1` button and wires its handler on the forum board.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { MessageFlags } from 'discord.js';
import type { ButtonInteraction } from 'discord.js';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import { LfgService } from '../../lfg/lfg.service';
import { SettingsService } from '../../settings/settings.service';
import { DISCORD_BOT_EVENTS } from '../discord-bot.constants';
import { DiscordBotClientService } from '../discord-bot-client.service';
import {
  LFG_BLOCKED_REPLY,
  LFG_UNLINKED_REPLY,
  buildListReply,
  parseWithdrawCustomId,
  type LfgReplyContext,
} from '../commands/lfg.command.helpers';
import { loadLfgReplyContext, resolveLfgCaller } from '../commands/lfg.command';
import {
  DiscordListenerBinding,
  gatewayBinding,
} from './discord-listener-binding';
import {
  LFG_LEAVE_ERROR_REPLY,
  buildLeftReply,
  buildNotInGroupReply,
  lookupLfgGameName,
  withdrawIfPresent,
} from './lfg-leave.helpers';

@Injectable()
export class LfgWithdrawListener {
  private readonly logger = new Logger(LfgWithdrawListener.name);
  private readonly binding = new DiscordListenerBinding(
    this.logger,
    'LFG withdraw interactions',
  );

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly clientService: DiscordBotClientService,
    private readonly lfgService: LfgService,
    private readonly settingsService: SettingsService,
  ) {}

  @OnEvent(DISCORD_BOT_EVENTS.CONNECTED)
  onBotConnected(): void {
    this.binding.attachToClient(this.clientService.getClient(), [
      gatewayBinding('interactionCreate', (interaction) => {
        if (interaction.isButton())
          void this.handleButtonInteraction(interaction);
      }),
    ]);
  }

  /** Drop the handler so a reconnect re-attaches to the live client. */
  @OnEvent(DISCORD_BOT_EVENTS.DISCONNECTED)
  onBotDisconnected(): void {
    this.binding.detach();
  }

  /**
   * Handle one button press. Never throws back into the gateway.
   *
   * @param interaction - The button interaction discord.js dispatched.
   */
  async handleButtonInteraction(interaction: ButtonInteraction): Promise<void> {
    const gameId = parseWithdrawCustomId(interaction.customId);
    if (gameId === null) return;
    try {
      await interaction.deferUpdate();
      await this.withdrawAndRerender(interaction, gameId);
    } catch (error) {
      this.logger.error(
        `Failed to withdraw LFG intent for game ${gameId}:`,
        error,
      );
      await this.notify(interaction, LFG_LEAVE_ERROR_REPLY);
    }
  }

  /** Withdraw, then repaint the list the button lives on. */
  private async withdrawAndRerender(
    interaction: ButtonInteraction,
    gameId: number,
  ): Promise<void> {
    const caller = await resolveLfgCaller(this.db, interaction.user.id);
    if (!caller) {
      await this.notify(interaction, LFG_UNLINKED_REPLY);
      return;
    }
    // The guard the command enforces: a blocked account must not mutate LFG
    // state (and repaint the public embed) through a stale ephemeral list.
    if (caller.deactivatedAt || caller.bannedAt) {
      await this.notify(interaction, LFG_BLOCKED_REPLY);
      return;
    }
    const gameName = await lookupLfgGameName(this.db, gameId);
    const withdrawn = await withdrawIfPresent(
      this.lfgService,
      caller.id,
      gameId,
    );
    const [groups, ctx] = await Promise.all([
      this.lfgService.listGroups(caller.id),
      this.replyContext(),
    ]);
    await interaction.editReply(buildListReply(groups, ctx));
    await this.notify(
      interaction,
      withdrawn ? buildLeftReply(gameName) : buildNotInGroupReply(gameName),
    );
  }

  private replyContext(): Promise<LfgReplyContext> {
    return loadLfgReplyContext(this.settingsService);
  }

  /** An ephemeral note alongside the repainted list. Best-effort. */
  private async notify(
    interaction: ButtonInteraction,
    content: string,
  ): Promise<void> {
    await interaction
      .followUp({ content, flags: MessageFlags.Ephemeral })
      .catch(() => {
        this.logger.warn(`Could not deliver LFG withdraw notice: ${content}`);
      });
  }
}

