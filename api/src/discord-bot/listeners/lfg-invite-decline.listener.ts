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
import { LFG_ANY_GROUP_KEY } from '@raid-ledger/contract';
import { DISCORD_BOT_EVENTS, LFG_BUTTON_IDS } from '../discord-bot.constants';
import { parseLfgBoardCustomId } from '../lfg-board/lfg-board-custom-id.helpers';
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
  return parseInviteDeclinePress(customId)?.gameId ?? null;
}

/** A parsed decline press; `groupKey` null = a v1 id (newest in the game). */
export interface LfgInviteDeclinePress {
  gameId: number;
  groupKey: string | null;
}

/**
 * ROK-2352 — parse either decline id: v1 `<prefix>:<gameId>` (every DM sent
 * before groups, and every non-WoW DM) or v2 `<prefix>:<gameId>:<groupKey>`.
 *
 * @param customId - The interaction's custom id.
 * @returns The press, or null when this is not an invite-decline button.
 */
export function parseInviteDeclinePress(
  customId: string,
): LfgInviteDeclinePress | null {
  const parsed = parseLfgBoardCustomId(
    customId,
    LFG_BUTTON_IDS.INVITE_DECLINE,
  );
  if (parsed === null) return null;
  return {
    gameId: parsed.gameId,
    groupKey: parsed.groupKey === LFG_ANY_GROUP_KEY ? null : parsed.groupKey,
  };
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
    const press = parseInviteDeclinePress(interaction.customId);
    if (press === null) return;
    const { gameId } = press;
    try {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      await this.reply(interaction, await this.decline(interaction, press));
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
    { gameId, groupKey }: LfgInviteDeclinePress,
  ): Promise<string> {
    const caller = await resolveLfgCaller(this.db, interaction.user.id);
    if (!caller) return LFG_UNLINKED_REPLY;
    // v1 keeps the old 2-arg call byte for byte; v2 scopes to the group.
    const declined =
      groupKey === null
        ? await this.lfgInviteService.decline(caller.id, gameId)
        : await this.lfgInviteService.decline(
            caller.id,
            gameId,
            new Date(),
            groupKey,
          );
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
