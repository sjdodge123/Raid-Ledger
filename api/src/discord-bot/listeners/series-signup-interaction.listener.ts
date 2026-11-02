import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { MessageFlags } from 'discord.js';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import { SeriesSignupsService } from '../../events/series-signups.service';
import { SignupsService } from '../../events/signups.service';
import { CharactersService } from '../../characters/characters.service';
import { DISCORD_BOT_EVENTS } from '../discord-bot.constants';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { DiscordEmojiService } from '../services/discord-emoji.service';
import { SERIES_BUTTON_IDS } from '../series-signup/series-signup.constants';
import { errorMessage, errorStack } from '../../common/error-format.helpers';
import {
  DiscordListenerBinding,
  gatewayBinding,
} from './discord-listener-binding';
import { safeEditReply } from './signup-interaction.helpers';
import {
  parseSeriesCustomId,
  type ParsedSeriesCustomId,
} from './series-signup-interaction.helpers';
import {
  handleJoinSeries,
  handleSeriesCharacterPick,
  handleSeriesConfirm,
  handleSeriesRolePick,
  type SeriesInteraction,
  type SeriesInteractionDeps,
} from './series-signup-interaction.handlers';
import {
  handleSeriesLeave,
  handleSeriesSkip,
} from './series-signup-decline.handlers';

/**
 * Handles every `series_*` component (ROK-1728): the embed's Join Series
 * button, the pick menus, Confirm, and the member Skip/Leave choice.
 */
@Injectable()
export class SeriesSignupInteractionListener {
  private readonly logger = new Logger(SeriesSignupInteractionListener.name);
  private readonly binding = new DiscordListenerBinding(
    this.logger,
    'Series signup interactions',
  );

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly clientService: DiscordBotClientService,
    private readonly seriesSignupsService: SeriesSignupsService,
    private readonly signupsService: SignupsService,
    private readonly charactersService: CharactersService,
    private readonly emojiService: DiscordEmojiService,
  ) {}

  private get deps(): SeriesInteractionDeps {
    return {
      db: this.db,
      logger: this.logger,
      seriesSignupsService: this.seriesSignupsService,
      signupsService: this.signupsService,
      charactersService: this.charactersService,
      emojiService: this.emojiService,
    };
  }

  @OnEvent(DISCORD_BOT_EVENTS.CONNECTED)
  onBotConnected(): void {
    this.binding.attachToClient(this.clientService.getClient(), [
      gatewayBinding('interactionCreate', (interaction) => {
        if (interaction.isButton() || interaction.isStringSelectMenu())
          void this.handleInteraction(interaction);
      }),
    ]);
  }

  /** Drop the handler so a reconnect re-attaches to the live client. */
  @OnEvent(DISCORD_BOT_EVENTS.DISCONNECTED)
  onBotDisconnected(): void {
    this.binding.detach();
  }

  /** Parse → defer → route; any non-HTTP failure gets the generic reply. */
  async handleInteraction(interaction: SeriesInteraction): Promise<void> {
    const parsed = parseSeriesCustomId(interaction.customId);
    if (!parsed) return;
    if (!(await this.defer(interaction, parsed))) return;
    try {
      await this.route(interaction, parsed);
    } catch (error) {
      this.logger.error(
        `Series signup ${parsed.action} failed for event ${parsed.eventId}`,
        errorStack(error),
      );
      await safeEditReply(
        interaction,
        { content: 'Something went wrong. Please try again.', components: [] },
        this.logger,
      );
    }
  }

  /** The embed button opens a new ephemeral; later steps edit that one. */
  private async defer(
    interaction: SeriesInteraction,
    parsed: ParsedSeriesCustomId,
  ): Promise<boolean> {
    try {
      if (parsed.action === SERIES_BUTTON_IDS.JOIN) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      } else {
        await interaction.deferUpdate();
      }
      return true;
    } catch (error) {
      this.logger.warn(
        `Failed to defer series interaction: ${errorMessage(error)}`,
      );
      return false;
    }
  }

  private async route(
    interaction: SeriesInteraction,
    parsed: ParsedSeriesCustomId,
  ): Promise<void> {
    const { eventId } = parsed;
    if (interaction.isStringSelectMenu()) {
      if (parsed.action === SERIES_BUTTON_IDS.CHARACTER)
        return handleSeriesCharacterPick(interaction, parsed, this.deps);
      if (parsed.action === SERIES_BUTTON_IDS.ROLE)
        return handleSeriesRolePick(interaction, parsed, this.deps);
      return;
    }
    if (!interaction.isButton()) return;
    switch (parsed.action) {
      case SERIES_BUTTON_IDS.JOIN:
        return handleJoinSeries(interaction, eventId, this.deps);
      case SERIES_BUTTON_IDS.CONFIRM:
        return handleSeriesConfirm(interaction, parsed, this.deps);
      case SERIES_BUTTON_IDS.SKIP:
        return handleSeriesSkip(interaction, eventId, this.deps);
      case SERIES_BUTTON_IDS.LEAVE:
        return handleSeriesLeave(interaction, eventId, this.deps);
    }
  }
}
