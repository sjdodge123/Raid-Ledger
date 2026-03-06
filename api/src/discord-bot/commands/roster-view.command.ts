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
      const eventId = await this.resolveEventId(interaction, eventInput);
      if (eventId === null) return;
      await this.showRoster(interaction, eventId);
    } catch (error) {
      this.logger.error('Failed to show roster:', error);
      await interaction.editReply(
        'Failed to fetch roster. Please try again later.',
      );
    }
  }

  /** Resolve event input to an ID. Returns null if not found. */
  private async resolveEventId(
    interaction: ChatInputCommandInteraction,
    input: string,
  ): Promise<number | null> {
    const parsed = parseInt(input, 10);
    if (!isNaN(parsed)) return parsed;
    const events = await this.db
      .select({ id: schema.events.id })
      .from(schema.events)
      .where(ilike(schema.events.title, input))
      .limit(1);
    if (events.length === 0) {
      await interaction.editReply(`No event found matching "${input}".`);
      return null;
    }
    return events[0].id;
  }

  /** Build and display the roster embed for an event. */
  private async showRoster(
    interaction: ChatInputCommandInteraction,
    eventId: number,
  ): Promise<void> {
    const roster = await this.signupsService.getRosterWithAssignments(eventId);
    const [event] = await this.db
      .select({
        title: schema.events.title,
        maxAttendees: schema.events.maxAttendees,
      })
      .from(schema.events)
      .where(sql`${schema.events.id} = ${eventId}`)
      .limit(1);
    if (!event) {
      await interaction.editReply('Event not found.');
      return;
    }
    const lines = this.buildRosterLines(roster);
    const total = roster.assignments.length + roster.pool.length;
    const embed = new EmbedBuilder()
      .setColor(EMBED_COLORS.ROSTER_UPDATE)
      .setTitle(`Roster: ${event.title}`)
      .setDescription(lines.length > 0 ? lines.join('\n') : 'No signups yet.')
      .setFooter({
        text: `${total} total signups${event.maxAttendees ? ` / ${event.maxAttendees} slots` : ''}`,
      })
      .setTimestamp();
    const components = buildViewRosterRow(eventId);
    await interaction.editReply({ embeds: [embed], components });
  }

  /** Build roster display lines grouped by role. */
  private buildRosterLines(
    roster: Awaited<ReturnType<SignupsService['getRosterWithAssignments']>>,
  ): string[] {
    const groups = groupAssignmentsByRole(roster.assignments);
    const lines: string[] = [];
    for (const role of ROLE_ORDER) {
      const members = groups.get(role);
      if (!members || members.length === 0) continue;
      const emoji =
        this.emojiService.getRoleEmoji(role) || STATIC_EMOJIS[role] || '';
      const slots = roster.slots as Record<string, number> | null;
      const slotCount = slots ? (slots[role] ?? 0) : 0;
      const cap = role.charAt(0).toUpperCase() + role.slice(1);
      const header = slotCount
        ? `${emoji} **${cap}** (${members.length}/${slotCount})`
        : `${emoji} **${cap}** (${members.length})`;
      lines.push(header);
      for (const name of members) lines.push(`  \u2022 ${name}`);
      lines.push('');
    }
    if (roster.pool.length > 0) {
      lines.push(`**Unassigned** (${roster.pool.length})`);
      for (const m of roster.pool) lines.push(`  \u2022 ${m.username}`);
    }
    return lines;
  }

  /** Autocomplete handler for event search. */
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

function groupAssignmentsByRole(
  assignments: { slot: string | null; username: string }[],
): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const a of assignments) {
    const role = a.slot ?? 'unassigned';
    if (!groups.has(role)) groups.set(role, []);
    groups.get(role)!.push(a.username);
  }
  return groups;
}

const ROLE_ORDER = ['tank', 'healer', 'dps', 'flex', 'player', 'bench'];
const STATIC_EMOJIS: Record<string, string> = {
  flex: '\uD83D\uDD00',
  player: '\uD83C\uDFAE',
  bench: '\uD83E\uDE91',
};

function buildViewRosterRow(
  eventId: number,
): ActionRowBuilder<ButtonBuilder>[] {
  const clientUrl = process.env.CLIENT_URL ?? null;
  if (!clientUrl) return [];
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setLabel('View Full Roster')
      .setStyle(ButtonStyle.Link)
      .setURL(`${clientUrl}/events/${eventId}`),
  );
  return [row];
}
