/**
 * Discord embed builders for Community Lineup notifications (ROK-932).
 * All embeds include: community author, View Lineup button, footer, and
 * Discord-native timestamps for deadlines.
 */
import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';
import { EMBED_COLORS } from '../discord-bot/discord-bot.constants';

/** Shared context for embed building — resolved once by the service. */
export interface EmbedContext {
  baseUrl: string;
  lineupId: number;
  communityName: string;
}

/** Nomination entry for milestone embeds. */
export interface NominationEntry {
  gameId: number;
  gameName: string;
  nominatorName: string;
  coverUrl: string | null;
}

/** Shape of a match for embed building. */
export interface MatchSummary {
  id: number;
  gameName: string;
  thresholdMet: boolean;
  voteCount: number;
  status: string;
}

/** Result containing embed + action row. */
export interface EmbedWithRow {
  embed: EmbedBuilder;
  row: ActionRowBuilder<ButtonBuilder>;
}

/** Convert a Date to Discord relative timestamp: `<t:UNIX:R>`. */
function discordTs(date: Date, style: 'R' | 'f' | 'F' = 'R'): string {
  return `<t:${Math.floor(date.getTime() / 1000)}:${style}>`;
}

/** Build the "View Lineup" link button. */
function viewButton(ctx: EmbedContext): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setLabel('View Lineup')
      .setStyle(ButtonStyle.Link)
      .setURL(`${ctx.baseUrl}/community-lineup/${ctx.lineupId}`),
  );
}

/** Apply shared author + footer to an embed. */
function applyChrome(embed: EmbedBuilder, ctx: EmbedContext, label: string) {
  embed
    .setAuthor({ name: ctx.communityName || 'Raid Ledger' })
    .setFooter({ text: `${ctx.communityName || 'Raid Ledger'} \u00B7 ${label}` })
    .setTimestamp();
}

// ─── Channel Embeds ──────────────────────────────────────────

/** Lineup created — building phase begins (AC-1). */
export function buildCreatedEmbed(
  ctx: EmbedContext,
  targetDate?: Date,
): EmbedWithRow {
  const dateField = targetDate
    ? `\n\n\u{1F4C5} **Target date:** ${discordTs(targetDate, 'f')}`
    : '';

  const embed = new EmbedBuilder()
    .setTitle('\u{1F3B2} Community Lineup is open!')
    .setDescription(
      'A new Community Lineup has started! Nominate the games you want '
      + 'to play — the community will vote on the best picks.'
      + dateField,
    )
    .setColor(EMBED_COLORS.ANNOUNCEMENT);

  applyChrome(embed, ctx, 'Nominations Open');
  return { embed, row: viewButton(ctx) };
}

/** Nomination milestone reached (AC-2). */
export function buildMilestoneEmbed(
  ctx: EmbedContext,
  threshold: number,
  entries: NominationEntry[],
): EmbedWithRow {
  const lines = entries
    .slice(0, 15)
    .map((e) => {
      const link = `${ctx.baseUrl}/game-library/${e.gameId}`;
      return `\u{1F3AE} [**${e.gameName}**](${link}) — nominated by ${e.nominatorName}`;
    });
  const overflow = entries.length > 15 ? `\n*...and ${entries.length - 15} more*` : '';
  const cover = entries.find((e) => e.coverUrl)?.coverUrl;

  const embed = new EmbedBuilder()
    .setTitle(`\u{1F389} ${threshold}% of nominations filled!`)
    .setDescription(
      `The lineup now has **${entries.length}** games nominated. `
      + 'Keep adding games before voting opens!',
    )
    .addFields({ name: 'Nominated Games', value: lines.join('\n') + overflow || 'None' })
    .setColor(EMBED_COLORS.ANNOUNCEMENT);

  if (cover) embed.setThumbnail(cover);
  applyChrome(embed, ctx, 'Nomination Milestone');
  return { embed, row: viewButton(ctx) };
}

