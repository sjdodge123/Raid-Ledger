import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  SlashCommandBuilder,
  EmbedBuilder,
  type ChatInputCommandInteraction,
  MessageFlags,
  type AutocompleteInteraction,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
} from 'discord.js';
import { and, ilike } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import { buildWordMatchFilters } from '../../common/search.util';
import { PresenceGameDetectorService } from '../services/presence-game-detector.service';
import { EMBED_COLORS } from '../discord-bot.constants';
import type { SlashCommandHandler } from './register-commands';
import type { CommandInteractionHandler } from '../listeners/interaction.listener';

/**
 * /playing [game] — Manual fallback for users without Discord Rich Presence.
 * Sets a temporary game override for the user in general-lobby channels.
 * Without arguments, clears the override.
 */
@Injectable()
export class PlayingCommand
  implements SlashCommandHandler, CommandInteractionHandler
{
  readonly commandName = 'playing';
  private readonly logger = new Logger(PlayingCommand.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private db: PostgresJsDatabase<typeof schema>,
    private readonly presenceDetector: PresenceGameDetectorService,
  ) {}

  getDefinition(): RESTPostAPIChatInputApplicationCommandsJSONBody {
    return new SlashCommandBuilder()
      .setName('playing')
      .setDescription(
        'Tell the bot what game you are playing (for general lobby channels)',
      )
      .setDMPermission(false)
      .addStringOption((opt) =>
        opt
          .setName('game')
          .setDescription('Game name (leave empty to clear override)')
          .setAutocomplete(true),
      )
      .toJSON();
  }

  async handleInteraction(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    const gameName = interaction.options.getString('game');
    if (!gameName) {
      await this.clearOverride(interaction);
      return;
    }
    await this.setOverride(interaction, gameName);
  }

  /** Clear the manual game override. */
  private async clearOverride(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    this.presenceDetector.clearManualOverride(interaction.user.id);
    const embed = new EmbedBuilder()
      .setColor(EMBED_COLORS.SYSTEM)
      .setDescription(
        'Game override cleared. The bot will use Discord Rich Presence to detect your game.',
      );
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }

  /** Resolve game name and set override. */
  private async setOverride(
    interaction: ChatInputCommandInteraction,
    gameName: string,
  ): Promise<void> {
    const [match] = await this.db
      .select({ id: schema.games.id, name: schema.games.name })
      .from(schema.games)
      .where(ilike(schema.games.name, gameName))
      .limit(1);
    const resolved = match?.name ?? gameName;
    this.presenceDetector.setManualOverride(interaction.user.id, resolved);
    const embed = new EmbedBuilder()
      .setColor(EMBED_COLORS.LIVE_EVENT)
      .setDescription(
        `You are now marked as playing **${resolved}**.\n` +
          'This override lasts 30 minutes or until you clear it with `/playing`.',
      );
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    this.logger.debug(
      `User ${interaction.user.id} set game override: "${resolved}"`,
    );
  }

  async handleAutocomplete(
    interaction: AutocompleteInteraction,
  ): Promise<void> {
    const focused = interaction.options.getFocused(true);
    if (focused.name !== 'game') return;

    const filters = buildWordMatchFilters(schema.games.name, focused.value);
    const results = await this.db
      .select({
        id: schema.games.id,
        name: schema.games.name,
      })
      .from(schema.games)
      .where(filters.length > 0 ? and(...filters) : undefined)
      .limit(25);

    await interaction.respond(
      results.map((g) => ({ name: g.name, value: g.name })),
    );
  }
}
