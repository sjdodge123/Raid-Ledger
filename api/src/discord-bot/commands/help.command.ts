import { Injectable } from '@nestjs/common';
import {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ChatInputCommandInteraction,
  MessageFlags,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
} from 'discord.js';
import { createChannelEmbed } from '../embeds/embed-chrome.helpers';
import { COMMAND_REPLY_AUTHORS } from './command-reply-chrome.helpers';
import type { SlashCommandHandler } from './register-commands';
import type { CommandInteractionHandler } from '../listeners/interaction.listener';

/** Each entry in the help listing. Add new commands here. */
const COMMANDS: { name: string; description: string }[] = [
  {
    name: '/event create',
    description: 'Quick-create an event from Discord',
  },
  {
    name: '/event plan',
    description: 'Start an interactive event-planning wizard',
  },
  { name: '/events', description: 'List upcoming events' },
  { name: '/roster', description: 'View the roster for an event' },
  { name: '/invite', description: 'Invite a user or generate an invite link' },
  {
    name: '/bind',
    description:
      'Bind a channel to a game for announcements or voice monitoring',
  },
  { name: '/unbind', description: 'Remove a channel binding' },
  { name: '/bindings', description: 'List all active channel bindings' },
  {
    name: '/playing',
    description: 'Set your current game for general lobby channels',
  },
  {
    name: '/lfg',
    description:
      'Raise a hand for a game, or list the groups you are already in',
  },
  { name: '/help', description: 'Show this help message' },
];

@Injectable()
export class HelpCommand
  implements SlashCommandHandler, CommandInteractionHandler
{
  readonly commandName = 'help';

  getDefinition(): RESTPostAPIChatInputApplicationCommandsJSONBody {
    return new SlashCommandBuilder()
      .setName('help')
      .setDescription('List all available bot commands')
      .toJSON();
  }

  async handleInteraction(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    const lines = COMMANDS.map((cmd) => `**${cmd.name}** — ${cmd.description}`);

    const embed = createChannelEmbed({
      state: 'done',
      authorLine: COMMAND_REPLY_AUTHORS.HELP,
    })
      .setTitle('Raid-Ledger Bot Commands')
      .setDescription(lines.join('\n'));

    const components: ActionRowBuilder<ButtonBuilder>[] = [];
    const clientUrl = process.env.CLIENT_URL ?? null;
    if (clientUrl) {
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setLabel('Open Admin Panel')
          .setStyle(ButtonStyle.Link)
          .setURL(`${clientUrl}/admin`),
      );
      components.push(row);
    }

    await interaction.reply({
      embeds: [embed],
      components,
      flags: MessageFlags.Ephemeral,
    });
  }
}
