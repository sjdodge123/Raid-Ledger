import { Injectable, Logger } from '@nestjs/common';
import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
} from 'discord.js';
import { DiscordBotClientService } from '../discord-bot-client.service';
import {
  DiscordEmbedFactory,
  type EmbedContext,
} from '../services/discord-embed.factory';
import { SettingsService } from '../../settings/settings.service';
import { EventsService } from '../../events/events.service';
import type { SlashCommandHandler } from './register-commands';
import type { CommandInteractionHandler } from '../listeners/interaction.listener';

@Injectable()
export class InviteCommand
  implements SlashCommandHandler, CommandInteractionHandler
{
  readonly commandName = 'invite';
  private readonly logger = new Logger(InviteCommand.name);

  constructor(
    private readonly clientService: DiscordBotClientService,
    private readonly embedFactory: DiscordEmbedFactory,
    private readonly settingsService: SettingsService,
    private readonly eventsService: EventsService,
  ) {}

  getDefinition(): RESTPostAPIChatInputApplicationCommandsJSONBody {
    return new SlashCommandBuilder()
      .setName('invite')
      .setDescription('Invite a Discord user to an event')
      .setDMPermission(false)
      .addIntegerOption((opt) =>
        opt.setName('event').setDescription('Event ID').setRequired(true),
      )
      .addUserOption((opt) =>
        opt.setName('user').setDescription('User to invite').setRequired(true),
      )
      .toJSON();
  }

  async handleInteraction(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    await interaction.deferReply({ ephemeral: true });

    const eventId = interaction.options.getInteger('event', true);
    const targetUser = interaction.options.getUser('user', true);

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

    // Build invite embed
    const context = await this.buildContext();
    const { embed, row } = this.embedFactory.buildEventInvite(
      {
        id: event.id,
        title: event.title,
        description: event.description,
        startTime: event.startTime,
        endTime: event.endTime,
        signupCount: event.signupCount,
        game: event.game,
      },
      context,
      interaction.user.username,
    );

    // Send DM to the target user
    try {
      await this.clientService.sendEmbedDM(targetUser.id, embed, row);
    } catch {
      await interaction.editReply(
        `Could not send DM to <@${targetUser.id}> — they may have DMs disabled`,
      );
      return;
    }

    await interaction.editReply(
      `Invite sent to <@${targetUser.id}> for **${event.title}**`,
    );

    this.logger.log(
      'Sent event invite DM: event %d to user %s (by %s)',
      eventId,
      targetUser.username,
      interaction.user.username,
    );
  }

  private async buildContext(): Promise<EmbedContext> {
    const branding = await this.settingsService.getBranding();
    return {
      communityName: branding.communityName,
      clientUrl: process.env.CLIENT_URL ?? null,
    };
  }
}
