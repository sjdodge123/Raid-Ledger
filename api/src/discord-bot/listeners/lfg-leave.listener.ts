/**
 * ROK-1660 — the `I'm out` button on an LFG board post (`lfg:leave:<gameId>`).
 *
 * EPHEMERAL BY CONSTRUCTION. The board post is shared, so this handler opens a
 * private reply (`deferReply` ephemeral) and only ever edits THAT reply — it
 * never calls `deferUpdate`/`update` on the post. The public card re-renders
 * through the group-changed event `LfgService.withdraw` already emits.
 *
 * Identity comes from the interaction, never from the custom id: a replayed id
 * withdraws the presser's own hand or nothing.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { MessageFlags } from 'discord.js';
import type { ButtonInteraction } from 'discord.js';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import { LfgService } from '../../lfg/lfg.service';
import { DISCORD_BOT_EVENTS } from '../discord-bot.constants';
import { DiscordBotClientService } from '../discord-bot-client.service';
import {
  LFG_BLOCKED_REPLY,
  LFG_UNLINKED_REPLY,
} from '../commands/lfg.command.helpers';
import { resolveLfgCaller } from '../commands/lfg.command';
import type { LfgBoardButtonRef } from '../lfg-board/lfg-board-custom-id.helpers';
import {
  DiscordListenerBinding,
  gatewayBinding,
} from './discord-listener-binding';
import {
  LFG_LEAVE_ERROR_REPLY,
  buildLeftReply,
  buildNotInGroupReply,
  leaveOneGroup,
  lookupLfgGameName,
  parseLeavePress,
} from './lfg-leave.helpers';

@Injectable()
export class LfgLeaveListener {
  private readonly logger = new Logger(LfgLeaveListener.name);
  private readonly binding = new DiscordListenerBinding(
    this.logger,
    'LFG leave interactions',
  );

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly clientService: DiscordBotClientService,
    private readonly lfgService: LfgService,
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
   * Handle one `I'm out` press. Never throws back into the gateway.
   *
   * @param interaction - The button interaction discord.js dispatched.
   */
  async handleButtonInteraction(interaction: ButtonInteraction): Promise<void> {
    const press = parseLeavePress(interaction.customId);
    if (press === null) return;
    const { gameId } = press;
    try {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      await this.reply(interaction, await this.leave(interaction, press));
    } catch (error) {
      this.logger.error(`Failed to leave the LFG for game ${gameId}:`, error);
      await this.reply(interaction, LFG_LEAVE_ERROR_REPLY);
    }
  }

  /** The guarded write, worded. */
  private async leave(
    interaction: ButtonInteraction,
    { gameId, groupKey }: LfgBoardButtonRef,
  ): Promise<string> {
    const caller = await resolveLfgCaller(this.db, interaction.user.id);
    if (!caller) return LFG_UNLINKED_REPLY;
    // A gateway press bypasses the HTTP guards, so a blocked account is
    // refused here or not at all.
    if (caller.deactivatedAt || caller.bannedAt) return LFG_BLOCKED_REPLY;
    const gameName = await lookupLfgGameName(this.db, gameId);
    // ROK-2352 — the press leaves the post's own group (v1 id = `''`; with
    // no active grouping adapter `''` still clears every hand, as before).
    const outcome = await leaveOneGroup(
      this.lfgService,
      caller.id,
      gameId,
      groupKey,
    );
    return outcome.left
      ? buildLeftReply(gameName, outcome.stillLooking)
      : buildNotInGroupReply(gameName);
  }

  /** Edit the private deferred reply. Best-effort. */
  private async reply(
    interaction: ButtonInteraction,
    content: string,
  ): Promise<void> {
    await interaction.editReply({ content }).catch(() => {
      this.logger.warn(`Could not deliver the LFG leave reply: ${content}`);
    });
  }
}
