import { ChannelType, type ChatInputCommandInteraction } from 'discord.js';
import { ilike, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schemaType from '../../drizzle/schema';
import * as schema from '../../drizzle/schema';
import type { ChannelType as BindingChannelType } from '@raid-ledger/contract';

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
  if (opt) {
    return opt.type === ChannelType.GuildVoice ? 'voice' : 'text';
  }
  if (interaction.channel) {
    return interaction.channel.type === ChannelType.GuildVoice
      ? 'voice'
      : 'text';
  }
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
    .where(ilike(schema.games.name, gameName))
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

/** Check if the interaction user has permission to modify an event. */
export async function checkEventPermission(
  db: PostgresJsDatabase<typeof schemaType>,
  interaction: ChatInputCommandInteraction,
  creatorId: number,
): Promise<boolean> {
  const [user] = await db
    .select({ id: schema.users.id, role: schema.users.role })
    .from(schema.users)
    .where(eq(schema.users.discordId, interaction.user.id))
    .limit(1);
  if (!user) {
    await interaction.editReply('You need a linked Raid Ledger account.');
    return false;
  }
  const isAdmin = user.role === 'admin' || user.role === 'operator';
  if (creatorId !== user.id && !isAdmin) {
    await interaction.editReply(
      'You can only modify events you created, or you need operator/admin permissions.',
    );
    return false;
  }
  return true;
}
