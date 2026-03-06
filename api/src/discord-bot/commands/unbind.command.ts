import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  SlashCommandBuilder,
  EmbedBuilder,
  ChannelType,
  type ChatInputCommandInteraction,
  type AutocompleteInteraction,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
} from 'discord.js';
import { eq } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import { ChannelBindingsService } from '../services/channel-bindings.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { APP_EVENT_EVENTS } from '../discord-bot.constants';
import type { SlashCommandHandler } from './register-commands';
import type { CommandInteractionHandler } from '../listeners/interaction.listener';
import { autocompleteSeries, autocompleteEvents } from './bind.helpers';

@Injectable()
export class UnbindCommand
  implements SlashCommandHandler, CommandInteractionHandler
{
  readonly commandName = 'unbind';
  private readonly logger = new Logger(UnbindCommand.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private db: PostgresJsDatabase<typeof schema>,
    private readonly channelBindingsService: ChannelBindingsService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  getDefinition(): RESTPostAPIChatInputApplicationCommandsJSONBody {
    return new SlashCommandBuilder()
      .setName('unbind')
      .setDescription('Remove a channel binding or event override')
      .setDMPermission(false)
      .addStringOption((opt) =>
        opt
          .setName('event')
          .setDescription('Clear notification override for a specific event')
          .setAutocomplete(true),
      )
      .addChannelOption((opt) =>
        opt
          .setName('channel')
          .setDescription('Channel to unbind (defaults to current)')
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildVoice),
      )
      .addStringOption((opt) =>
        opt
          .setName('series')
          .setDescription('Unbind only a specific event series')
          .setAutocomplete(true),
      )
      .toJSON();
  }

  async handleInteraction(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    await interaction.deferReply({ ephemeral: true });
    const guildId = interaction.guildId;
    if (!guildId) {
      await interaction.editReply('This command can only be used in a server.');
      return;
    }

    const eventValue = interaction.options.getString('event');
    if (eventValue) {
      await this.handleEventUnbind(interaction, eventValue);
      return;
    }

    await this.handleChannelUnbind(interaction, guildId);
  }

  async handleAutocomplete(
    interaction: AutocompleteInteraction,
  ): Promise<void> {
    const focused = interaction.options.getFocused(true);
    if (focused.name === 'event') {
      const results = await autocompleteEvents(
        this.db,
        interaction.user.id,
        focused.value,
      );
      await interaction.respond(results);
    } else if (focused.name === 'series') {
      const results = await autocompleteSeries(this.db, focused.value);
      await interaction.respond(results);
    }
  }

  // ─── Private handlers ──────────────────────────────────────

  private async handleChannelUnbind(
    interaction: ChatInputCommandInteraction,
    guildId: string,
  ): Promise<void> {
    const target =
      interaction.options.getChannel('channel') ?? interaction.channel;
    if (!target) {
      await interaction.editReply('Could not determine the target channel.');
      return;
    }
    const channelId = target.id;
    const channelName =
      'name' in target ? (target.name ?? channelId) : channelId;
    const series = await this.resolveSeries(interaction);

    try {
      const removed = await this.channelBindingsService.unbind(
        guildId,
        channelId,
        series?.id ?? null,
      );
      await this.replyUnbindResult(interaction, removed, channelName, series);
    } catch (error) {
      this.logger.error('Failed to unbind channel:', error);
      await interaction.editReply('Failed to unbind channel.');
    }
  }

  private async replyUnbindResult(
    interaction: ChatInputCommandInteraction,
    removed: boolean,
    channelName: string,
    series: { id: string; title: string } | null,
  ): Promise<void> {
    if (removed) {
      const suffix = series ? ` (series: **${series.title}**)` : '';
      const embed = new EmbedBuilder()
        .setColor(0xef4444)
        .setTitle('Channel Unbound')
        .setDescription(`Removed binding for **#${channelName}**${suffix}.`);
      await interaction.editReply({ embeds: [embed] });
    } else {
      const suffix = series ? ` for series **${series.title}**` : '';
      await interaction.editReply(
        `No binding found for **#${channelName}**${suffix}.`,
      );
    }
  }

  private async handleEventUnbind(
    interaction: ChatInputCommandInteraction,
    eventIdStr: string,
  ): Promise<void> {
    const eventId = parseInt(eventIdStr, 10);
    if (isNaN(eventId)) {
      await interaction.editReply('Invalid event. Use autocomplete.');
      return;
    }

    const event = await this.lookupEvent(eventId);
    if (!event) {
      await interaction.editReply('Event not found.');
      return;
    }

    const allowed = await this.checkPermission(interaction, event.creatorId);
    if (!allowed) return;

    if (!event.notificationChannelOverride) {
      await interaction.editReply(
        `**${event.title}** has no notification channel override to clear.`,
      );
      return;
    }

    await this.clearOverride(eventId);
    await this.emitEventUpdate(eventId);
    await this.replyOverrideCleared(interaction, event.title);
  }

  private async replyOverrideCleared(
    interaction: ChatInputCommandInteraction,
    title: string,
  ): Promise<void> {
    const embed = new EmbedBuilder()
      .setColor(0xef4444)
      .setTitle('Event Override Cleared')
      .setDescription(
        `Notification channel override removed for **${title}**.\nEmbeds will now use the default channel resolution.`,
      );
    await interaction.editReply({ embeds: [embed] });
  }

  // ─── Helpers ──────────────────────────────────────────────

  private async resolveSeries(
    interaction: ChatInputCommandInteraction,
  ): Promise<{ id: string; title: string } | null> {
    const value = interaction.options.getString('series');
    if (!value) return null;

    const [match] = await this.db
      .select({
        recurrenceGroupId: schema.events.recurrenceGroupId,
        title: schema.events.title,
      })
      .from(schema.events)
      .where(eq(schema.events.recurrenceGroupId, value))
      .limit(1);

    if (!match?.recurrenceGroupId) return null;
    return { id: match.recurrenceGroupId, title: match.title };
  }

  private async lookupEvent(eventId: number): Promise<{
    id: number;
    title: string;
    creatorId: number;
    notificationChannelOverride: string | null;
  } | null> {
    const [event] = await this.db
      .select({
        id: schema.events.id,
        title: schema.events.title,
        creatorId: schema.events.creatorId,
        notificationChannelOverride: schema.events.notificationChannelOverride,
      })
      .from(schema.events)
      .where(eq(schema.events.id, eventId))
      .limit(1);
    return event ?? null;
  }

  private async checkPermission(
    interaction: ChatInputCommandInteraction,
    creatorId: number,
  ): Promise<boolean> {
    const [user] = await this.db
      .select({ id: schema.users.id, role: schema.users.role })
      .from(schema.users)
      .where(eq(schema.users.discordId, interaction.user.id))
      .limit(1);

    if (!user) {
      await interaction.editReply('You need a linked Raid Ledger account.');
      return false;
    }

    const isAdmin = user.role === 'admin' || user.role === 'operator';
    if (creatorId !== user.id && !isAdmin) {
      await interaction.editReply(
        'You can only modify events you created, or you need operator/admin permissions.',
      );
      return false;
    }
    return true;
  }

  private async clearOverride(eventId: number): Promise<void> {
    await this.db
      .update(schema.events)
      .set({ notificationChannelOverride: null, updatedAt: new Date() })
      .where(eq(schema.events.id, eventId));
  }

  private async emitEventUpdate(eventId: number): Promise<void> {
    const [row] = await this.db
      .select({ events: schema.events, games: schema.games })
      .from(schema.events)
      .leftJoin(schema.games, eq(schema.events.gameId, schema.games.id))
      .where(eq(schema.events.id, eventId))
      .limit(1);

    if (!row) return;
    this.eventEmitter.emit(APP_EVENT_EVENTS.UPDATED, {
      eventId,
      event: {
        id: row.events.id,
        title: row.events.title,
        description: row.events.description,
        startTime: row.events.duration[0].toISOString(),
        endTime: row.events.duration[1].toISOString(),
        signupCount: 0,
        maxAttendees: row.events.maxAttendees,
        slotConfig: row.events.slotConfig,
        game: row.games
          ? { name: row.games.name, coverUrl: row.games.coverUrl }
          : null,
      },
      gameId: row.events.gameId ?? null,
      recurrenceGroupId: row.events.recurrenceGroupId ?? null,
      notificationChannelOverride: null,
    });
  }
}
