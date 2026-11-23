import { ChannelType, type ChatInputCommandInteraction } from 'discord.js';
import { ilike, eq } from 'drizzle-orm';
import { escapeLikePattern } from '../../common/search.util';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schemaType from '../../drizzle/schema';
import * as schema from '../../drizzle/schema';
import type { ChannelType as BindingChannelType } from '@raid-ledger/contract';
import {
  isKickExpired,
  kickCooldownMessage,
  suspendedMessage,
} from '../../auth/auth-status.helpers';

/** Resolved channel info from a command interaction. */
export interface ResolvedChannel {
  channelId: string | null;
  channelName: string;
  bindingChannelType: BindingChannelType;
}

/** Resolve the target channel from command options. */
export function resolveChannel(
  interaction: ChatInputCommandInteraction,
): ResolvedChannel {
  const opt = interaction.options.getChannel('channel');
  const target = opt ?? interaction.channel;
  if (!target)
    return { channelId: null, channelName: '', bindingChannelType: 'text' };
  const type = resolveChannelType(opt, interaction);
  return {
    channelId: target.id,
    channelName: 'name' in target ? (target.name ?? target.id) : target.id,
    bindingChannelType: type,
  };
}

/** Determine the channel type from option or interaction channel. */
function resolveChannelType(
  opt: ReturnType<ChatInputCommandInteraction['options']['getChannel']>,
  interaction: ChatInputCommandInteraction,
): BindingChannelType {
  if (opt) return discordTypeToBindingType(opt.type);
  if (interaction.channel)
    return discordTypeToBindingType(interaction.channel.type);
  return 'text';
}

/**
 * Map a Discord channel type onto the binding channel type.
 *
 * ROK-1471: a forum maps to `'forum'` (the LFG board), NOT to `'text'` —
 * defaulting a forum to text would let it be bound to a purpose that cannot
 * post there.
 *
 * @param type - The Discord.js channel type.
 * @returns The contract channel type used by channel bindings.
 */
function discordTypeToBindingType(type: ChannelType): BindingChannelType {
  if (type === ChannelType.GuildVoice) return 'voice';
  if (type === ChannelType.GuildForum) return 'forum';
  return 'text';
}

/** Resolve a game from the game option. Returns false if game not found. */
export async function resolveGame(
  db: PostgresJsDatabase<typeof schemaType>,
  interaction: ChatInputCommandInteraction,
): Promise<{ id: number; name: string } | null | false> {
  const gameName = interaction.options.getString('game');
  if (!gameName) return null;
  const [match] = await db
    .select({ id: schema.games.id, name: schema.games.name })
    .from(schema.games)
    .where(ilike(schema.games.name, escapeLikePattern(gameName)))
    .limit(1);
  if (!match) {
    await interaction.editReply(`Game "${gameName}" not found.`);
    return false;
  }
  return match;
}

/** Resolve a series from the series option. Returns false if not found. */
export async function resolveSeries(
  db: PostgresJsDatabase<typeof schemaType>,
  interaction: ChatInputCommandInteraction,
): Promise<{ id: string; title: string } | null | false> {
  const value = interaction.options.getString('series');
  if (!value) return null;
  const [match] = await db
    .select({
      recurrenceGroupId: schema.events.recurrenceGroupId,
      title: schema.events.title,
    })
    .from(schema.events)
    .where(eq(schema.events.recurrenceGroupId, value))
    .limit(1);
  if (!match?.recurrenceGroupId) {
    await interaction.editReply('Event series not found.');
    return false;
  }
  return { id: match.recurrenceGroupId, title: match.title };
}

/** Look up an event by ID for the bind command. */
export async function lookupEvent(
  db: PostgresJsDatabase<typeof schemaType>,
  eventId: number,
): Promise<{
  id: number;
  title: string;
  creatorId: number;
  gameId: number | null;
} | null> {
  const [event] = await db
    .select({
      id: schema.events.id,
      title: schema.events.title,
      creatorId: schema.events.creatorId,
      gameId: schema.events.gameId,
    })
    .from(schema.events)
    .where(eq(schema.events.id, eventId))
    .limit(1);
  return event ?? null;
}

