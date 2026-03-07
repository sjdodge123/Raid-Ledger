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
    .addSubcommand(buildCreateSubcommand)
    .addSubcommand(buildPlanSubcommand)
    .toJSON();
}

function buildCreateSubcommand(
  sub: import('discord.js').SlashCommandSubcommandBuilder,
): import('discord.js').SlashCommandSubcommandBuilder {
  return addMmoRoleOptions(
    addCreateBaseOptions(
      sub
        .setName('create')
        .setDescription('Quick-create an event from Discord'),
    ),
  );
}

function addCreateRequiredOptions(
  sub: import('discord.js').SlashCommandSubcommandBuilder,
): import('discord.js').SlashCommandSubcommandBuilder {
  return sub
    .addStringOption((opt) =>
      opt.setName('title').setDescription('Event title').setRequired(true),
    )
    .addStringOption((opt) =>
      opt
        .setName('game')
        .setDescription('Game name')
        .setRequired(true)
        .setAutocomplete(true),
    )
    .addStringOption((opt) =>
      opt
        .setName('time')
        .setDescription(
          'When the event starts (e.g., "tonight 8pm", "Friday 7:30pm")',
        )
        .setRequired(true),
    );
}

function addCreateBaseOptions(
  sub: import('discord.js').SlashCommandSubcommandBuilder,
): import('discord.js').SlashCommandSubcommandBuilder {
  return addCreateRequiredOptions(sub)
    .addStringOption(buildRosterOption)
    .addIntegerOption((opt) =>
      opt
        .setName('slots')
        .setDescription(`Max attendees (default: ${DEFAULT_SLOTS})`)
        .setMinValue(1)
        .setMaxValue(100),
    );
}

function addMmoRoleOptions(
  sub: import('discord.js').SlashCommandSubcommandBuilder,
): import('discord.js').SlashCommandSubcommandBuilder {
  return sub
    .addIntegerOption((opt) =>
      opt
        .setName('tanks')
        .setDescription('Number of tank slots (MMO roster only)')
        .setMinValue(0)
        .setMaxValue(20),
    )
    .addIntegerOption((opt) =>
      opt
        .setName('healers')
        .setDescription('Number of healer slots (MMO roster only)')
        .setMinValue(0)
        .setMaxValue(20),
    )
    .addIntegerOption((opt) =>
      opt
        .setName('dps')
        .setDescription('Number of DPS slots (MMO roster only)')
        .setMinValue(0)
        .setMaxValue(50),
    );
}

function buildRosterOption(
  opt: import('discord.js').SlashCommandStringOption,
): import('discord.js').SlashCommandStringOption {
  return opt
    .setName('roster')
    .setDescription('Roster type (default: generic)')
    .addChoices(
      { name: 'Generic (headcount only)', value: 'generic' },
      { name: 'MMO Roles (Tank/Healer/DPS)', value: 'mmo' },
    );
}

function buildPlanSubcommand(
  sub: import('discord.js').SlashCommandSubcommandBuilder,
): import('discord.js').SlashCommandSubcommandBuilder {
  return sub
    .setName('plan')
    .setDescription(
      'Plan an event with a community poll to find the best time',
    );
}

/**
 * Build the slot config and max attendees from command options.
 */
interface SlotConfigResult {
  slotConfig?: {
    type: 'generic' | 'mmo';
    tank?: number;
    healer?: number;
    dps?: number;
  };
  maxAttendees: number;
}

export function buildSlotConfig(
  rosterType: string,
  slots: number,
  tanks: number | null,
  healers: number | null,
  dps: number | null,
): SlotConfigResult {
  if (rosterType !== 'mmo') return { maxAttendees: slots };
  return buildMmoSlotConfig(tanks, healers, dps);
}

function buildMmoSlotConfig(
  tanks: number | null,
  healers: number | null,
  dps: number | null,
): SlotConfigResult {
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
