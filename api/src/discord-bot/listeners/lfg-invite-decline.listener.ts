/**
 * ROK-1455 D12 — the `Not interested` button on a player-invite DM.
 *
 * Copies `LfgJoinListener`'s gateway-binding pattern move for move, and
 * inherits its first rule: **identity comes from the interaction, never from
 * the custom id.** The button carries only a game id, so a replayed or
 * hand-crafted id can decline the CLICKER's own invite or nobody's — the
 * worst a forgery can do is what the clicker could do anyway.
 *
 * No write path of its own: every press goes through
 * `LfgInviteService.decline`, the same method the DEMO smoke endpoint calls,
 * so the "newest live row, idempotent" semantics live in one place. A blocked
 * (deactivated / banned) account is NOT refused here — such an account can no
 * longer be invited (D10), so letting it decline is harmless and refusing it
 * would only keep a DM it asked to stop.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { MessageFlags } from 'discord.js';
import type { ButtonInteraction } from 'discord.js';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import { LFG_INVITE_NO_REPEAT_DAYS } from '../../lfg/lfg-invite.constants';
import { LfgInviteService } from '../../lfg/lfg-invite.service';
import { DISCORD_BOT_EVENTS, LFG_BUTTON_IDS } from '../discord-bot.constants';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { LFG_UNLINKED_REPLY } from '../commands/lfg.command.helpers';
import { resolveLfgCaller } from '../commands/lfg.command';
import {
  DiscordListenerBinding,
  gatewayBinding,
} from './discord-listener-binding';

/** The ephemeral confirmation once a live invite was stamped. */
export const LFG_INVITE_DECLINED_REPLY = `Got it — no more invites to this group for ${LFG_INVITE_NO_REPEAT_DAYS} days.`;

/** The idempotent repeat: nothing live was left to decline. */
export const LFG_INVITE_NOTHING_TO_DECLINE_REPLY =
  "That invite is already closed — there's nothing to decline.";

/**
 * Parse a decline button's custom id.
 *
 * @param customId - The interaction's custom id.
 * @returns The game id, or null when this is not an invite-decline button.
 */
export function parseInviteDeclineCustomId(customId: string): number | null {
  const prefix = `${LFG_BUTTON_IDS.INVITE_DECLINE}:`;
  if (!customId.startsWith(prefix)) return null;
  const raw = customId.slice(prefix.length);
  if (!/^\d+$/.test(raw)) return null;
  return Number(raw);
}

@Injectable()
export class LfgInviteDeclineListener {
  private readonly logger = new Logger(LfgInviteDeclineListener.name);
  private readonly binding = new DiscordListenerBinding(
    this.logger,
    'LFG invite-decline interactions',
  );

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly clientService: DiscordBotClientService,
    private readonly lfgInviteService: LfgInviteService,
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

  /** True when this custom id is one of the DM's decline buttons. */
  matches(customId: string): boolean {
    return parseInviteDeclineCustomId(customId) !== null;
  }

  /**
   * Handle one decline press. Never throws back into the gateway.
   *
   * @param interaction - The button interaction discord.js dispatched.
   */
  async handleButtonInteraction(interaction: ButtonInteraction): Promise<void> {
    const gameId = parseInviteDeclineCustomId(interaction.customId);
    if (gameId === null) return;
    try {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      await this.reply(interaction, await this.decline(interaction, gameId));
    } catch (error) {
      this.logger.error(
        `Failed to decline the LFG invite for game ${gameId}:`,
        error,
      );
      await this.reply(interaction, 'Something went wrong. Please try again.');
    }
  }

  /** The one write path — for the user who CLICKED, resolved from Discord. */
  private async decline(
    interaction: ButtonInteraction,
    gameId: number,
  ): Promise<string> {
    const caller = await resolveLfgCaller(this.db, interaction.user.id);
    if (!caller) return LFG_UNLINKED_REPLY;
    const declined = await this.lfgInviteService.decline(caller.id, gameId);
    return declined
      ? LFG_INVITE_DECLINED_REPLY
      : LFG_INVITE_NOTHING_TO_DECLINE_REPLY;
  }

  /** The ephemeral answer. Best-effort — a dead interaction is not an error. */
  private async reply(
    interaction: ButtonInteraction,
    content: string,
  ): Promise<void> {
    await interaction.editReply({ content }).catch(() => {
      this.logger.warn(`Could not deliver the LFG decline reply: ${content}`);
    });
  }
}
