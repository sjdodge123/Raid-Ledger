/**
 * Discord embed builders for Community Lineup notifications (ROK-932).
 * All embeds include: community author, phase-specific call-to-action
 * button, footer, and Discord-native timestamps for deadlines.
 */
import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';
import { EMBED_COLORS } from '../discord-bot/discord-bot.constants';

/** Lineup phase for breadcrumb rendering. */
export type LineupPhase = 'nominations' | 'voting' | 'decided';

/** Shared context for embed building — resolved once by the service. */
export interface EmbedContext {
  baseUrl: string;
  lineupId: number;
  communityName: string;
  phase: LineupPhase;
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
  gameId: number;
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

/** Build a link button pointing at the lineup page with a custom label. */
function ctaButton(
  ctx: EmbedContext,
  label: string,
): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setLabel(label)
      .setStyle(ButtonStyle.Link)
      .setURL(`${ctx.baseUrl}/community-lineup/${ctx.lineupId}`),
  );
}

const PHASE_LABELS: [LineupPhase, string][] = [
  ['nominations', 'Nominations'],
  ['voting', 'Voting'],
  ['decided', 'Scheduling'],
];

/** Build a breadcrumb with completed phases struck through. */
function phaseBreadcrumb(current: LineupPhase): string {
  const idx = PHASE_LABELS.findIndex(([k]) => k === current);
  return PHASE_LABELS.map(([key, name], i) => {
    if (i < idx) return `\u2705 ${name}`;
    if (key === current) return `\u{1F539} **${name}**`;
    return `\u2796 ${name}`;
  }).join('  \u203A  ');
}

/** Apply shared author + phase breadcrumb + footer to an embed. */
function applyChrome(embed: EmbedBuilder, ctx: EmbedContext, label: string) {
  embed
    .setAuthor({ name: ctx.communityName || 'Raid Ledger' })
    .addFields({
      name: '\u200B',
      value: phaseBreadcrumb(ctx.phase),
      inline: false,
    })
    .setFooter({
      text: `${ctx.communityName || 'Raid Ledger'} \u00B7 ${label}`,
    })
    .setTimestamp();
}

// ─── Channel Embeds ──────────────────────────────────────────

/** Lineup created — building phase begins (AC-1). */
export function buildCreatedEmbed(
  ctx: EmbedContext,
  targetDate?: Date,
): EmbedWithRow {
  const deadline = targetDate
    ? `\n\n\u{1F4C5} **Target play date:** ${discordTs(targetDate)}`
    : '';

  const embed = new EmbedBuilder()
    .setTitle('\u{1F3B2} Community Lineup — Nominations Open!')
    .setDescription(
      'A new **Community Lineup** has started! Suggest games now; voting ' +
        'opens automatically once nominations close. Phases advance on ' +
        'their own as each deadline passes:' +
        '\n\n' +
        '1. \u{1F539} **Nominations** *(current)* — suggest games to play\n' +
        '2. \u2796 **Voting** — pick your favorites from the nominees\n' +
        '3. \u2796 **Scheduling** — top picks are matched, scheduled, and played!' +
        deadline,
    )
    .addFields({
      name: '\u{1F4DD} How to Nominate',
      value:
        '\u2022 Browse the lineup page and add games from your library\n' +
        '\u2022 Paste a **Steam store URL** in this channel to auto-nominate\n' +
        '\u2022 Use the **Common Ground game filter** to find games the group already owns\n' +
        '\n' +
        'The lineup has a **nomination cap** that grows with the number of ' +
        'unique nominators — the more people who participate, the more ' +
        'games can be added.',
    })
    .setColor(EMBED_COLORS.ANNOUNCEMENT);

  applyChrome(embed, ctx, 'Nominations Open');
  return { embed, row: ctaButton(ctx, 'Nominate a Game') };
}

/** Nomination milestone reached (AC-2). */
export function buildMilestoneEmbed(
  ctx: EmbedContext,
  threshold: number,
  entries: NominationEntry[],
): EmbedWithRow {
  const lines = entries.slice(0, 15).map((e) => {
    const link = `${ctx.baseUrl}/games/${e.gameId}`;
    return `\u{1F3AE} [**${e.gameName}**](${link}) — nominated by ${e.nominatorName}`;
  });
  const overflow =
    entries.length > 15 ? `\n*...and ${entries.length - 15} more*` : '';
  const embed = new EmbedBuilder()
    .setTitle(`\u{1F389} ${threshold}% of nominations filled!`)
    .setDescription(
      `The lineup now has **${entries.length}** games nominated. ` +
        'Keep adding games before voting opens!',
    )
    .addFields({
      name: 'Nominated Games',
      value: lines.join('\n') + overflow || 'None',
    })
    .setColor(EMBED_COLORS.ANNOUNCEMENT);

  applyChrome(embed, ctx, 'Nomination Milestone');
  return { embed, row: ctaButton(ctx, 'Nominate a Game') };
}

/** Voting opened (AC-3). */
export function buildVotingOpenEmbed(
  ctx: EmbedContext,
  games: { id: number; name: string }[],
  deadline?: Date,
): EmbedWithRow {
  const deadlineStr = deadline
    ? `\n\n\u23F0 **Voting closes:** ${discordTs(deadline)}`
    : '';

  const embed = new EmbedBuilder()
    .setTitle('\u{1F5F3}\u{FE0F} Vote on the Community Lineup!')
    .setDescription(
      'Nominations are closed — voting is now open. Pick the games you ' +
        'most want to play; each member gets a limited number of votes, ' +
        'so choose wisely.' +
        deadlineStr,
    )
    .setColor(EMBED_COLORS.ANNOUNCEMENT);

  if (games.length > 0) {
    const lines = games
      .slice(0, 15)
      .map((g) => `\u{1F3AE} [${g.name}](${ctx.baseUrl}/games/${g.id})`);
    const overflow =
      games.length > 15 ? `\n*...and ${games.length - 15} more*` : '';
    embed.addFields({
      name: `Games on the Ballot (${games.length})`,
      value: lines.join('\n') + overflow,
    });
  }

  applyChrome(embed, ctx, 'Voting Open');
  return { embed, row: ctaButton(ctx, 'Cast Your Votes') };
}

