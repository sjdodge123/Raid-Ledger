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
  { label: 'Kick Members', flag: PermissionsBitField.Flags.KickMembers },
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
  // ROK-1471: a forum post IS a thread, so the LFG board needs the thread
  // trio on top of Manage Channels (which already covers forum tag editing).
  { label: 'Manage Threads', flag: PermissionsBitField.Flags.ManageThreads },
  {
    label: 'Create Public Threads',
    flag: PermissionsBitField.Flags.CreatePublicThreads,
  },
  {
    label: 'Send Messages in Threads',
    flag: PermissionsBitField.Flags.SendMessagesInThreads,
  },
];

/**
 * The OR of every required permission flag, as Discord's `permissions` integer.
 *
 * Derived, never literal: appending to {@link REQUIRED_PERMISSIONS} is the ONLY
 * edit needed to change the invite URL (ROK-1471 AC11).
 *
 * @param perms - Permission descriptors to combine; defaults to the required set.
 * @returns The combined permission bitfield.
 */
export function botInvitePermissionsBits(
  perms: { label: string; flag: bigint }[] = REQUIRED_PERMISSIONS,
): bigint {
  return perms.reduce((acc, p) => acc | p.flag, 0n);
}

/**
 * Build the OAuth2 install URL that grants the bot exactly what it needs.
 *
 * @param clientId - The bot application's client id.
 * @param perms - Permission descriptors to request; defaults to the required set.
 * @returns The `discord.com/oauth2/authorize` URL, permissions derived.
 */
export function buildBotInviteUrl(
  clientId: string,
  perms: { label: string; flag: bigint }[] = REQUIRED_PERMISSIONS,
): string {
  const bits = botInvitePermissionsBits(perms).toString();
  return (
    `https://discord.com/oauth2/authorize?client_id=${clientId}` +
    `&scope=bot%20applications.commands&permissions=${bits}`
  );
}

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
