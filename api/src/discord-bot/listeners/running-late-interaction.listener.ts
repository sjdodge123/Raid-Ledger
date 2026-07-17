import { Injectable, Inject, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { MessageFlags } from 'discord.js';
import type { ButtonInteraction, VoiceState } from 'discord.js';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import { RunningLateService } from '../../events/running-late.service';
import { EventsService } from '../../events/events.service';
import {
  DISCORD_BOT_EVENTS,
  RUNNING_LATE_BUTTON_IDS,
} from '../discord-bot.constants';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { DiscordEmbedFactory } from '../services/discord-embed.factory';
import { SettingsService } from '../../settings/settings.service';
import { findLinkedUser } from './signup-interaction.helpers';
import {
  buildDelayRow,
  checkLateCooldown,
  clearRunningLateOnVoiceJoin,
  lookupEvent,
  parseRunningLateButton,
  safeEditReply,
  updateChannelEmbeds,
  userHasSignup,
  type RunningLateButtonParsed,
  type RunningLateDeps,
  type RunningLateEvent,
} from './running-late-interaction.handlers';

const LINK_MSG =
  'Link your Raid Ledger account first — open the app and connect Discord.';

/** Handles "Running Late" button interactions on event reminder DMs (ROK-1379). */
@Injectable()
export class RunningLateInteractionListener {
  private readonly logger = new Logger(RunningLateInteractionListener.name);
  private boundHandler:
    ((interaction: import('discord.js').Interaction) => void) | null = null;
  private boundVoiceHandler: ((o: VoiceState, n: VoiceState) => void) | null =
    null;

  constructor(
    @Inject(DrizzleAsyncProvider)
    private db: PostgresJsDatabase<typeof schema>,
    private readonly clientService: DiscordBotClientService,
    private readonly runningLateService: RunningLateService,
    private readonly eventsService: EventsService,
    private readonly embedFactory: DiscordEmbedFactory,
    private readonly settingsService: SettingsService,
  ) {}

  private get deps(): RunningLateDeps {
    return {
      db: this.db,
      clientService: this.clientService,
      runningLateService: this.runningLateService,
      eventsService: this.eventsService,
      embedFactory: this.embedFactory,
      settingsService: this.settingsService,
      logger: this.logger,
    };
  }

  @OnEvent(DISCORD_BOT_EVENTS.CONNECTED)
  onBotConnected(): void {
    const client = this.clientService.getClient();
    if (!client) return;
    if (this.boundHandler) {
      client.removeListener('interactionCreate', this.boundHandler);
    }
    this.boundHandler = (interaction: import('discord.js').Interaction) => {
      if (interaction.isButton())
        void this.handleButtonInteraction(interaction);
    };
    client.on('interactionCreate', this.boundHandler);
    if (this.boundVoiceHandler) {
      client.removeListener('voiceStateUpdate', this.boundVoiceHandler);
    }
    this.boundVoiceHandler = (oldState: VoiceState, newState: VoiceState) => {
      // AC3: auto-clear running-late when the user joins the event's voice channel.
      if (newState.channelId && newState.channelId !== oldState.channelId)
        void clearRunningLateOnVoiceJoin(
          this.deps,
          newState.id,
          newState.channelId,
        );
    };
    client.on('voiceStateUpdate', this.boundVoiceHandler);
    this.logger.log('Registered Running Late interaction handler');
  }

  private async handleButtonInteraction(
    interaction: ButtonInteraction,
  ): Promise<void> {
    const parsed = parseRunningLateButton(interaction.customId);
    if (!parsed) return;
    if (await this.suppressDuplicate(interaction, parsed)) return;
    if (!(await this.defer(interaction, parsed.action))) return;
    try {
      await this.route(interaction, parsed);
    } catch (error) {
      this.logger.error(
        'Error handling running late for event %d:',
        parsed.eventId,
        error,
      );
      await safeEditReply(
        interaction,
        { content: 'Something went wrong. Please try again.' },
        this.logger,
      );
    }
  }

  /** Quietly ack repeated marker presses inside the cooldown window. */
  private async suppressDuplicate(
    interaction: ButtonInteraction,
    parsed: RunningLateButtonParsed,
  ): Promise<boolean> {
    const isMarker =
      parsed.action === RUNNING_LATE_BUTTON_IDS.LATE ||
      parsed.action === RUNNING_LATE_BUTTON_IDS.HERE;
    if (!isMarker) return false;
    const key = `${parsed.action}:${interaction.user.id}:${parsed.eventId}`;
    if (!checkLateCooldown(key)) return false;
    try {
      await interaction.deferUpdate();
    } catch {
      // best-effort ack only
    }
    return true;
  }

  private async defer(
    interaction: ButtonInteraction,
    action: string,
  ): Promise<boolean> {
    try {
      if (
        action === RUNNING_LATE_BUTTON_IDS.DELAY ||
        action === RUNNING_LATE_BUTTON_IDS.DELAY_CANCEL
      ) {
        await interaction.deferUpdate();
      } else {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      }
      return true;
    } catch (error) {
      this.logger.warn('Failed to defer running late interaction: %s', error);
      return false;
    }
  }

  private async route(
    interaction: ButtonInteraction,
    parsed: RunningLateButtonParsed,
  ): Promise<void> {
    switch (parsed.action) {
      case RUNNING_LATE_BUTTON_IDS.LATE:
        await this.handleLateClick(interaction, parsed.eventId);
        break;
      case RUNNING_LATE_BUTTON_IDS.HERE:
        await this.handleHereClick(interaction, parsed.eventId);
        break;
      case RUNNING_LATE_BUTTON_IDS.DELAY:
        await this.handleDelayConfirm(
          interaction,
          parsed.eventId,
          parsed.minutes ?? 0,
        );
        break;
      case RUNNING_LATE_BUTTON_IDS.DELAY_CANCEL:
        await interaction.editReply({
          content: 'No change — the event time is unchanged.',
          components: [],
        });
        break;
    }
  }

  private async handleLateClick(
    interaction: ButtonInteraction,
    eventId: number,
  ): Promise<void> {
    const user = await findLinkedUser(interaction.user.id, { db: this.db });
    if (!user) return this.reply(interaction, LINK_MSG);
    const event = await lookupEvent(this.deps, eventId);
    if (!event) return this.reply(interaction, 'Event not found.');
    if (event.cancelledAt)
      return this.reply(interaction, 'This event has been cancelled.');
    if (user.id === event.creatorId)
      return this.handleHostLate(interaction, event, user.id);
    return this.handleAttendeeLate(
      interaction,
      event,
      user.id,
      user.displayName ?? user.username,
    );
  }

  private async handleHostLate(
    interaction: ButtonInteraction,
    event: RunningLateEvent,
    userId: number,
  ): Promise<void> {
    // Host may also have a signup row — mark them late too (no-op otherwise).
    const marked = await this.runningLateService.setRunningLate(
      event.id,
      userId,
    );
    if (marked) await updateChannelEmbeds(this.deps, event.id);
    await interaction.editReply({
      content: `You host **${event.title}**. Delay the event for everyone?`,
      components: [buildDelayRow(event.id)],
    });
  }

  private async handleAttendeeLate(
    interaction: ButtonInteraction,
    event: RunningLateEvent,
    userId: number,
    username: string,
  ): Promise<void> {
    if (!(await userHasSignup(this.deps, event.id, userId)))
      return this.reply(interaction, "You're not signed up for this event.");
    const marked = await this.runningLateService.setRunningLate(
      event.id,
      userId,
    );
    if (marked) {
      await updateChannelEmbeds(this.deps, event.id);
      // First transition to late only (setRunningLate RETURNING guard);
      // best-effort — a notify failure must not break the ephemeral ack.
      try {
        await this.runningLateService.notifyRunningLate(
          event,
          userId,
          username,
        );
      } catch (error) {
        this.logger.warn(
          'Failed to notify attendees of running-late for event %d: %s',
          event.id,
          error instanceof Error ? error.message : error,
        );
      }
    }
    await interaction.editReply({
      content: `⏰ Got it — marked you as running late for **${event.title}**.`,
    });
  }

  private async handleHereClick(
    interaction: ButtonInteraction,
    eventId: number,
  ): Promise<void> {
    const user = await findLinkedUser(interaction.user.id, { db: this.db });
    if (!user) return this.reply(interaction, LINK_MSG);
    const cleared = await this.runningLateService.clearRunningLate(
      eventId,
      user.id,
    );
    if (cleared) await updateChannelEmbeds(this.deps, eventId);
    await interaction.editReply({
      content: "Thanks — you're no longer marked as running late.",
    });
  }

  private async handleDelayConfirm(
    interaction: ButtonInteraction,
    eventId: number,
    minutes: number,
  ): Promise<void> {
    const user = await findLinkedUser(interaction.user.id, { db: this.db });
    if (!user) return this.replyCleared(interaction, LINK_MSG);
    const event = await lookupEvent(this.deps, eventId);
    if (!event) return this.replyCleared(interaction, 'Event not found.');
    if (user.id !== event.creatorId)
      return this.replyCleared(
        interaction,
        'Only the host can delay this event.',
      );
    const updated = await this.eventsService.delayEvent(
      eventId,
      minutes,
      user.id,
    );
    const unix = Math.floor(new Date(updated.startTime).getTime() / 1000);
    await interaction.editReply({
      content: `Event delayed to <t:${unix}:t>.`,
      components: [],
    });
  }

  /** Ephemeral editReply (the marker paths deferReply ephemerally). */
  private async reply(
    interaction: ButtonInteraction,
    content: string,
  ): Promise<void> {
    await interaction.editReply({ content });
  }

  /** Ephemeral editReply that also clears the prompt's components. */
  private async replyCleared(
    interaction: ButtonInteraction,
    content: string,
  ): Promise<void> {
    await interaction.editReply({ content, components: [] });
  }
}
