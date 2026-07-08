import { Injectable, Inject, Logger, forwardRef } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { MessageFlags } from 'discord.js';
import type { ButtonInteraction, Interaction } from 'discord.js';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import { StandalonePollService } from '../../lineups/standalone-poll/standalone-poll.service';
import { NotificationService } from '../../notifications/notification.service';
import { SettingsService } from '../../settings/settings.service';
import { DiscordBotClientService } from '../discord-bot-client.service';
import {
  DISCORD_BOT_EVENTS,
  POST_EVENT_FOLLOWUP_BUTTON_IDS,
} from '../discord-bot.constants';
import { findLinkedUser } from './signup-interaction.helpers';
import {
  handlePollClick,
  handleScheduleClick,
  lookupFollowupEvent,
  parsePostEventFollowupButton,
  type FollowupButtonParsed,
  type FollowupInteractionEvent,
  type PostEventFollowupDeps,
} from './post-event-followup-interaction.handlers';

const LINK_MSG =
  'Link your Raid Ledger account first — open the app and connect Discord.';

/**
 * Routes the post-event follow-up prompt buttons ([Schedule event] /
 * [Start a poll]) on organizer DMs (ROK-1371 M3). Coexists with the other
 * `interactionCreate` listeners by parsing + ignoring non-`pef_*` custom ids.
 */
@Injectable()
export class PostEventFollowupInteractionListener {
  private readonly logger = new Logger(
    PostEventFollowupInteractionListener.name,
  );
  private boundHandler: ((interaction: Interaction) => void) | null = null;

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly clientService: DiscordBotClientService,
    @Inject(forwardRef(() => StandalonePollService))
    private readonly standalonePollService: StandalonePollService,
    private readonly notificationService: NotificationService,
    private readonly settingsService: SettingsService,
  ) {}

  private get deps(): PostEventFollowupDeps {
    return {
      db: this.db,
      standalonePollService: this.standalonePollService,
      notificationService: this.notificationService,
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
    this.boundHandler = (interaction: Interaction) => {
      if (interaction.isButton()) void this.handle(interaction);
    };
    client.on('interactionCreate', this.boundHandler);
    this.logger.log('Registered post-event follow-up interaction handler');
  }

  private async handle(interaction: ButtonInteraction): Promise<void> {
    const parsed = parsePostEventFollowupButton(interaction.customId);
    if (!parsed) return;
    try {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    } catch {
      return;
    }
    try {
      await this.route(interaction, parsed);
    } catch (error) {
      this.logger.error(
        'Error handling follow-up button for event %d:',
        parsed.endedEventId,
        error,
      );
      await interaction.editReply({
        content: 'Something went wrong. Please try again.',
      });
    }
  }

  /** Gate on linked organizer + live event, then dispatch to the handler. */
  private async route(
    interaction: ButtonInteraction,
    parsed: FollowupButtonParsed,
  ): Promise<void> {
    const user = await findLinkedUser(interaction.user.id, { db: this.db });
    if (!user) return void interaction.editReply({ content: LINK_MSG });
    const event = await lookupFollowupEvent(this.db, parsed.endedEventId);
    if (!event)
      return void interaction.editReply({ content: 'Event not found.' });
    if (user.id !== event.creatorId)
      return void interaction.editReply({
        content: 'Only the organizer can do this.',
      });
    await this.dispatch(interaction, parsed, event);
  }

  private dispatch(
    interaction: ButtonInteraction,
    parsed: FollowupButtonParsed,
    event: FollowupInteractionEvent,
  ): Promise<void> {
    if (parsed.action === POST_EVENT_FOLLOWUP_BUTTON_IDS.SCHEDULE) {
      return handleScheduleClick(this.deps, interaction, event);
    }
    return handlePollClick(this.deps, interaction, event);
  }
}