/** Matches found — decided phase (AC-5). */
export function buildDecidedEmbed(
  ctx: EmbedContext,
  matches: MatchSummary[],
): EmbedWithRow {
  const sorted = [...matches].sort((a, b) => b.voteCount - a.voteCount);
  const scheduling = matches.filter((m) => m.thresholdMet);
  const rally = matches.filter((m) => !m.thresholdMet);

  const embed = new EmbedBuilder()
    .setTitle('\u{1F3AF} Community Lineup — Results Are In!')
    .setDescription(
      'Voting is closed. Games that hit the vote threshold are ' +
        '**ready to schedule** — pick a time and play. Games still short ' +
        'on votes can rally more players and join the schedule.',
    )
    .setColor(EMBED_COLORS.SIGNUP_CONFIRMATION);

  addPodiumField(embed, sorted, ctx);
  if (scheduling.length > 0) {
    const lines = scheduling.map((m) => gameLink(m, ctx));
    embed.addFields({
      name: '\u2705 Ready to Schedule',
      value: lines.join('\n'),
    });
  }
  if (rally.length > 0) {
    const lines = rally.map((m) => gameLink(m, ctx));
    embed.addFields({
      name: '\u{1F91D} Almost There — Rally More Players',
      value: lines.join('\n'),
    });
  }

  applyChrome(embed, ctx, 'Matches Decided');
  return { embed, row: ctaButton(ctx, 'View Results') };
}

/** Format a match as a linked game line with vote count. */
function gameLink(m: MatchSummary, ctx: EmbedContext): string {
  return `\u{1F3AE} [**${m.gameName}**](${ctx.baseUrl}/games/${m.gameId}) — ${m.voteCount} votes`;
}

/** Add a podium field showing top 3 by votes. */
function addPodiumField(
  embed: EmbedBuilder,
  sorted: MatchSummary[],
  ctx: EmbedContext,
) {
  const medals = ['\u{1F947}', '\u{1F948}', '\u{1F949}'];
  const top = sorted.slice(0, 3);
  if (top.length === 0) return;
  const lines = top.map(
    (m, i) =>
      `${medals[i]} [**${m.gameName}**](${ctx.baseUrl}/games/${m.gameId}) — ${m.voteCount} votes`,
  );
  embed.addFields({ name: '\u{1F3C6} Top Voted', value: lines.join('\n') });
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
      `The **${gameName}** match has enough players! Now it's time to ` +
        'find a time that works. Suggest time slots or vote on ones ' +
        'already proposed. Once a slot has enough votes, any member ' +
        'can create the event.',
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
  gameId: number,
  eventDate: Date,
  eventId?: number,
  memberNames?: string[],
): EmbedWithRow {
  const gameUrl = `${ctx.baseUrl}/games/${gameId}`;
  const embed = new EmbedBuilder()
    .setTitle(`\u2705 ${gameName} is locked in!`)
    .setDescription(
      `[**${gameName}**](${gameUrl}) is officially scheduled and open for ` +
        'signups. Head to the event page to confirm your spot.' +
        `\n\n\u{1F4C5} **Starts** ${discordTs(eventDate)}`,
    )
    .setColor(EMBED_COLORS.SIGNUP_CONFIRMATION);

  if (memberNames && memberNames.length > 0) {
    embed.addFields({
      name: `\u{1F465} Players (${memberNames.length})`,
      value: memberNames.join(', '),
    });
  }

  applyChrome(embed, ctx, 'Event Created');
  const row = new ActionRowBuilder<ButtonBuilder>();
  if (eventId) {
    row.addComponents(
      new ButtonBuilder()
        .setLabel('View Event')
        .setStyle(ButtonStyle.Link)
        .setURL(`${ctx.baseUrl}/events/${eventId}`),
    );
  }
  row.addComponents(
    new ButtonBuilder()
      .setLabel('View Lineup')
      .setStyle(ButtonStyle.Link)
      .setURL(`${ctx.baseUrl}/community-lineup/${ctx.lineupId}`),
  );
  return { embed, row };
}

/** Tiebreaker round started (bracket or veto mode). */
export function buildTiebreakerStartedEmbed(
  ctx: EmbedContext,
  mode: 'bracket' | 'veto' = 'bracket',
  deadline?: Date,
): EmbedWithRow {
  const modeBlurb =
    mode === 'veto'
      ? 'Pick the games you want *removed* — the most-vetoed drop out.'
      : 'Vote head-to-head on each matchup to settle the tie.';
  const deadlineStr = deadline
    ? `\n\n\u23F0 **Closes** ${discordTs(deadline)}`
    : '';
  const cta = mode === 'veto' ? 'Cast Your Vetoes' : 'Vote in Bracket';

  const embed = new EmbedBuilder()
    .setTitle('\u2694\u{FE0F} Tiebreaker Round Started')
    .setDescription(
      `It's a tie! A ${mode} tiebreaker is now running. ${modeBlurb}` +
        deadlineStr,
    )
    .setColor(EMBED_COLORS.ANNOUNCEMENT);

  applyChrome(embed, ctx, 'Tiebreaker');
  return { embed, row: ctaButton(ctx, cta) };
}
