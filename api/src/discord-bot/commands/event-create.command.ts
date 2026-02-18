import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type AutocompleteInteraction,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';
import { ilike } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import { EventsService } from '../../events/events.service';
import { UsersService } from '../../users/users.service';
import { PreferencesService } from '../../users/preferences.service';
import { SettingsService } from '../../settings/settings.service';
import { MagicLinkService } from '../../auth/magic-link.service';
import { DiscordBotClientService } from '../discord-bot-client.service';
import {
  DiscordEmbedFactory,
  type EmbedContext,
} from '../services/discord-embed.factory';
import { ChannelResolverService } from '../services/channel-resolver.service';
import { EMBED_STATES } from '../discord-bot.constants';
import { parseNaturalTime, toDiscordTimestamp } from '../utils/time-parser';
import type { SlashCommandHandler } from './register-commands';
import type { CommandInteractionHandler } from '../listeners/interaction.listener';

const DEFAULT_SLOTS = 20;
const DEFAULT_DURATION_HOURS = 2;

@Injectable()
export class EventCreateCommand
  implements SlashCommandHandler, CommandInteractionHandler
{
  readonly commandName = 'event';
  private readonly logger = new Logger(EventCreateCommand.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private db: PostgresJsDatabase<typeof schema>,
    private readonly eventsService: EventsService,
    private readonly usersService: UsersService,
    private readonly preferencesService: PreferencesService,
    private readonly settingsService: SettingsService,
    private readonly magicLinkService: MagicLinkService,
    private readonly clientService: DiscordBotClientService,
    private readonly embedFactory: DiscordEmbedFactory,
    private readonly channelResolver: ChannelResolverService,
  ) {}

  getDefinition(): RESTPostAPIChatInputApplicationCommandsJSONBody {
    return new SlashCommandBuilder()
      .setName('event')
      .setDescription('Event management commands')
      .setDMPermission(true)
      .addSubcommand((sub) =>
        sub
          .setName('create')
          .setDescription('Quick-create an event from Discord')
          .addStringOption((opt) =>
            opt
              .setName('title')
              .setDescription('Event title')
              .setRequired(true),
          )
          .addStringOption((opt) =>
            opt
              .setName('game')
              .setDescription('Game name')
              .setRequired(true)
              .setAutocomplete(true),
          )
          .addStringOption((opt) =>
            opt
              .setName('time')
              .setDescription(
                'When the event starts (e.g., "tonight 8pm", "Friday 7:30pm")',
              )
              .setRequired(true),
          )
          .addStringOption((opt) =>
            opt
              .setName('roster')
              .setDescription('Roster type (default: generic)')
              .addChoices(
                { name: 'Generic (headcount only)', value: 'generic' },
                { name: 'MMO Roles (Tank/Healer/DPS)', value: 'mmo' },
              ),
          )
          .addIntegerOption((opt) =>
            opt
              .setName('slots')
              .setDescription(`Max attendees (default: ${DEFAULT_SLOTS})`)
              .setMinValue(1)
              .setMaxValue(100),
          )
          .addIntegerOption((opt) =>
            opt
              .setName('tanks')
              .setDescription('Number of tank slots (MMO roster only)')
              .setMinValue(0)
              .setMaxValue(20),
          )
          .addIntegerOption((opt) =>
            opt
              .setName('healers')
              .setDescription('Number of healer slots (MMO roster only)')
              .setMinValue(0)
              .setMaxValue(20),
          )
          .addIntegerOption((opt) =>
            opt
              .setName('dps')
              .setDescription('Number of DPS slots (MMO roster only)')
              .setMinValue(0)
              .setMaxValue(50),
          ),
      )
      .toJSON();
  }

  async handleInteraction(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    const subcommand = interaction.options.getSubcommand();
    if (subcommand === 'create') {
      await this.handleCreate(interaction);
    }
  }

  async handleAutocomplete(
    interaction: AutocompleteInteraction,
  ): Promise<void> {
    const focused = interaction.options.getFocused(true);
    if (focused.name === 'game') {
      await this.autocompleteGame(interaction, focused.value);
    }
  }

  private async handleCreate(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    await interaction.deferReply({ ephemeral: true });

    const title = interaction.options.getString('title', true);
    const gameName = interaction.options.getString('game', true);
    const timeInput = interaction.options.getString('time', true);
    const rosterType = interaction.options.getString('roster') ?? 'generic';
    const slots = interaction.options.getInteger('slots') ?? DEFAULT_SLOTS;
    const tanks = interaction.options.getInteger('tanks');
    const healers = interaction.options.getInteger('healers');
    const dps = interaction.options.getInteger('dps');

    // Resolve the Discord user to a Raid Ledger user
    const discordId = interaction.user.id;
    const user = await this.usersService.findByDiscordId(discordId);
    if (!user) {
      await interaction.editReply(
        'You need a Raid Ledger account linked to Discord to create events. ' +
          'Log in to Raid Ledger via Discord OAuth first.',
      );
      return;
    }

    // Resolve the game from the IGDB games catalog
    const matchedGames = await this.db
      .select()
      .from(schema.games)
      .where(ilike(schema.games.name, gameName))
      .limit(1);

    const game = matchedGames[0] ?? null;

    // Also check if there's a matching game_registry entry (for slot configs, event types, etc.)
    let registryGameId: string | undefined;
    if (game) {
      const [registryMatch] = await this.db
        .select({ id: schema.gameRegistry.id })
        .from(schema.gameRegistry)
        .where(ilike(schema.gameRegistry.name, game.name))
        .limit(1);
      registryGameId = registryMatch?.id;
    }

    // Use the user's timezone preference, falling back to community default
    const userTzPref = await this.preferencesService.getUserPreference(user.id, 'timezone');
    const userTz = userTzPref?.value as string | undefined;
    const defaultTz = await this.settingsService.get('default_timezone');
    const timezone = userTz && userTz !== 'auto' ? userTz : defaultTz;

    // Parse natural language time
    const parsed = parseNaturalTime(timeInput, timezone);
    if (!parsed) {
      await interaction.editReply(
        `Could not parse time: "${timeInput}". Try something like "tonight 8pm" or "Friday 7:30pm".`,
      );
      return;
    }

    // Calculate end time (default 2 hours after start)
    const startTime = parsed.date;
    const endTime = new Date(
      startTime.getTime() + DEFAULT_DURATION_HOURS * 60 * 60 * 1000,
    );

    // Build slot config based on roster type
    let slotConfig: { type: 'generic' | 'mmo'; tank?: number; healer?: number; dps?: number } | undefined;
    let maxAttendees = slots;

    if (rosterType === 'mmo') {
      const tankSlots = tanks ?? 1;
      const healerSlots = healers ?? 1;
      const dpsSlots = dps ?? 3;
      maxAttendees = tankSlots + healerSlots + dpsSlots;

      slotConfig = {
        type: 'mmo',
        tank: tankSlots,
        healer: healerSlots,
        dps: dpsSlots,
      };
    }

    // Create the event via EventsService
    try {
      const event = await this.eventsService.create(user.id, {
        title,
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
        gameId: game?.igdbId ?? undefined,
        registryGameId,
        maxAttendees,
        slotConfig,
      });

      // Build ephemeral confirmation for creator
      const clientUrl = process.env.CLIENT_URL ?? null;
      let magicLinkUrl: string | null = null;
      if (clientUrl) {
        magicLinkUrl = await this.magicLinkService.generateLink(
          user.id,
          `/events/${event.id}/edit`,
          clientUrl,
        );
      }

      const rosterInfo =
        rosterType === 'mmo' && slotConfig
          ? `Roster: **MMO** (${slotConfig.tank}T / ${slotConfig.healer}H / ${slotConfig.dps}D)`
          : `Slots: **${maxAttendees}**`;

      const confirmEmbed = new EmbedBuilder()
        .setColor(0x34d399) // Emerald
        .setTitle('Event Created')
        .setDescription(
          [
            `**${title}**`,
            '',
            `${toDiscordTimestamp(startTime, 'F')} (${toDiscordTimestamp(startTime, 'R')})`,
            game ? `Game: **${game.name}**` : null,
            rosterInfo,
            '',
            `Timezone: ${parsed.timezone}`,
          ]
            .filter(Boolean)
            .join('\n'),
        );

      const components: ActionRowBuilder<ButtonBuilder>[] = [];
      if (magicLinkUrl) {
        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setLabel('Configure in Raid Ledger')
            .setStyle(ButtonStyle.Link)
            .setURL(magicLinkUrl)
            .setEmoji({ name: '\u2699\uFE0F' }),
        );
        components.push(row);
      }

      await interaction.editReply({
        embeds: [confirmEmbed],
        components,
      });

      // Post public announcement embed to the bound channel
      await this.postPublicAnnouncement(event, registryGameId ?? null);
    } catch (error) {
      this.logger.error('Failed to create event via slash command:', error);
      await interaction.editReply(
        'Failed to create event. Please try again or use the web app.',
      );
    }
  }

  /**
   * Post a public announcement embed to the bound (or default) channel.
   * Uses the ROK-118 DiscordEmbedFactory if available.
   */
  private async postPublicAnnouncement(
    event: {
      id: number;
      title: string;
      startTime: string;
      endTime: string;
      signupCount: number;
      maxAttendees?: number | null;
      game?: { name: string; coverUrl?: string | null } | null;
    },
    registryGameId: string | null,
  ): Promise<void> {
    if (!this.clientService.isConnected()) return;

    const channelId = await this.channelResolver.resolveChannelForEvent(
      registryGameId,
    );
    if (!channelId) return;

    const guildId = this.clientService.getGuildId();
    if (!guildId) return;

    try {
      const branding = await this.settingsService.getBranding();
      const context: EmbedContext = {
        communityName: branding.communityName,
        clientUrl: process.env.CLIENT_URL ?? null,
      };

      const embedData = {
        id: event.id,
        title: event.title,
        startTime: event.startTime,
        endTime: event.endTime,
        signupCount: event.signupCount,
        maxAttendees: event.maxAttendees,
        game: event.game
          ? { name: event.game.name, coverUrl: event.game.coverUrl ?? null }
          : null,
      };

      const { embed, row } = this.embedFactory.buildEventAnnouncement(
        embedData,
        context,
      );

      const message = await this.clientService.sendEmbed(channelId, embed, row);

      // Store message reference for future updates
      await this.db.insert(schema.discordEventMessages).values({
        eventId: event.id,
        guildId,
        channelId,
        messageId: message.id,
        embedState: EMBED_STATES.POSTED,
      });

      this.logger.log(
        `Posted event embed for event ${event.id} to channel ${channelId}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to post public announcement for event ${event.id}:`,
        error,
      );
    }
  }

  /**
   * Autocomplete handler for game names.
   * Searches the full IGDB games catalog, not just the game registry.
   */
  private async autocompleteGame(
    interaction: AutocompleteInteraction,
    query: string,
  ): Promise<void> {
    const results = await this.db
      .select({ id: schema.games.id, name: schema.games.name })
      .from(schema.games)
      .where(ilike(schema.games.name, `%${query}%`))
      .limit(25);

    await interaction.respond(
      results.map((g) => ({ name: g.name, value: g.name })),
    );
  }
}
