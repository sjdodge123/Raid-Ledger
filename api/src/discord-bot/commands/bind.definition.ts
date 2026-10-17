import { BINDING_PURPOSE_LABELS } from '@raid-ledger/contract';
import {
  SlashCommandBuilder,
  type SlashCommandStringOption,
  ChannelType,
  PermissionFlagsBits,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
} from 'discord.js';

/**
 * Build the `/bind` slash-command definition.
 *
 * ROK-1628: the default member permission hides the command from ordinary
 * members. A server admin can override that per guild, so the handler's
 * operator/admin check is the gate — this only keeps it out of the way.
 *
 * @returns The REST payload registered with Discord.
 */
export function buildBindDefinition(): RESTPostAPIChatInputApplicationCommandsJSONBody {
  return new SlashCommandBuilder()
    .setName('bind')
    .setDescription('Bind a Discord channel to a game, event series, or event')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
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
    .addStringOption(addPurposeOption)
    .toJSON();
}

/** ROK-1768: text purposes only; voice purposes stay detected. */
function addPurposeOption(
  opt: SlashCommandStringOption,
): SlashCommandStringOption {
  return opt
    .setName('purpose')
    .setDescription('Text-channel purpose (voice purposes are detected)')
    .addChoices(
      {
        name: BINDING_PURPOSE_LABELS['game-announcements'],
        value: 'game-announcements',
      },
      {
        name: BINDING_PURPOSE_LABELS['quick-play-announcements'],
        value: 'quick-play-announcements',
      },
    );
}
