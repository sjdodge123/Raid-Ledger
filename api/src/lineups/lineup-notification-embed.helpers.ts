/**
 * Discord embed builders for Community Lineup notifications (ROK-932).
 * Builds EmbedBuilder objects for each notification type.
 */
import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';
import { EMBED_COLORS } from '../discord-bot/discord-bot.constants';

/** Shape of a match for embed building. */
interface MatchSummary {
  id: number;
  gameName: string;
  thresholdMet: boolean;
  voteCount: number;
  status: string;
}

/** Shape of a lineup for the created embed. */
interface LineupInfo {
  id: number;
  targetDate?: Date;
}

/** Result containing both embed and optional action row. */
export interface EmbedWithRow {
  embed: EmbedBuilder;
  row: ActionRowBuilder<ButtonBuilder>;
}

/** Build embed + action row for lineup creation (AC-1). */
export function buildCreatedEmbed(lineup: LineupInfo): EmbedWithRow {
  const dateStr = lineup.targetDate
    ? lineup.targetDate.toLocaleDateString()
    : 'TBD';

  const embed = new EmbedBuilder()
    .setTitle('Community Lineup is open!')
    .setDescription(`Nominate a game for ${dateStr}!`)
    .setColor(EMBED_COLORS.ANNOUNCEMENT)
    .setTimestamp();

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setLabel('View Lineup')
      .setStyle(ButtonStyle.Link)
      .setURL('https://placeholder/community-lineup'),
  );

  return { embed, row };
}

/** Build embed for nomination milestone (AC-2). */
export function buildMilestoneEmbed(
  threshold: number,
  gameNames: string[],
): EmbedBuilder {
  const count = gameNames.length;
  const list = gameNames.slice(0, 10).join(', ');

  return new EmbedBuilder()
    .setTitle(`${threshold}% of nominations filled!`)
    .setDescription(`${count} games on the lineup: ${list}`)
    .setColor(EMBED_COLORS.ANNOUNCEMENT)
    .setTimestamp();
}

/** Build embed for voting opened (AC-3). */
export function buildVotingOpenEmbed(
  gameCount: number,
  deadline?: Date,
): EmbedBuilder {
  const deadlineStr = deadline
    ? ` -- closes ${deadline.toLocaleDateString()}`
    : '';

  return new EmbedBuilder()
    .setTitle('Vote on the Community Lineup!')
    .setDescription(`${gameCount} games to vote on${deadlineStr}`)
    .setColor(EMBED_COLORS.ANNOUNCEMENT)
    .setTimestamp();
}

/** Build combined decided-phase embed with tier summary (AC-5). */
export function buildDecidedEmbed(matches: MatchSummary[]): EmbedBuilder {
  const scheduling = matches.filter((m) => m.thresholdMet);
  const almostThere = matches.filter((m) => !m.thresholdMet);

  const embed = new EmbedBuilder()
    .setTitle('Community Lineup -- Matches Found!')
    .setColor(EMBED_COLORS.ANNOUNCEMENT)
    .setTimestamp();

  if (scheduling.length > 0) {
    const names = scheduling.map((m) => m.gameName).join(', ');
    embed.addFields({
      name: 'Scheduling',
      value: names,
      inline: false,
    });
  }

  if (almostThere.length > 0) {
    const names = almostThere.map((m) => m.gameName).join(', ');
    embed.addFields({
      name: 'Almost There',
      value: names,
      inline: false,
    });
  }

  return embed;
}

/** Build embed for scheduling opened (AC-8). */
export function buildSchedulingEmbed(gameName: string): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle(`${gameName} match is scheduling!`)
    .setDescription('Vote on a time!')
    .setColor(EMBED_COLORS.ANNOUNCEMENT)
    .setTimestamp();
}

/** Build embed for event created from match (AC-10). */
export function buildEventCreatedEmbed(
  gameName: string,
  eventDate: Date,
): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle(`${gameName} is locked in!`)
    .setDescription(`Happening ${eventDate.toLocaleDateString()}. Sign up now!`)
    .setColor(EMBED_COLORS.SIGNUP_CONFIRMATION)
    .setTimestamp();
}

/** Stub for future tiebreaker notification (M8). Not called until tiebreaker feature ships. */
export function buildTiebreakerStartedEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle('Tiebreaker Round Started')
    .setDescription('A tiebreaker round has been started by an operator.')
    .setColor(EMBED_COLORS.ANNOUNCEMENT)
    .setTimestamp();
}
