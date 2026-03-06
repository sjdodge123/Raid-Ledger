import {
  SlashCommandBuilder,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
} from 'discord.js';

const DEFAULT_SLOTS = 20;

/**
 * Build the /event slash command definition with create and plan subcommands.
 */
export function buildEventCommandDefinition(): RESTPostAPIChatInputApplicationCommandsJSONBody {
  return new SlashCommandBuilder()
    .setName('event')
    .setDescription('Event management commands')
    .setDMPermission(true)
    .addSubcommand((sub) =>
      sub
        .setName('create')
        .setDescription('Quick-create an event from Discord')
        .addStringOption((opt) =>
          opt.setName('title').setDescription('Event title').setRequired(true),
        )
        .addStringOption((opt) =>
          opt.setName('game').setDescription('Game name').setRequired(true).setAutocomplete(true),
        )
        .addStringOption((opt) =>
          opt.setName('time').setDescription('When the event starts (e.g., "tonight 8pm", "Friday 7:30pm")').setRequired(true),
        )
        .addStringOption((opt) =>
          opt.setName('roster').setDescription('Roster type (default: generic)').addChoices(
            { name: 'Generic (headcount only)', value: 'generic' },
            { name: 'MMO Roles (Tank/Healer/DPS)', value: 'mmo' },
          ),
        )
        .addIntegerOption((opt) =>
          opt.setName('slots').setDescription(`Max attendees (default: ${DEFAULT_SLOTS})`).setMinValue(1).setMaxValue(100),
        )
        .addIntegerOption((opt) =>
          opt.setName('tanks').setDescription('Number of tank slots (MMO roster only)').setMinValue(0).setMaxValue(20),
        )
        .addIntegerOption((opt) =>
          opt.setName('healers').setDescription('Number of healer slots (MMO roster only)').setMinValue(0).setMaxValue(20),
        )
        .addIntegerOption((opt) =>
          opt.setName('dps').setDescription('Number of DPS slots (MMO roster only)').setMinValue(0).setMaxValue(50),
        ),
    )
    .addSubcommand((sub) =>
      sub.setName('plan').setDescription('Plan an event with a community poll to find the best time'),
    )
    .toJSON();
}

/**
 * Build the slot config and max attendees from command options.
 */
export function buildSlotConfig(
  rosterType: string,
  slots: number,
  tanks: number | null,
  healers: number | null,
  dps: number | null,
): {
  slotConfig?: { type: 'generic' | 'mmo'; tank?: number; healer?: number; dps?: number };
  maxAttendees: number;
} {
  if (rosterType !== 'mmo') {
    return { maxAttendees: slots };
  }

  const tankSlots = tanks ?? 1;
  const healerSlots = healers ?? 1;
  const dpsSlots = dps ?? 3;

  return {
    slotConfig: {
      type: 'mmo',
      tank: tankSlots,
      healer: healerSlots,
      dps: dpsSlots,
    },
    maxAttendees: tankSlots + healerSlots + dpsSlots,
  };
}
