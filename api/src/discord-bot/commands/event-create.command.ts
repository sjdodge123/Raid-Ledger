import { Inject, Injectable, Logger } from '@nestjs/common';
import {
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
import { EventsService } from '../../events/events.service';
import { UsersService } from '../../users/users.service';
import { PreferencesService } from '../../users/preferences.service';
import { SettingsService } from '../../settings/settings.service';
import { MagicLinkService } from '../../auth/magic-link.service';
import { parseNaturalTime } from '../utils/time-parser';
import type { SlashCommandHandler } from './register-commands';
import type { CommandInteractionHandler } from '../listeners/interaction.listener';
import {
  buildEventCommandDefinition,
  buildSlotConfig,
  buildConfirmationEmbed,
  buildConfigureButton,
  buildPlanReply,
  type ParsedCreateOptions,
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
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const user = await this.resolveUser(interaction);
    if (!user) return;

    const opts = await this.parseCreateOptions(interaction, user.id);
    if (!opts.parsed) return;

    await this.createAndConfirm(interaction, user.id, opts);
  }

  private async createAndConfirm(
    interaction: ChatInputCommandInteraction,
    userId: number,
    opts: ParsedCreateOptions,
  ): Promise<void> {
    const startTime = opts.parsed!.date;
    const endTime = new Date(
      startTime.getTime() + DEFAULT_DURATION_HOURS * 60 * 60 * 1000,
    );

    try {
      const event = await this.eventsService.create(userId, {
        title: opts.title,
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
        gameId: opts.game?.id ?? undefined,
        maxAttendees: opts.maxAttendees,
        slotConfig: opts.slotConfig,
      });

      await this.replyWithConfirmation(
        interaction,
        event.id,
        userId,
        opts,
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
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const user = await this.resolveUser(interaction);
    if (!user) return;

    const magicLinkUrl = await this.resolvePlanLink(user.id);
    if (!magicLinkUrl) {
      await interaction.editReply(
        typeof magicLinkUrl === 'undefined'
          ? 'The web app URL is not configured.'
          : 'Failed to generate a link.',
      );
      return;
    }

    await interaction.editReply(buildPlanReply(magicLinkUrl));
  }

  private async resolvePlanLink(
    userId: number,
  ): Promise<string | null | undefined> {
    const clientUrl = process.env.CLIENT_URL || process.env.CORS_ORIGIN || null;
    if (!clientUrl || clientUrl === 'auto') return undefined;

    return this.magicLinkService.generateLink(
      userId,
      '/events/plan',
      clientUrl,
    );
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
  ): Promise<ParsedCreateOptions> {
    const title = interaction.options.getString('title', true);
    const gameName = interaction.options.getString('game', true);
    const timeInput = interaction.options.getString('time', true);

    const game = await this.resolveGame(gameName);
    const parsed = await this.parseTime(interaction, timeInput, userId);
    const { slotConfig, maxAttendees } = this.readSlotOptions(interaction);

    return { title, game, parsed, slotConfig, maxAttendees };
  }

  private async parseTime(
    interaction: ChatInputCommandInteraction,
    timeInput: string,
    userId: number,
  ): Promise<ReturnType<typeof parseNaturalTime>> {
    const timezone = await this.resolveTimezone(userId);
    const parsed = parseNaturalTime(timeInput, timezone);
    if (!parsed) {
      await interaction.editReply(
        `Could not parse time: "${timeInput}". Try "tonight 8pm".`,
      );
    }
    return parsed;
  }

  private readSlotOptions(
    interaction: ChatInputCommandInteraction,
  ): ReturnType<typeof buildSlotConfig> {
    const rosterType = interaction.options.getString('roster') ?? 'generic';
    const slots = interaction.options.getInteger('slots') ?? DEFAULT_SLOTS;
    return buildSlotConfig(
      rosterType,
      slots,
      interaction.options.getInteger('tanks'),
      interaction.options.getInteger('healers'),
      interaction.options.getInteger('dps'),
    );
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
    opts: ParsedCreateOptions,
    startTime: Date,
  ): Promise<void> {
    const magicLinkUrl = await this.resolveEditLink(userId, eventId);
    const embed = buildConfirmationEmbed(opts, startTime);
    const components = buildConfigureButton(magicLinkUrl);

    await interaction.editReply({ embeds: [embed], components });
  }

  private async resolveEditLink(
    userId: number,
    eventId: number,
  ): Promise<string | null> {
    const clientUrl = process.env.CLIENT_URL || process.env.CORS_ORIGIN || null;
    if (!clientUrl || clientUrl === 'auto') return null;
    return this.magicLinkService.generateLink(
      userId,
      `/events/${eventId}/edit`,
      clientUrl,
    );
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
