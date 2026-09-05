/**
 * ROK-1471 D6 — the `+1 · I'm in` button on an LFG board post.
 *
 * ROK-1454 declared `LFG_BUTTON_IDS.JOIN` and deliberately left it unhandled;
 * this listener is the socket it reserved. It copies `LfgWithdrawListener`'s
 * gateway-binding pattern move for move, and inherits its two rules:
 *
 *  1. **Identity comes from the interaction, never from the custom id.** The
 *     button carries only a game id, so a replayed or hand-crafted id raises
 *     the CLICKER's hand or nobody's.
 *  2. **No write path of its own.** Every press goes through
 *     `LfgService.createIntent` — the same method `POST /lfg` and `/lfg game:`
 *     call — so the advisory lock, the 1 -> 2 rule and expiry refresh stay
 *     honest, a repeat press is idempotent rather than an error, and the public
 *     post repaints through the existing `GROUP_CHANGED` consumer. This file
 *     edits no Discord message.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { MessageFlags } from 'discord.js';
import type { ButtonInteraction } from 'discord.js';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import { LfgService, type CreateIntentResult } from '../../lfg/lfg.service';
import { SettingsService } from '../../settings/settings.service';
import { DISCORD_BOT_EVENTS, LFG_BUTTON_IDS } from '../discord-bot.constants';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { maskedLink } from '../services/discord-embed-event-chrome.helpers';
import {
  LFG_BLOCKED_REPLY,
  LFG_UNLINKED_REPLY,
} from '../commands/lfg.command.helpers';
import { resolveLfgCaller } from '../commands/lfg.command';
import { findLfmMessageByIds } from '../lfg-board/lfg-board.db-helpers';
import {
  DiscordListenerBinding,
  gatewayBinding,
} from './discord-listener-binding';

/** E11 — the refusal a stale client gets when the group has already ended. */
export const LFG_JOIN_TERMINAL_REPLY =
  "This group already got scheduled — there's nothing left to join.";

/**
 * Parse a `+1` button's custom id.
 *
 * @param customId - The interaction's custom id.
 * @returns The game id, or null when this is not a board join button.
 */
export function parseJoinCustomId(customId: string): number | null {
  const prefix = `${LFG_BUTTON_IDS.JOIN}:`;
  if (!customId.startsWith(prefix)) return null;
  const raw = customId.slice(prefix.length);
  if (!/^\d+$/.test(raw)) return null;
  return Number(raw);
}

@Injectable()
export class LfgJoinListener {
  private readonly logger = new Logger(LfgJoinListener.name);
  private readonly binding = new DiscordListenerBinding(
    this.logger,
    'LFG join interactions',
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

  /** True when this custom id is one of the board's `+1` buttons. */
  matches(customId: string): boolean {
    return parseJoinCustomId(customId) !== null;
  }

  /**
   * Handle one `+1` press. Never throws back into the gateway.
   *
   * @param interaction - The button interaction discord.js dispatched.
   */
  async handleButtonInteraction(interaction: ButtonInteraction): Promise<void> {
    const gameId = parseJoinCustomId(interaction.customId);
    if (gameId === null) return;
    try {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      await this.reply(interaction, await this.join(interaction, gameId));
    } catch (error) {
      this.logger.error(
        `Failed to join the LFG group for game ${gameId}:`,
        error,
      );
      await this.reply(interaction, 'Something went wrong. Please try again.');
    }
  }

  /** The one write path, guarded exactly as the HTTP and slash surfaces are. */
  private async join(
    interaction: ButtonInteraction,
    gameId: number,
  ): Promise<string> {
    const caller = await resolveLfgCaller(this.db, interaction.user.id);
    if (!caller) return LFG_UNLINKED_REPLY; // E8
    // E9: `NotDeactivatedGuard` guards the HTTP routes only, so a gateway click
    // by a blocked account is refused here or not at all.
    if (caller.deactivatedAt || caller.bannedAt) return LFG_BLOCKED_REPLY;
    if (await this.isTerminalPost(interaction)) return LFG_JOIN_TERMINAL_REPLY;
    return this.confirmation(
      await this.lfgService.createIntent(caller.id, gameId),
    );
  }

  /**
   * E11 — a press from a stale client on a post whose group already ended.
   *
   * An UNKNOWN message is deliberately not terminal: only rows the board wrote
   * are tracked, so treating "no row" as closed would refuse a legitimate press
   * on anything else that ever carries this button.
   */
  private async isTerminalPost(
    interaction: ButtonInteraction,
  ): Promise<boolean> {
    const { guildId, channelId } = interaction;
    if (!guildId || !channelId) return false;
    const row = await findLfmMessageByIds(this.db, {
      guildId,
      channelId,
      messageId: interaction.message.id,
    });
    return row !== null && row.state !== 'open';
  }

  /** `created === false` is the idempotent repeat, not a failure (E10). */
  private async confirmation(result: CreateIntentResult): Promise<string> {
    const group = result.body.group;
    if (!result.created) {
      return `You're already in — ${group.activeCount} looking`;
    }
    const clientUrl = await this.settingsService.getClientUrl();
    const link = clientUrl
      ? ` — ${maskedLink('Open group ↗', `${clientUrl}/lfg/${group.gameSlug}`)}`
      : '';
    return `That's ${group.activeCount} now${link}`;
  }

  /** The ephemeral answer. Best-effort — a dead interaction is not an error. */
  private async reply(
    interaction: ButtonInteraction,
    content: string,
  ): Promise<void> {
    await interaction.editReply({ content }).catch(() => {
      this.logger.warn(`Could not deliver the LFG join reply: ${content}`);
    });
  }
}
