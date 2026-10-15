/**
 * ROK-1740 D4: the channel-permission preflight for the join post.
 *
 * Pure flag → name mapping, so the admin page can list exactly which
 * permissions are missing (AC4) before anything is sent.
 */
import { PermissionFlagsBits, type PermissionsBitField } from 'discord.js';
import type { JoinPostPermissionName } from '@raid-ledger/contract';

/** Every permission the post needs, in the order the admin page lists them. */
const REQUIRED: ReadonlyArray<{
  name: JoinPostPermissionName;
  flag: bigint;
}> = [
  { name: 'View Channel', flag: PermissionFlagsBits.ViewChannel },
  { name: 'Send Messages', flag: PermissionFlagsBits.SendMessages },
  { name: 'Embed Links', flag: PermissionFlagsBits.EmbedLinks },
  { name: 'Read Message History', flag: PermissionFlagsBits.ReadMessageHistory },
  { name: 'Manage Messages', flag: PermissionFlagsBits.ManageMessages },
];

/**
 * Which required permissions the bot lacks in a channel.
 *
 * @param perms - The bot's resolved permissions there; null when unknown.
 * @returns Missing permission names; empty when the bot can post and pin.
 */
export function missingJoinPostPermissions(
  perms: Readonly<PermissionsBitField> | null,
): JoinPostPermissionName[] {
  return REQUIRED.filter(({ flag }) => !perms?.has(flag, true)).map(
    ({ name }) => name,
  );
}
