import { Injectable, Inject, Logger, HttpException } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  ButtonInteraction,
  MessageFlags,
  StringSelectMenuInteraction,
} from 'discord.js';
import { eq, and } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import { SignupsService } from '../../events/signups.service';
import { EventsService } from '../../events/events.service';
import { CharactersService } from '../../characters/characters.service';
import { IntentTokenService } from '../../auth/intent-token.service';
import {
  DISCORD_BOT_EVENTS,
  SIGNUP_BUTTON_IDS,
} from '../discord-bot.constants';
import { DiscordBotClientService } from '../discord-bot-client.service';
import {
  DiscordEmbedFactory,
  type EmbedContext,
} from '../services/discord-embed.factory';
import { DiscordEmojiService } from '../services/discord-emoji.service';
import { SettingsService } from '../../settings/settings.service';
import type { SignupInteractionDeps } from './signup-interaction.types';
import {
  cleanupCooldowns,
  getCooldown,
  setCooldown,
  COOLDOWN_MS,
  isDiscordInteractionError,
  safeReply,
  safeEditReply,
  findLinkedUser,
  parseButtonCustomId,
} from './signup-interaction.helpers';
import {
  handleExistingSignup,
  handleNewLinkedSignup,
} from './signup-signup.handlers';
import {
  handleTentative,
  handleDecline,
  handleQuickSignup,
  showOnboardingEphemeral,
} from './signup-status.handlers';
import { handleSelectMenuInteraction } from './signup-select.handlers';

/**
 * Handles Discord button interactions for event signup actions (ROK-137).
 */
@Injectable()
export class SignupInteractionListener {
  private readonly logger = new Logger(SignupInteractionListener.name);
  private boundHandler:
    | ((interaction: import('discord.js').Interaction) => void)
    | null = null;

  constructor(
    @Inject(DrizzleAsyncProvider)
    private db: PostgresJsDatabase<typeof schema>,
    private readonly clientService: DiscordBotClientService,
    private readonly signupsService: SignupsService,
    private readonly eventsService: EventsService,
    private readonly charactersService: CharactersService,
    private readonly intentTokenService: IntentTokenService,
    private readonly embedFactory: DiscordEmbedFactory,
    private readonly emojiService: DiscordEmojiService,
    private readonly settingsService: SettingsService,
  ) {}

  /** Register the interaction handler when the bot connects. */
  @OnEvent(DISCORD_BOT_EVENTS.CONNECTED)
  onBotConnected(): void {
    const client = this.clientService.getClient();
    if (!client) {
      this.logger.warn(
        'Discord client unavailable — signup buttons will not register',
      );
      return;
    }

    if (this.boundHandler) {
      client.removeListener('interactionCreate', this.boundHandler);
    }

    this.boundHandler = (interaction: import('discord.js').Interaction) => {
      if (interaction.isButton()) {
        void this.handleButtonInteraction(interaction);
      } else if (interaction.isStringSelectMenu()) {
        void this.handleSelectMenuInteraction(interaction);
      }
    };

    client.on('interactionCreate', this.boundHandler);
    this.logger.log('Registered signup interaction handler');
  }

  /** Clear handler reference on disconnect. */
  @OnEvent(DISCORD_BOT_EVENTS.DISCONNECTED)
  onBotDisconnected(): void {
    this.boundHandler = null;
  }

  /** Build the shared dependency bag for handlers. */
  private getDeps(): SignupInteractionDeps {
    return {
      db: this.db,
      logger: this.logger,
      clientService: this.clientService,
      signupsService: this.signupsService,
      eventsService: this.eventsService,
      charactersService: this.charactersService,
      intentTokenService: this.intentTokenService,
      embedFactory: this.embedFactory,
      emojiService: this.emojiService,
      settingsService: this.settingsService,
      updateEmbedSignupCount: (eventId: number) =>
        this.updateEmbedSignupCount(eventId),
    };
  }

  /** Handle button clicks on event embeds. */
  private async handleButtonInteraction(
    interaction: ButtonInteraction,
  ): Promise<void> {
    const parsed = parseButtonCustomId(interaction.customId);
    if (!parsed) return;
    try {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    } catch (error: unknown) {
      if (isDiscordInteractionError(error)) return;
      throw error;
    }
    if (this.isRateLimited(interaction.user.id, parsed.eventId)) {
      await safeEditReply(
        interaction,
        { content: 'Please wait a moment before trying again.' },
        this.logger,
      );
      return;
    }
    await this.executeButtonAction(interaction, parsed);
  }

  /** Execute a parsed button action with error handling. */
  private async executeButtonAction(
    interaction: ButtonInteraction,
    parsed: { action: string; eventId: number },
  ): Promise<void> {
    try {
      await this.routeButtonAction(parsed.action, interaction, parsed.eventId);
    } catch (error) {
      if (error instanceof HttpException && error.getStatus() === 409) {
        await safeReply(
          interaction,
          { content: error.message, flags: MessageFlags.Ephemeral },
          this.logger,
        );
        return;
      }
      this.logger.error(
        `Error handling signup for event ${parsed.eventId}:`,
        error,
      );
      await safeReply(
        interaction,
        {
          content: 'Something went wrong. Please try again.',
          flags: MessageFlags.Ephemeral,
        },
        this.logger,
      );
    }
  }

