/**
 * ROK-1454 D11 — the `Withdraw · {game}` buttons on a `/lfg` list reply.
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
import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { MessageFlags } from 'discord.js';
import type { ButtonInteraction } from 'discord.js';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
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
      await this.notify(interaction, 'Something went wrong. Please try again.');
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
    const gameName = await this.gameName(gameId);
    const withdrawn = await this.tryWithdraw(caller.id, gameId);
    const [groups, ctx] = await Promise.all([
      this.lfgService.listGroups(caller.id),
      this.replyContext(),
    ]);
    await interaction.editReply(buildListReply(groups, ctx));
    await this.notify(
      interaction,
      withdrawn
        ? `Withdrawn from **${gameName}**.`
        : `You're not in **${gameName}** — already withdrawn.`,
    );
  }

  /**
   * `LfgService.withdraw` 404s when there was no active row (already withdrawn,
   * expired, or converted). That is a normal outcome of a stale list, not an
   * error — every OTHER failure still propagates to the caller's catch.
   */
  private async tryWithdraw(userId: number, gameId: number): Promise<boolean> {
    try {
      await this.lfgService.withdraw(userId, gameId);
      return true;
    } catch (error) {
      if (isNotFound(error)) return false;
      throw error;
    }
  }

  /** The game's display name for the confirmation copy. */
  private async gameName(gameId: number): Promise<string> {
    const [game] = await this.db
      .select({ name: schema.games.name })
      .from(schema.games)
      .where(eq(schema.games.id, gameId))
      .limit(1);
    return game?.name ?? 'that game';
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

/** Exactly the exception `LfgService.withdraw` throws for a missing row. */
function isNotFound(error: unknown): boolean {
  return error instanceof NotFoundException;
}
