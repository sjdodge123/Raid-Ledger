import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  SlashCommandBuilder,
  ChannelType,
  type ChatInputCommandInteraction,
  type AutocompleteInteraction,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
} from 'discord.js';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import { ChannelBindingsService } from '../services/channel-bindings.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { APP_EVENT_EVENTS } from '../discord-bot.constants';
import type { SlashCommandHandler } from './register-commands';
import type { CommandInteractionHandler } from '../listeners/interaction.listener';
import {
  buildBindSuccessEmbed,
  buildEventBindEmbed,
  autocompleteGames,
  autocompleteSeries,
  autocompleteEvents,
  buildEventUpdatePayload,
  setChannelOverride,
  applyGameChange,
  findSeriesEventIds,
} from './bind.helpers';
import {
  resolveChannel,
  resolveGame,
  resolveSeries,
  lookupEvent,
  checkEventPermission,
  type ResolvedChannel,
} from './bind.resolvers';

@Injectable()
export class BindCommand
  implements SlashCommandHandler, CommandInteractionHandler
{
  readonly commandName = 'bind';
  private readonly logger = new Logger(BindCommand.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private db: PostgresJsDatabase<typeof schema>,
    private readonly channelBindingsService: ChannelBindingsService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  getDefinition(): RESTPostAPIChatInputApplicationCommandsJSONBody {
    return new SlashCommandBuilder()
      .setName('bind')
      .setDescription(
        'Bind a Discord channel to a game, event series, or event',
      )
      .setDMPermission(false)
      .addStringOption((opt) =>
        opt
          .setName('event')
          .setDescription('Specific event to override channel or game for')
          .setAutocomplete(true),
      )
      .addChannelOption((opt) =>
        opt
          .setName('channel')
          .setDescription('Channel to bind (defaults to current)')
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildVoice),
      )
      .addStringOption((opt) =>
        opt.setName('game').setDescription('Game name').setAutocomplete(true),
      )
      .addStringOption((opt) =>
        opt
          .setName('series')
          .setDescription('Event series (recurrence group)')
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
      await this.handleEventBind(interaction, guildId, eventValue);
      return;
    }
    await this.handleChannelBind(interaction, guildId);
  }

  async handleAutocomplete(
    interaction: AutocompleteInteraction,
  ): Promise<void> {
    const focused = interaction.options.getFocused(true);
    if (focused.name === 'event') {
      await interaction.respond(
        await autocompleteEvents(this.db, interaction.user.id, focused.value),
      );
    } else if (focused.name === 'game') {
      await interaction.respond(
        await autocompleteGames(this.db, focused.value),
      );
    } else if (focused.name === 'series') {
      await interaction.respond(
        await autocompleteSeries(this.db, focused.value),
      );
    }
  }

  // ─── Channel binding ──────────────────────────────────

  private async handleChannelBind(
    interaction: ChatInputCommandInteraction,
    guildId: string,
  ): Promise<void> {
    const resolved = resolveChannel(interaction);
    if (!resolved.channelId) {
      await interaction.editReply('Could not determine the target channel.');
      return;
    }
    const game = await resolveGame(this.db, interaction);
    if (game === false) return;
    const series = await resolveSeries(this.db, interaction);
    if (series === false) return;
    await this.tryBindChannel(
      interaction,
      guildId,
      resolved as ResolvedChannel & { channelId: string },
      game,
      series,
    );
  }

  private async tryBindChannel(
    interaction: ChatInputCommandInteraction,
    guildId: string,
    ch: ResolvedChannel & { channelId: string },
    game: { id: number; name: string } | null,
    series: { id: string; title: string } | null,
  ): Promise<void> {
    try {
      await this.executeBindAndReply(interaction, guildId, ch, game, series);
      if (series) {
        await this.resyncSeriesEvents(series.id);
      }
    } catch (err: unknown) {
      this.logger.error('Failed to create channel binding:', err);
      await interaction.editReply(
        'Failed to bind channel. Please try again or use the web admin panel.',
      );
    }
  }

  private async executeBindAndReply(
    interaction: ChatInputCommandInteraction,
    guildId: string,
    ch: ResolvedChannel & { channelId: string },
    game: { id: number; name: string } | null,
    series: { id: string; title: string } | null,
  ): Promise<void> {
    const behavior = this.channelBindingsService.detectBehavior(
      ch.bindingChannelType,
      game?.id ?? null,
    );
    const { replacedChannelIds } = await this.channelBindingsService.bind(
      guildId,
      ch.channelId,
      ch.bindingChannelType,
      behavior,
      game?.id ?? null,
      undefined,
      series?.id ?? null,
    );
    const { embed, components } = buildBindSuccessEmbed(
      ch.channelName,
      behavior,
      series?.title ?? null,
      game?.name ?? null,
      replacedChannelIds,
    );
    await interaction.editReply({ embeds: [embed], components });
  }

  /** Re-syncs Discord embeds/scheduled events for all events in a series. */
  private async resyncSeriesEvents(recurrenceGroupId: string): Promise<void> {
    const ids = await findSeriesEventIds(this.db, recurrenceGroupId);
    for (const id of ids) {
      const payload = await buildEventUpdatePayload(this.db, id);
      if (payload) {
        this.eventEmitter.emit(APP_EVENT_EVENTS.UPDATED, payload);
      }
    }
    this.logger.log(
      `Re-synced ${ids.length} events for series ${recurrenceGroupId}`,
    );
  }

  // ─── Event binding ────────────────────────────────────

  private async handleEventBind(
    interaction: ChatInputCommandInteraction,
    guildId: string,
    eventIdStr: string,
  ): Promise<void> {
    const eventId = parseInt(eventIdStr, 10);
    if (isNaN(eventId)) {
      await interaction.editReply('Invalid event. Use autocomplete.');
      return;
    }
    const event = await lookupEvent(this.db, eventId);
    if (!event) {
      await interaction.editReply('Event not found.');
      return;
    }
    const allowed = await checkEventPermission(
      this.db,
      interaction,
      event.creatorId,
    );
    if (!allowed) return;
    await this.applyAndReplyEventBind(interaction, eventId, event.title);
  }

  private async applyAndReplyEventBind(
    interaction: ChatInputCommandInteraction,
    eventId: number,
    eventTitle: string,
  ): Promise<void> {
    const channelOption = interaction.options.getChannel('channel');
    const gameName = interaction.options.getString('game');
    if (!channelOption && !gameName) {
      await interaction.editReply(
        'Provide `channel` and/or `game` when using `/bind event`.',
      );
      return;
    }
    const changes = await this.applyEventChanges(
      eventId,
      channelOption,
      gameName,
      interaction,
    );
    if (!changes) return;
    await this.emitEventUpdate(eventId);
    await interaction.editReply({
      embeds: [buildEventBindEmbed(eventTitle, changes)],
    });
  }

  private async applyEventChanges(
    eventId: number,
    channelOption: ReturnType<
      ChatInputCommandInteraction['options']['getChannel']
    >,
    gameName: string | null,
    interaction: ChatInputCommandInteraction,
  ): Promise<string[] | null> {
    const changes: string[] = [];
    if (channelOption) {
      const ch = channelOption as { name?: string; id: string };
      const name = ch.name ?? ch.id;
      await setChannelOverride(this.db, eventId, channelOption.id);
      changes.push(`Notification channel set to **#${name}**`);
    }
    if (gameName) {
      const result = await applyGameChange(this.db, eventId, gameName);
      if (!result) return changes;
      if ('error' in result) {
        await interaction.editReply(result.error);
        return null;
      }
      changes.push(result.change);
    }
    return changes;
  }

  private async emitEventUpdate(eventId: number): Promise<void> {
    const payload = await buildEventUpdatePayload(this.db, eventId);
    if (payload) this.eventEmitter.emit(APP_EVENT_EVENTS.UPDATED, payload);
  }
}
