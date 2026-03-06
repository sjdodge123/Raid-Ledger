import { Inject, Injectable, Logger } from '@nestjs/common';
import {
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
import {
  buildEventCommandDefinition,
  buildSlotConfig,
} from './event-create.helpers';

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
    return buildEventCommandDefinition();
  }

  async handleInteraction(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    const sub = interaction.options.getSubcommand();
    if (sub === 'create') await this.handleCreate(interaction);
    else if (sub === 'plan') await this.handlePlan(interaction);
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

    const user = await this.resolveUser(interaction);
    if (!user) return;

    const { title, game, parsed, slotConfig, maxAttendees } =
      await this.parseCreateOptions(interaction, user.id);
    if (!parsed) return;

    const startTime = parsed.date;
    const endTime = new Date(
      startTime.getTime() + DEFAULT_DURATION_HOURS * 60 * 60 * 1000,
    );

    try {
      const event = await this.eventsService.create(user.id, {
        title,
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
        gameId: game?.id ?? undefined,
        maxAttendees,
        slotConfig,
      });

      await this.replyWithConfirmation(
        interaction,
        event.id,
        user.id,
        title,
        game,
        slotConfig,
        maxAttendees,
        parsed,
        startTime,
      );
    } catch (error) {
      this.logger.error('Failed to create event:', error);
      await interaction.editReply('Failed to create event.');
    }
  }

  private async handlePlan(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    await interaction.deferReply({ ephemeral: true });

    const user = await this.resolveUser(interaction);
    if (!user) return;

    const clientUrl = process.env.CLIENT_URL || process.env.CORS_ORIGIN || null;
    if (!clientUrl || clientUrl === 'auto') {
      await interaction.editReply('The web app URL is not configured.');
      return;
    }

    const magicLinkUrl = await this.magicLinkService.generateLink(
      user.id,
      '/events/plan',
      clientUrl,
    );
    if (!magicLinkUrl) {
      await interaction.editReply('Failed to generate a link.');
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(0x8b5cf6)
      .setTitle('Plan an Event')
      .setDescription('Use the web form to pick time slots and start a poll.');

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setLabel('Open Planning Form')
        .setStyle(ButtonStyle.Link)
        .setURL(magicLinkUrl)
        .setEmoji({ name: '\uD83D\uDCCA' }),
    );

    await interaction.editReply({ embeds: [embed], components: [row] });
  }

  // ─── Helpers ──────────────────────────────────────────────

  private async resolveUser(
    interaction: ChatInputCommandInteraction,
  ): Promise<{ id: number } | null> {
    const user = await this.usersService.findByDiscordId(interaction.user.id);
    if (!user) {
      await interaction.editReply(
        'You need a Raid Ledger account linked to Discord.',
      );
      return null;
    }
    return user;
  }

  private async parseCreateOptions(
    interaction: ChatInputCommandInteraction,
    userId: number,
  ): Promise<{
    title: string;
    game: { id: number; name: string } | null;
    parsed: ReturnType<typeof parseNaturalTime>;
    slotConfig: ReturnType<typeof buildSlotConfig>['slotConfig'];
    maxAttendees: number;
  }> {
    const title = interaction.options.getString('title', true);
    const gameName = interaction.options.getString('game', true);
    const timeInput = interaction.options.getString('time', true);
    const rosterType = interaction.options.getString('roster') ?? 'generic';
    const slots = interaction.options.getInteger('slots') ?? DEFAULT_SLOTS;
    const tanks = interaction.options.getInteger('tanks');
    const healers = interaction.options.getInteger('healers');
    const dps = interaction.options.getInteger('dps');

    const game = await this.resolveGame(gameName);
    const timezone = await this.resolveTimezone(userId);
    const parsed = parseNaturalTime(timeInput, timezone);

    if (!parsed) {
      await interaction.editReply(
        `Could not parse time: "${timeInput}". Try "tonight 8pm".`,
      );
    }

    const { slotConfig, maxAttendees } = buildSlotConfig(
      rosterType,
      slots,
      tanks,
      healers,
      dps,
    );
    return { title, game, parsed, slotConfig, maxAttendees };
  }

  private async resolveGame(
    gameName: string,
  ): Promise<{ id: number; name: string } | null> {
    const matches = await this.db
      .select()
      .from(schema.games)
      .where(ilike(schema.games.name, gameName))
      .limit(1);
    return matches[0] ?? null;
  }

  private async resolveTimezone(userId: number): Promise<string> {
    const pref = await this.preferencesService.getUserPreference(
      userId,
      'timezone',
    );
    const userTz = pref?.value as string | undefined;
    const defaultTz = await this.settingsService.get('default_timezone');
    return (
      (userTz && userTz !== 'auto' ? userTz : defaultTz) || FALLBACK_TIMEZONE
    );
  }

  private async replyWithConfirmation(
    interaction: ChatInputCommandInteraction,
    eventId: number,
    userId: number,
    title: string,
    game: { id: number; name: string } | null,
    slotConfig: ReturnType<typeof buildSlotConfig>['slotConfig'],
    maxAttendees: number,
    parsed: NonNullable<ReturnType<typeof parseNaturalTime>>,
    startTime: Date,
  ): Promise<void> {
    const clientUrl = process.env.CLIENT_URL || process.env.CORS_ORIGIN || null;
    let magicLinkUrl: string | null = null;
    if (clientUrl && clientUrl !== 'auto') {
      magicLinkUrl = await this.magicLinkService.generateLink(
        userId,
        `/events/${eventId}/edit`,
        clientUrl,
      );
    }

    const rosterInfo =
      slotConfig?.type === 'mmo'
        ? `Roster: **MMO** (${slotConfig.tank}T / ${slotConfig.healer}H / ${slotConfig.dps}D)`
        : `Slots: **${maxAttendees}**`;

    const embed = new EmbedBuilder()
      .setColor(0x34d399)
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
      components.push(
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setLabel('Configure in Raid Ledger')
            .setStyle(ButtonStyle.Link)
            .setURL(magicLinkUrl)
            .setEmoji({ name: '\u2699\uFE0F' }),
        ),
      );
    }

    await interaction.editReply({ embeds: [embed], components });
  }

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
