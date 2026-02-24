import { Injectable, Inject, Logger } from '@nestjs/common';
import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ChatInputCommandInteraction,
  type AutocompleteInteraction,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
} from 'discord.js';
import { and, ilike, gte, sql, asc } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import { buildWordMatchFilters } from '../../common/search.util';
import { SignupsService } from '../../events/signups.service';
import { EMBED_COLORS } from '../discord-bot.constants';
import { DiscordEmojiService } from '../services/discord-emoji.service';
import type { SlashCommandHandler } from './register-commands';
import type { CommandInteractionHandler } from '../listeners/interaction.listener';

@Injectable()
export class RosterViewCommand
  implements SlashCommandHandler, CommandInteractionHandler
{
  readonly commandName = 'roster';
  private readonly logger = new Logger(RosterViewCommand.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private db: PostgresJsDatabase<typeof schema>,
    private readonly signupsService: SignupsService,
    private readonly emojiService: DiscordEmojiService,
  ) {}

  getDefinition(): RESTPostAPIChatInputApplicationCommandsJSONBody {
    return new SlashCommandBuilder()
      .setName('roster')
      .setDescription('View roster for an event')
      .setDMPermission(true)
      .addStringOption((opt) =>
        opt
          .setName('event')
          .setDescription('Event title')
          .setRequired(true)
          .setAutocomplete(true),
      )
      .toJSON();
  }

  async handleInteraction(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    await interaction.deferReply({ ephemeral: true });

    const eventInput = interaction.options.getString('event', true);

    try {
      // Try to parse as event ID first, otherwise search by title
      const eventId = parseInt(eventInput, 10);
      let resolvedEventId: number;

      if (!isNaN(eventId)) {
        resolvedEventId = eventId;
      } else {
        // Search by title
        const events = await this.db
          .select({ id: schema.events.id })
          .from(schema.events)
          .where(ilike(schema.events.title, eventInput))
          .limit(1);

        if (events.length === 0) {
          await interaction.editReply(
            `No event found matching "${eventInput}".`,
          );
          return;
        }
        resolvedEventId = events[0].id;
      }

      const roster =
        await this.signupsService.getRosterWithAssignments(resolvedEventId);

      // Get event details for the title
      const [event] = await this.db
        .select({
          title: schema.events.title,
          maxAttendees: schema.events.maxAttendees,
        })
        .from(schema.events)
        .where(sql`${schema.events.id} = ${resolvedEventId}`)
        .limit(1);

      if (!event) {
        await interaction.editReply('Event not found.');
        return;
      }

      // Build role breakdown
      const roleGroups = new Map<string, string[]>();
      for (const assignment of roster.assignments) {
        const role = assignment.slot ?? 'unassigned';
        if (!roleGroups.has(role)) {
          roleGroups.set(role, []);
        }
        roleGroups.get(role)!.push(assignment.username);
      }

      const lines: string[] = [];
      const roleOrder = ['tank', 'healer', 'dps', 'flex', 'player', 'bench'];
      const staticEmojis: Record<string, string> = {
        flex: '\uD83D\uDD00',
        player: '\uD83C\uDFAE',
        bench: '\uD83E\uDE91',
      };

      for (const role of roleOrder) {
        const members = roleGroups.get(role);
        if (!members || members.length === 0) continue;

        const emoji =
          this.emojiService.getRoleEmoji(role) || staticEmojis[role] || '';
        const slotCount = roster.slots
          ? ((roster.slots as Record<string, number>)[role] ?? 0)
          : 0;
        const header = slotCount
          ? `${emoji} **${role.charAt(0).toUpperCase() + role.slice(1)}** (${members.length}/${slotCount})`
          : `${emoji} **${role.charAt(0).toUpperCase() + role.slice(1)}** (${members.length})`;

        lines.push(header);
        for (const name of members) {
          lines.push(`  \u2022 ${name}`);
        }
        lines.push('');
      }

      // Unassigned pool
      if (roster.pool.length > 0) {
        lines.push(`**Unassigned** (${roster.pool.length})`);
        for (const member of roster.pool) {
          lines.push(`  \u2022 ${member.username}`);
        }
      }

      const totalAssigned = roster.assignments.length;
      const totalPool = roster.pool.length;
      const total = totalAssigned + totalPool;

      const embed = new EmbedBuilder()
        .setColor(EMBED_COLORS.ROSTER_UPDATE)
        .setTitle(`Roster: ${event.title}`)
        .setDescription(lines.length > 0 ? lines.join('\n') : 'No signups yet.')
        .setFooter({
          text: `${total} total signups${event.maxAttendees ? ` / ${event.maxAttendees} slots` : ''}`,
        })
        .setTimestamp();

      const clientUrl = process.env.CLIENT_URL ?? null;
      const components: ActionRowBuilder<ButtonBuilder>[] = [];
      if (clientUrl) {
        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setLabel('View Full Roster')
            .setStyle(ButtonStyle.Link)
            .setURL(`${clientUrl}/events/${resolvedEventId}`),
        );
        components.push(row);
      }

      await interaction.editReply({
        embeds: [embed],
        components,
      });
    } catch (error) {
      this.logger.error('Failed to show roster:', error);
      await interaction.editReply(
        'Failed to fetch roster. Please try again later.',
      );
    }
  }

  async handleAutocomplete(
    interaction: AutocompleteInteraction,
  ): Promise<void> {
    const query = interaction.options.getFocused();

    // Search upcoming events by title
    const now = new Date().toISOString();
    const titleFilters = buildWordMatchFilters(schema.events.title, query);
    const upcomingFilter = gte(
      sql`upper(${schema.events.duration})`,
      sql`${now}::timestamp`,
    );
    const events = await this.db
      .select({ id: schema.events.id, title: schema.events.title })
      .from(schema.events)
      .where(
        titleFilters.length > 0
          ? and(...titleFilters, upcomingFilter)
          : upcomingFilter,
      )
      .orderBy(asc(sql`lower(${schema.events.duration})`))
      .limit(25);

    await interaction.respond(
      events.map((e) => ({
        name: e.title,
        value: String(e.id),
      })),
    );
  }
}