  private isRateLimited(userId: string, eventId: number): boolean {
    cleanupCooldowns();
    const cooldownKey = `${userId}:${eventId}`;
    const lastInteraction = getCooldown(cooldownKey);
    if (lastInteraction && Date.now() - lastInteraction < COOLDOWN_MS)
      return true;
    setCooldown(cooldownKey, Date.now());
    return false;
  }

  /** Route a button action to the appropriate handler. */
  private async routeButtonAction(
    action: string,
    interaction: ButtonInteraction,
    eventId: number,
  ): Promise<void> {
    const deps = this.getDeps();

    switch (action) {
      case SIGNUP_BUTTON_IDS.SIGNUP:
        await this.handleSignup(interaction, eventId, deps);
        break;
      case SIGNUP_BUTTON_IDS.TENTATIVE:
        await handleTentative(interaction, eventId, deps);
        break;
      case SIGNUP_BUTTON_IDS.DECLINE:
        await handleDecline(interaction, eventId, deps);
        break;
      case SIGNUP_BUTTON_IDS.QUICK_SIGNUP:
        await handleQuickSignup(interaction, eventId, deps);
        break;
      default:
        break;
    }
  }

  /** Handle the Sign Up button click. */
  private async handleSignup(
    interaction: ButtonInteraction,
    eventId: number,
    deps: SignupInteractionDeps,
  ): Promise<void> {
    const discordUserId = interaction.user.id;
    const existingSignup = await this.signupsService.findByDiscordUser(
      eventId,
      discordUserId,
    );

    if (existingSignup) {
      await handleExistingSignup(interaction, eventId, existingSignup, deps);
      return;
    }

    const linkedUser = await findLinkedUser(discordUserId, { db: this.db });

    if (linkedUser) {
      await handleNewLinkedSignup(interaction, eventId, linkedUser, deps);
      return;
    }

    await showOnboardingEphemeral(interaction, eventId, deps);
  }

  /** Delegate select menu interactions to handler. */
  private async handleSelectMenuInteraction(
    interaction: StringSelectMenuInteraction,
  ): Promise<void> {
    try {
      await handleSelectMenuInteraction(interaction, this.getDeps());
    } catch (error) {
      this.logger.error(
        `Error handling select menu interaction ${interaction.customId}:`,
        error,
      );
      await safeReply(
        interaction,
        {
          content: 'Something went wrong. Please try again.',
          flags: MessageFlags.Ephemeral,
        },
        this.logger,
      );
    }
  }

  /** Update the embed to reflect current signup count. */
  private async updateEmbedSignupCount(eventId: number): Promise<void> {
    try {
      const eventData = await this.eventsService.buildEmbedEventData(eventId);
      const records = await this.getEmbedRecords(eventId);
      if (records.length === 0) return;

      const context = await this.buildEmbedContext();
      for (const record of records) {
        await this.updateSingleEmbed(record, eventData, context);
      }
    } catch (error) {
      this.logger.error(
        `Failed to update embed signup count for event ${eventId}:`,
        error,
      );
    }
  }

  private async getEmbedRecords(
    eventId: number,
  ): Promise<(typeof schema.discordEventMessages.$inferSelect)[]> {
    const guildId = this.clientService.getGuildId();
    if (!guildId) return [];
    return this.db
      .select()
      .from(schema.discordEventMessages)
      .where(
        and(
          eq(schema.discordEventMessages.eventId, eventId),
          eq(schema.discordEventMessages.guildId, guildId),
        ),
      );
  }

  private async buildEmbedContext(): Promise<EmbedContext> {
    const [branding, timezone] = await Promise.all([
      this.settingsService.getBranding(),
      this.settingsService.getDefaultTimezone(),
    ]);
    return {
      communityName: branding.communityName,
      clientUrl: process.env.CLIENT_URL ?? null,
      timezone,
    };
  }

  /** Update a single embed message record. */
  private async updateSingleEmbed(
    record: typeof schema.discordEventMessages.$inferSelect,
    eventData: Parameters<DiscordEmbedFactory['buildEventEmbed']>[0],
    context: EmbedContext,
  ): Promise<void> {
    try {
      const currentState =
        record.embedState as import('../discord-bot.constants').EmbedState;
      const { embed, row } = this.embedFactory.buildEventEmbed(
        eventData,
        context,
        { state: currentState },
      );
      await this.clientService.editEmbed(
        record.channelId,
        record.messageId,
        embed,
        row,
      );
    } catch (err) {
      this.logger.warn(
        `Failed to update embed message ${record.messageId}: ${err instanceof Error ? err.message : 'Unknown'}`,
      );
    }
  }
}