/** Voting opened (AC-3). */
export function buildVotingOpenEmbed(
  ctx: EmbedContext,
  gameCount: number,
  deadline?: Date,
): EmbedWithRow {
  const deadlineStr = deadline
    ? `\n\n\u23F0 **Voting closes:** ${discordTs(deadline, 'f')} (${discordTs(deadline)})`
    : '';

  const embed = new EmbedBuilder()
    .setTitle('\u{1F5F3}\u{FE0F} Vote on the Community Lineup!')
    .setDescription(
      `**${gameCount}** games are on the lineup — vote for your favorites! `
      + 'The top picks will be matched into groups for scheduling.'
      + deadlineStr,
    )
    .setColor(EMBED_COLORS.ANNOUNCEMENT);

  applyChrome(embed, ctx, 'Voting Open');
  return { embed, row: viewButton(ctx) };
}

/** Matches found — decided phase (AC-5). */
export function buildDecidedEmbed(
  ctx: EmbedContext,
  matches: MatchSummary[],
): EmbedWithRow {
  const scheduling = matches.filter((m) => m.thresholdMet);
  const rally = matches.filter((m) => !m.thresholdMet);

  const embed = new EmbedBuilder()
    .setTitle('\u{1F3AF} Community Lineup — Matches Found!')
    .setDescription(
      'Voting is complete! Games have been grouped into matches '
      + 'based on votes. Schedule a time to play!',
    )
    .setColor(EMBED_COLORS.SIGNUP_CONFIRMATION);

  if (scheduling.length > 0) {
    const lines = scheduling.map(
      (m) => `\u{1F3AE} **${m.gameName}** — ${m.voteCount} votes`,
    );
    embed.addFields({ name: '\u2705 Ready to Schedule', value: lines.join('\n') });
  }
  if (rally.length > 0) {
    const lines = rally.map(
      (m) => `\u{1F4E3} **${m.gameName}** — ${m.voteCount} votes`,
    );
    embed.addFields({ name: '\u{1F91D} Almost There — Rally More Players', value: lines.join('\n') });
  }

  applyChrome(embed, ctx, 'Matches Decided');
  return { embed, row: viewButton(ctx) };
}

/** Scheduling opened for a match (AC-8). */
export function buildSchedulingEmbed(
  ctx: EmbedContext,
  gameName: string,
  matchId: number,
): EmbedWithRow {
  const pollUrl = `${ctx.baseUrl}/community-lineup/${ctx.lineupId}/schedule/${matchId}`;

  const embed = new EmbedBuilder()
    .setTitle(`\u{1F4C5} ${gameName} — Scheduling Open!`)
    .setDescription(
      `The **${gameName}** match is ready to schedule! `
      + 'Suggest times or vote on existing slots to lock in a date.',
    )
    .setColor(EMBED_COLORS.ANNOUNCEMENT);

  applyChrome(embed, ctx, 'Scheduling');
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setLabel('Vote on a Time')
      .setStyle(ButtonStyle.Link)
      .setURL(pollUrl),
  );
  return { embed, row };
}

/** Event created from a scheduled match (AC-10). */
export function buildEventCreatedEmbed(
  ctx: EmbedContext,
  gameName: string,
  eventDate: Date,
): EmbedWithRow {
  const embed = new EmbedBuilder()
    .setTitle(`\u2705 ${gameName} is locked in!`)
    .setDescription(
      `**${gameName}** is happening ${discordTs(eventDate, 'f')} `
      + `(${discordTs(eventDate)}). Sign up now!`,
    )
    .setColor(EMBED_COLORS.SIGNUP_CONFIRMATION);

  applyChrome(embed, ctx, 'Event Created');
  return { embed, row: viewButton(ctx) };
}

/** Stub for future tiebreaker notification (M8). */
export function buildTiebreakerStartedEmbed(
  ctx: EmbedContext,
): EmbedWithRow {
  const embed = new EmbedBuilder()
    .setTitle('\u2694\u{FE0F} Tiebreaker Round Started')
    .setDescription(
      'It\'s a tie! An operator has started a tiebreaker round '
      + 'to determine the final picks.',
    )
    .setColor(EMBED_COLORS.ANNOUNCEMENT);

  applyChrome(embed, ctx, 'Tiebreaker');
  return { embed, row: viewButton(ctx) };
}
