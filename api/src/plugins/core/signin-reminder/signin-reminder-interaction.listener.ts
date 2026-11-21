/**
 * ROK-2284 — the "Don't remind me again" button on the sign-in reminder DM.
 *
 * The person is ALWAYS `interaction.user.id` — the custom id carries no
 * identity, so a forged id can only ever opt out the presser. The opt-out is
 * idempotent (a second press keeps the first timestamp). After it lands the
 * stop button is greyed out on the DM (the link button stays live) and the
 * presser gets a private confirmation. No account is needed to press it.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ComponentType,
  MessageFlags,
} from 'discord.js';
import type { ButtonInteraction } from 'discord.js';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import * as schema from '../../../drizzle/schema';
import { DISCORD_BOT_EVENTS } from '../../../discord-bot/discord-bot.constants';
import { DiscordBotClientService } from '../../../discord-bot/discord-bot-client.service';
import {
  DiscordListenerBinding,
  gatewayBinding,
} from '../../../discord-bot/listeners/discord-listener-binding';
import { errorMessage, errorStack } from '../../../common/error-format.helpers';
import { SIGNIN_REMINDER_BUTTON_IDS } from './signin-reminder.constants';
import { optOutOfSigninReminders } from './signin-reminder.db';

/** Private confirmation after a press (spec "How it works" step 4). */
export const SIGNIN_REMINDER_OPTED_OUT_REPLY =
  "Done — you won't get these reminders again. You can still type /login any time.";

export const SIGNIN_REMINDER_FAILED_REPLY =
  'Something went wrong. Please try again.';

type MessageComponents = ButtonInteraction['message']['components'];

/** The DM's rows with only the stop button disabled; the link button stays. */
export function disableStopButton(
  components: MessageComponents,
): ActionRowBuilder<ButtonBuilder>[] {
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  for (const row of components) {
    if (row.type !== ComponentType.ActionRow) continue;
    const next = new ActionRowBuilder<ButtonBuilder>();
    for (const component of row.components) {
      if (component.type !== ComponentType.Button) continue;
      const btn = ButtonBuilder.from(component);
      const data = btn.toJSON();
      if (
        'custom_id' in data &&
        data.custom_id === SIGNIN_REMINDER_BUTTON_IDS.STOP
      ) {
        btn.setDisabled(true);
      }
      next.addComponents(btn);
    }
    if (next.components.length > 0) rows.push(next);
  }
  return rows;
}

@Injectable()
export class SigninReminderInteractionListener {
  private readonly logger = new Logger(SigninReminderInteractionListener.name);
  private readonly binding = new DiscordListenerBinding(
    this.logger,
    'Sign-in reminder interactions',
  );

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly clientService: DiscordBotClientService,
  ) {}

  @OnEvent(DISCORD_BOT_EVENTS.CONNECTED)
  onBotConnected(): void {
    this.binding.attachToClient(this.clientService.getClient(), [
      gatewayBinding('interactionCreate', (interaction) => {
        if (
          interaction.isButton() &&
          interaction.customId === SIGNIN_REMINDER_BUTTON_IDS.STOP
        ) {
          void this.handleStop(interaction);
        }
      }),
    ]);
  }

  /** Drop the handler so a reconnect re-attaches to the live client. */
  @OnEvent(DISCORD_BOT_EVENTS.DISCONNECTED)
  onBotDisconnected(): void {
    this.binding.detach();
  }

  /**
   * Opt the presser out FIRST (so a slow or expired ack never loses the
   * opt-out), then grey the button out and confirm privately.
   */
  async handleStop(interaction: ButtonInteraction): Promise<void> {
    try {
      await optOutOfSigninReminders(this.db, interaction.user.id);
    } catch (error) {
      this.logger.error('Sign-in reminder opt-out failed', errorStack(error));
      await this.safeReply(interaction, SIGNIN_REMINDER_FAILED_REPLY);
      return;
    }
    this.logger.log(
      `Discord user ${interaction.user.id} opted out of sign-in reminders`,
    );
    try {
      await interaction.update({
        components: disableStopButton(interaction.message.components),
      });
      await interaction.followUp({
        content: SIGNIN_REMINDER_OPTED_OUT_REPLY,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      this.logger.warn(
        `Sign-in reminder opt-out saved but the DM was not updated: ${errorMessage(error)}`,
      );
    }
  }

  private async safeReply(
    interaction: ButtonInteraction,
    content: string,
  ): Promise<void> {
    try {
      await interaction.reply({ content, flags: MessageFlags.Ephemeral });
    } catch {
      // The interaction token expired — nothing left to tell the presser.
    }
  }
}
