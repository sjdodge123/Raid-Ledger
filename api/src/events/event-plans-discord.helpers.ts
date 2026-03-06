import { eq, inArray } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import { DiscordBotClientService } from '../discord-bot/discord-bot-client.service';
import type { PollAnswerResult } from './event-plans-poll.helpers';
import { buildPollEmbedBody } from './event-plans-poll.helpers';

export interface PostDiscordPollParams {
  channelId: string;
  planId: string;
  title: string;
  options: Array<{ date: string; label: string }>;
  durationHours: number;
  round: number;
  details?: {
    description?: string | null;
    gameName?: string | null;
    gameCoverUrl?: string | null;
    durationMinutes?: number;
    slotConfig?: Record<string, unknown> | null;
    pollMode?: string;
  };
}

/** Fetches a text channel from Discord or throws. */
async function fetchTextChannel(
  discordClient: DiscordBotClientService,
  channelId: string,
): Promise<import('discord.js').TextChannel> {
  const client = discordClient.getClient();
  if (!client?.isReady()) throw new Error('Discord bot is not connected');
  const channel = await client.channels.fetch(channelId);
  if (!channel || !('send' in channel)) {
    throw new Error(`Channel ${channelId} not found or not a text channel`);
  }
  return channel as import('discord.js').TextChannel;
}

/** Builds the poll embed for the initial message. */
async function buildPollEmbed(
  params: PostDiscordPollParams,
): Promise<import('discord.js').EmbedBuilder> {
  const { EmbedBuilder } = await import('discord.js');
  const embed = new EmbedBuilder()
    .setAuthor({ name: 'Raid Ledger' })
    .setTitle(`\u{1F4C5} ${params.title}`)
    .setColor(0x8b5cf6);
  const clientUrl = process.env.CLIENT_URL || process.env.CORS_ORIGIN;
  if (clientUrl && clientUrl !== 'auto')
    embed.setURL(`${clientUrl}/events?tab=plans`);
  const bodyLines = buildPollEmbedBody(
    params.options,
    params.details,
    params.durationHours,
  );
  embed.setDescription(bodyLines.join('\n'));
  if (params.details?.gameCoverUrl)
    embed.setThumbnail(params.details.gameCoverUrl);
  embed.setFooter({ text: 'Raid Ledger' }).setTimestamp();
  return embed;
}

/** Posts a Discord poll and returns the message ID. */
export async function postDiscordPoll(
  discordClient: DiscordBotClientService,
  params: PostDiscordPollParams,
): Promise<string> {
  const textChannel = await fetchTextChannel(discordClient, params.channelId);
  const embed = await buildPollEmbed(params);
  const content =
    params.round > 1
      ? `Not everyone was available \u2014 here are new time options! (Round ${params.round})`
      : undefined;
  await textChannel.send({ content, embeds: [embed] });
  const pollAnswers = [
    ...params.options.map((opt) => ({ text: opt.label })),
    { text: 'None of these work' },
  ];
  const message = await textChannel.send({
    poll: {
      question: { text: `When should we play "${params.title}"?` },
      answers: pollAnswers,
      duration: params.durationHours,
      allowMultiselect: true,
    },
  });
  return message.id;
}

/** Collects voter IDs per answer from a Discord poll message. */
async function collectVoters(
  poll: import('discord.js').Poll,
): Promise<Map<number, string[]>> {
  const answerVoters = new Map<number, string[]>();
  let idx = 0;
  for (const [, answer] of poll.answers) {
    const voters = await answer.voters.fetch();
    answerVoters.set(
      idx,
      voters.map((user) => user.id),
    );
    idx++;
  }
  return answerVoters;
}

/** Looks up which Discord IDs are registered Raid Ledger users. */
async function findRegisteredUserIds(
  db: PostgresJsDatabase<typeof schema>,
  discordIds: string[],
): Promise<Set<string>> {
  if (discordIds.length === 0) return new Set();
  const rows = await db
    .select({ discordId: schema.users.discordId })
    .from(schema.users)
    .where(inArray(schema.users.discordId, discordIds));
  return new Set(rows.map((r) => r.discordId).filter(Boolean) as string[]);
}

/** Fetches poll results from a Discord message. */
export async function fetchPollResults(
  db: PostgresJsDatabase<typeof schema>,
  discordClient: DiscordBotClientService,
  channelId: string,
  messageId: string,
): Promise<Map<number, PollAnswerResult>> {
  const textChannel = await fetchTextChannel(discordClient, channelId);
  const message = await textChannel.messages.fetch(messageId);
  if (!message.poll?.answers) return new Map();
  const answerVoters = await collectVoters(message.poll);
  const allIds = [...new Set([...answerVoters.values()].flat())];
  const registered = await findRegisteredUserIds(db, allIds);
  const results = new Map<number, PollAnswerResult>();
  for (const [idx, voterIds] of answerVoters.entries()) {
    const regIds = voterIds.filter((id) => registered.has(id));
    results.set(idx, {
      totalVotes: voterIds.length,
      registeredVotes: regIds.length,
      registeredVoterIds: regIds,
    });
  }
  return results;
}

/** Look up game name and cover URL for Discord embeds. */
export async function lookupGameInfo(
  db: PostgresJsDatabase<typeof schema>,
  gameId: number | null,
): Promise<{ gameName: string | null; gameCoverUrl: string | null }> {
  if (!gameId) return { gameName: null, gameCoverUrl: null };
  const [game] = await db
    .select({ name: schema.games.name, coverUrl: schema.games.coverUrl })
    .from(schema.games)
    .where(eq(schema.games.id, gameId))
    .limit(1);
  return { gameName: game?.name ?? null, gameCoverUrl: game?.coverUrl ?? null };
}

/** DM the organizer (best effort). */
export async function dmOrganizer(
  db: PostgresJsDatabase<typeof schema>,
  discordClient: DiscordBotClientService,
  userId: number,
  message: string,
): Promise<void> {
  const [user] = await db
    .select({ discordId: schema.users.discordId })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  if (user?.discordId) {
    await discordClient.sendDirectMessage(user.discordId, message);
  }
}
