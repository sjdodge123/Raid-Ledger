import { Injectable } from '@nestjs/common';
import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ChatInputCommandInteraction,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
} from 'discord.js';
import { EMBED_COLORS } from '../discord-bot.constants';
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

    const embed = new EmbedBuilder()
      .setColor(EMBED_COLORS.SYSTEM)
      .setTitle('Raid-Ledger Bot Commands')
      .setDescription(lines.join('\n'))
      .setFooter({ text: 'Raid Ledger' })
      .setTimestamp();

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
      ephemeral: true,
    });
  }
}