/** The acting caller's role and account state, looked up by Discord id. */
interface ActingUser {
  id: number;
  role: string;
  bannedAt?: Date | null;
  banReason?: string | null;
  kickedAt?: Date | null;
  deactivatedAt?: Date | null;
}

/** Copy for a deactivated caller (matches the `/login` refusal). */
export const BIND_DEACTIVATED_REPLY =
  'Your account is inactive — rejoin the Discord server, then try again.';

/** Look up the caller's linked user row (role + account state). */
async function findActingUser(
  db: PostgresJsDatabase<typeof schemaType>,
  discordId: string,
): Promise<ActingUser | undefined> {
  const [user] = await db
    .select({
      id: schema.users.id,
      role: schema.users.role,
      bannedAt: schema.users.bannedAt,
      banReason: schema.users.banReason,
      kickedAt: schema.users.kickedAt,
      deactivatedAt: schema.users.deactivatedAt,
    })
    .from(schema.users)
    .where(eq(schema.users.discordId, discordId))
    .limit(1);
  return user;
}

/**
 * The refusal copy for a banned, kick-cooldown or deactivated caller, or null
 * when the account may act. Same order as `/login` (ban → kick → deactivated);
 * truthiness, so a row without the state fields counts as active. An expired
 * kick passes — Discord never auto-clears it (the next web login does).
 */
export function inactiveAccountReply(user: ActingUser): string | null {
  if (user.bannedAt) return suspendedMessage(user.banReason ?? null);
  if (user.kickedAt && !isKickExpired(user.kickedAt)) {
    return kickCooldownMessage(user.kickedAt);
  }
  if (user.deactivatedAt) return BIND_DEACTIVATED_REPLY;
  return null;
}

/**
 * Resolve the caller and refuse an unlinked or inactive account — before any
 * role test, so a banned admin is refused too. Returns the user when allowed.
 */
async function resolveActiveCaller(
  db: PostgresJsDatabase<typeof schemaType>,
  interaction: ChatInputCommandInteraction,
): Promise<ActingUser | null> {
  const user = await findActingUser(db, interaction.user.id);
  if (!user) {
    await interaction.editReply('You need a linked Raid Ledger account.');
    return null;
  }
  const refusal = inactiveAccountReply(user);
  if (refusal) {
    await interaction.editReply(refusal);
    return null;
  }
  return user;
}

/**
 * Check if the interaction user may change this guild's channel bindings.
 *
 * ROK-1628: a channel binding is guild-wide notification routing, so the
 * channel paths of `/bind` and `/unbind` take the same operator/admin check
 * the event paths take. The web equivalent sits behind the admin guard.
 * A banned, kick-cooldown or deactivated caller is refused first.
 *
 * @param db - Drizzle database handle.
 * @param interaction - The already-deferred command interaction.
 * @returns True when the caller may proceed; false after an ephemeral refusal.
 */
export async function checkBindingPermission(
  db: PostgresJsDatabase<typeof schemaType>,
  interaction: ChatInputCommandInteraction,
): Promise<boolean> {
  const user = await resolveActiveCaller(db, interaction);
  if (!user) return false;
  if (user.role !== 'admin' && user.role !== 'operator') {
    await interaction.editReply(
      'Changing channel bindings needs operator/admin permissions.',
    );
    return false;
  }
  return true;
}

/**
 * Check if the interaction user has permission to modify an event: the
 * creator or an operator/admin, and not banned, kick-cooling-down or
 * deactivated.
 */
export async function checkEventPermission(
  db: PostgresJsDatabase<typeof schemaType>,
  interaction: ChatInputCommandInteraction,
  creatorId: number,
): Promise<boolean> {
  const user = await resolveActiveCaller(db, interaction);
  if (!user) return false;
  const isAdmin = user.role === 'admin' || user.role === 'operator';
  if (creatorId !== user.id && !isAdmin) {
    await interaction.editReply(
      'You can only modify events you created, or you need operator/admin permissions.',
    );
    return false;
  }
  return true;
}
