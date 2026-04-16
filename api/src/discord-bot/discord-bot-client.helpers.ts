import {
  Client,
  GatewayIntentBits,
  Partials,
  PermissionsBitField,
  type Guild,
} from 'discord.js';

export interface GuildInfo {
  name: string;
  memberCount: number;
}

export interface PermissionCheckResult {
  name: string;
  granted: boolean;
}

/** The permissions the bot needs to function properly. */
export const REQUIRED_PERMISSIONS: { label: string; flag: bigint }[] = [
  { label: 'Manage Roles', flag: PermissionsBitField.Flags.ManageRoles },
  { label: 'Manage Channels', flag: PermissionsBitField.Flags.ManageChannels },
  {
    label: 'Create Instant Invite',
    flag: PermissionsBitField.Flags.CreateInstantInvite,
  },
  { label: 'View Channels', flag: PermissionsBitField.Flags.ViewChannel },
  { label: 'Send Messages', flag: PermissionsBitField.Flags.SendMessages },
  { label: 'Embed Links', flag: PermissionsBitField.Flags.EmbedLinks },
  {
    label: 'Read Message History',
    flag: PermissionsBitField.Flags.ReadMessageHistory,
  },
  { label: 'Send Polls', flag: PermissionsBitField.Flags.SendPolls },
  {
    label: 'Manage Guild Expressions',
    flag: PermissionsBitField.Flags.ManageGuildExpressions,
  },
  {
    label: 'Create Guild Expressions',
    flag: PermissionsBitField.Flags.CreateGuildExpressions,
  },
  { label: 'Manage Events', flag: PermissionsBitField.Flags.ManageEvents },
  { label: 'Create Events', flag: PermissionsBitField.Flags.CreateEvents },
  { label: 'Connect', flag: PermissionsBitField.Flags.Connect },
];

/** Check bot permissions in the guild. */
export function checkBotPermissions(
  guild: Guild | null,
): PermissionCheckResult[] {
  const me = guild?.members.me;
  return REQUIRED_PERMISSIONS.map((p) => ({
    name: p.label,
    granted: me ? me.permissions.has(p.flag) : false,
  }));
}

/** Create a fresh Discord.js Client with all required intents. */
export function createDiscordClient(): Client {
  return new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildVoiceStates,
      GatewayIntentBits.GuildPresences,
      GatewayIntentBits.GuildScheduledEvents,
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Channel],
  });
}
