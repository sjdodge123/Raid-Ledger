import { Injectable, Inject, Logger } from '@nestjs/common';
import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type AutocompleteInteraction,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
} from 'discord.js';
import { eq } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import { DiscordBotClientService } from '../discord-bot-client.service';
import {
  DiscordEmbedFactory,
  type EmbedContext,
} from '../services/discord-embed.factory';
import { SettingsService } from '../../settings/settings.service';
import { EventsService } from '../../events/events.service';
import { PugsService } from '../../events/pugs.service';
import type { SlashCommandHandler } from './register-commands';
import type { CommandInteractionHandler } from '../listeners/interaction.listener';

@Injectable()
export class InviteCommand
  implements SlashCommandHandler, CommandInteractionHandler
{
  readonly commandName = 'invite';
  private readonly logger = new Logger(InviteCommand.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private db: PostgresJsDatabase<typeof schema>,
    private readonly clientService: DiscordBotClientService,
    private readonly embedFactory: DiscordEmbedFactory,
    private readonly settingsService: SettingsService,
    private readonly eventsService: EventsService,
    private readonly pugsService: PugsService,
  ) {}

  getDefinition(): RESTPostAPIChatInputApplicationCommandsJSONBody {
    return new SlashCommandBuilder()
      .setName('invite')
      .setDescription('Invite a Discord user or generate an invite link')
      .setDMPermission(false)
      .addIntegerOption((opt) =>
        opt
          .setName('event')
          .setDescription('Event to invite the user to')
          .setRequired(true)
          .setAutocomplete(true),
      )
      .addUserOption((opt) =>
        opt
          .setName('user')
          .setDescription('User to invite (omit for invite link)')
          .setRequired(false),
      )
      .toJSON();
  }

  async handleInteraction(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    await interaction.deferReply({ ephemeral: true });

    const eventId = interaction.options.getInteger('event', true);
    const targetUser = interaction.options.getUser('user', false);

    // Fetch event data
    let event;
    try {
      event = await this.eventsService.findOne(eventId);
    } catch {
      await interaction.editReply('Event not found');
      return;
    }

    if (event.cancelledAt) {
      await interaction.editReply('Event not found');
      return;
    }

    // Look up the invoking Discord user's RL account for PUG creation
    const [invoker] = await this.db
      .select({ id: schema.users.id, role: schema.users.role })
      .from(schema.users)
      .where(eq(schema.users.discordId, interaction.user.id))
      .limit(1);

    if (!invoker) {
      await interaction.editReply(
        'You need a linked Raid Ledger account to use this command.',
      );
      return;
    }

    const isAdmin = invoker.role === 'admin' || invoker.role === 'operator';

    if (targetUser) {
      // Mode 2: Named PUG — create PUG slot for specific user, triggers DM flow
      await this.handleNamedInvite(
        interaction,
        eventId,
        event,
        targetUser,
        invoker.id,
        isAdmin,
      );
    } else {
      // Mode 1: Anonymous invite link — generate tiny URL
      await this.handleAnonymousInvite(
        interaction,
        eventId,
        event,
        invoker.id,
        isAdmin,
      );
    }
  }

  /**
   * Mode 1: No user specified — create anonymous PUG slot and return tiny URL.
   */
  private async handleAnonymousInvite(
    interaction: ChatInputCommandInteraction,
    eventId: number,
    event: { title: string },
    userId: number,
    isAdmin: boolean,
  ): Promise<void> {
    try {
      const pugSlot = await this.pugsService.create(eventId, userId, isAdmin, {
        role: 'dps',
      });

      const clientUrl = process.env.CLIENT_URL ?? '';
      const tinyUrl = `${clientUrl}/i/${pugSlot.inviteCode}`;

      await interaction.editReply(
        `Invite link for **${event.title}**:\n${tinyUrl}\n\nShare this link — anyone who clicks it can join the event.`,
      );

      this.logger.log(
        'Generated invite link for event %d: %s (by %s)',
        eventId,
        pugSlot.inviteCode,
        interaction.user.username,
      );
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Failed to generate invite link';
      await interaction.editReply(msg);
    }
  }

  /**
   * Mode 2: User specified — create named PUG slot, triggers DM flow (ROK-292).
   */
  private async handleNamedInvite(
    interaction: ChatInputCommandInteraction,
    eventId: number,
    event: { title: string },
    targetUser: import('discord.js').User,
    userId: number,
    isAdmin: boolean,
  ): Promise<void> {
    try {
      await this.pugsService.create(eventId, userId, isAdmin, {
        discordUsername: targetUser.username,
        role: 'dps',
      });

      await interaction.editReply(
        `Invite sent to <@${targetUser.id}> for **${event.title}**`,
      );

      this.logger.log(
        'Created named PUG invite: event %d for user %s (by %s)',
        eventId,
        targetUser.username,
        interaction.user.username,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to send invite';
      await interaction.editReply(msg);
    }
  }

  async handleAutocomplete(
    interaction: AutocompleteInteraction,
  ): Promise<void> {
    const query = interaction.options.getFocused();

    try {
      const [result, defaultTimezone] = await Promise.all([
        this.eventsService.findAll({
          page: 1,
          upcoming: 'true',
          limit: 25,
        }),
        this.settingsService.getDefaultTimezone(),
      ]);
      const timezone = defaultTimezone ?? 'UTC';

      const filtered = result.data
        .filter((event) =>
          event.title.toLowerCase().includes(query.toLowerCase()),
        )
        .slice(0, 25)
        .map((event) => {
          const date = new Date(event.startTime);
          const formatted = date.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            timeZone: timezone,
          });
          const time = date.toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
            timeZone: timezone,
          });
          const label = `${event.title} — ${formatted} at ${time}`;
          return {
            name: label.length > 100 ? label.slice(0, 97) + '...' : label,
            value: event.id,
          };
        });

      await interaction.respond(filtered);
    } catch {
      await interaction.respond([]);
    }
  }

  private async buildContext(): Promise<EmbedContext> {
    const [branding, timezone] = await Promise.all([
      this.settingsService.getBranding(),
      this.settingsService.getDefaultTimezone(),
    ]);
    return {
      communityName: branding.communityName,
      clientUrl: process.env.CLIENT_URL ?? null,
      timezone,
    };
  }
}
