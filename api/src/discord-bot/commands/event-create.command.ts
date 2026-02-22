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
import { and, ilike } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import { buildWordMatchFilters } from '../../common/search.util';
import { EventsService } from '../../events/events.service';
import { UsersService } from '../../users/users.service';
import { PreferencesService } from '../../users/preferences.service';
import { SettingsService } from '../../settings/settings.service';
import { MagicLinkService } from '../../auth/magic-link.service';
import { parseNaturalTime, toDiscordTimestamp } from '../utils/time-parser';
import type { SlashCommandHandler } from './register-commands';
import type { CommandInteractionHandler } from '../listeners/interaction.listener';

const DEFAULT_SLOTS = 20;
const DEFAULT_DURATION_HOURS = 2;
const FALLBACK_TIMEZONE = 'America/New_York';

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
      .addSubcommand((sub) =>
        sub
          .setName('plan')
          .setDescription(
            'Plan an event with a community poll to find the best time',
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
    } else if (subcommand === 'plan') {
      await this.handlePlan(interaction);
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

    // Use the user's timezone preference, falling back to community default
    const userTzPref = await this.preferencesService.getUserPreference(
      user.id,
      'timezone',
    );
    const userTz = userTzPref?.value as string | undefined;
    const defaultTz = await this.settingsService.get('default_timezone');
    const timezone =
      (userTz && userTz !== 'auto' ? userTz : defaultTz) || FALLBACK_TIMEZONE;

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
    let slotConfig:
      | {
          type: 'generic' | 'mmo';
          tank?: number;
          healer?: number;
          dps?: number;
        }
      | undefined;
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
        gameId: game?.id ?? undefined,
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

      // Public announcement embed is posted automatically by DiscordEventListener
      // when EventsService.create() emits the 'event.created' app event.
    } catch (error) {
      this.logger.error('Failed to create event via slash command:', error);
      await interaction.editReply(
        'Failed to create event. Please try again or use the web app.',
      );
    }
  }

  /**
   * Handle the /event plan subcommand.
   * Generates a magic link to the web plan form.
   */
  private async handlePlan(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    await interaction.deferReply({ ephemeral: true });

    const discordId = interaction.user.id;
    const user = await this.usersService.findByDiscordId(discordId);
    if (!user) {
      await interaction.editReply(
        'You need a Raid Ledger account linked to Discord to plan events. ' +
          'Log in to Raid Ledger via Discord OAuth first.',
      );
      return;
    }

    const clientUrl = process.env.CLIENT_URL ?? null;
    if (!clientUrl) {
      await interaction.editReply(
        'The web app URL is not configured. Contact an admin.',
      );
      return;
    }

    const magicLinkUrl = await this.magicLinkService.generateLink(
      user.id,
      '/events/plan',
      clientUrl,
    );

    if (!magicLinkUrl) {
      await interaction.editReply(
        'Failed to generate a link. Please try again.',
      );
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(0x8b5cf6) // Violet
      .setTitle('Plan an Event')
      .setDescription(
        'Use the web form to pick candidate time slots and start a community poll.',
      );

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setLabel('Open Planning Form')
        .setStyle(ButtonStyle.Link)
        .setURL(magicLinkUrl)
        .setEmoji({ name: '\uD83D\uDCCA' }),
    );

    await interaction.editReply({
      embeds: [embed],
      components: [row],
    });
  }

  /**
   * Autocomplete handler for game names.
   * Searches the full IGDB games catalog, not just the game registry.
   */
  private async autocompleteGame(
    interaction: AutocompleteInteraction,
    query: string,
  ): Promise<void> {
    const filters = buildWordMatchFilters(schema.games.name, query);
    const results = await this.db
      .select({ id: schema.games.id, name: schema.games.name })
      .from(schema.games)
      .where(filters.length > 0 ? and(...filters) : undefined)
      .limit(25);

    await interaction.respond(
      results.map((g) => ({ name: g.name, value: g.name })),
    );
  }
}
