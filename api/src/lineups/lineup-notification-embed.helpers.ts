/**
 * Discord embed builders for Community Lineup notifications (ROK-932).
 *
 * ROK-1461 (slice C): every builder renders through the shared chrome —
 * state-carrying author line, bare lineup title, palette by chrome state — and
 * ends its description with a masked link. The call-to-action BUTTON rows are
 * gone; `EmbedWithRow.row` survives as a never-set optional so the dispatch
 * seam keeps compiling.
 */
import type { EmbedBuilder } from 'discord.js';
import { formatRoster } from '../discord-bot/embeds/embed-roster.helpers';
import { lineupLink } from './lineup-notification-author.helpers';
import {
  discordTs,
  createLineupEmbed,
  appendBreadcrumb,
} from './lineup-notification-embed-chrome.helpers';
import {
  CREATED_BODY,
  HOW_TO_NOMINATE_FIELD,
  VOTING_BODY,
  ballotField,
  descIntro,
  gameLink,
  nominatedGamesField,
  nominationProgress,
  schedulingBody,
  topVotedField,
} from './lineup-notification-embed-copy.helpers';
import { decidedEmbedCopy } from './lineup-notification-decided-copy.helpers';

/** Trailing glyph on every masked call-to-action link. */
const ARROW = '\u2197';

/** Lineup phase for breadcrumb rendering. */
export type LineupPhase = 'nominations' | 'voting' | 'decided';

/** Shared context for embed building — resolved once by the service. */
export interface EmbedContext {
  baseUrl: string;
  lineupId: number;
  communityName: string;
  phase: LineupPhase;
  /** Operator-authored lineup title (ROK-1063). Falls back to default when missing. */
  lineupTitle?: string;
  /** Operator-authored markdown description (ROK-1063). */
  lineupDescription?: string | null;
  /**
   * ROK-1302: false when the lineup opted out of the scheduling phase — the
   * decided embed uses terminal "results are in" copy instead of
   * "ready to schedule". Defaults to true (undefined → scheduling enabled).
   */
  schedulingEnabled?: boolean;
  /** ROK-1461: deadline of the current phase — drives the author line. */
  phaseDeadline?: Date;
  /** ROK-1461: nominations filled so far (milestone body). */
  nominationCount?: number;
  /** ROK-1461: effective cap from `effectiveNominationCap` (milestone body). */
  nominationCap?: number;
  /** ROK-1461: tiebreaker round number, defaults to 1 in the author line. */
  tiebreakerRound?: number;
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

/**
 * A built lineup embed.
 *
 * ROK-1461 removed every action row from this family; `row` remains declared
 * as `never` so the shared dispatch signature still type-checks while making a
 * re-introduced button a compile error rather than a review catch.
 */
export interface EmbedWithRow {
  embed: EmbedBuilder;
  row?: never;
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
  // ROK-1461: the card reports live progress, re-rendered on every add/remove.
  const progress =
    ctx.nominationCount === undefined
      ? ''
      : `\n\n\u{1F4CA} **${nominationProgress(ctx, 0)}**`;
  const embed = createLineupEmbed(ctx, 'created', 'Nominations Open');
  embed
    .setDescription(
      descIntro(ctx) +
        CREATED_BODY +
        deadline +
        progress +
        `\n\n${lineupLink(ctx, `Nominate a game ${ARROW}`)}`,
    )
    .addFields(HOW_TO_NOMINATE_FIELD);
  appendBreadcrumb(embed, ctx);
  return { embed };
}

/** Nomination milestone reached (AC-2). */
export function buildMilestoneEmbed(
  ctx: EmbedContext,
  threshold: number,
  entries: NominationEntry[],
): EmbedWithRow {
  const embed = createLineupEmbed(ctx, 'milestone', 'Nomination Milestone');
  embed
    .setDescription(
      `\u{1F389} **${threshold}%** milestone reached — ` +
        `${nominationProgress(ctx, entries.length)}\n` +
        'Keep adding games before voting opens!' +
        `\n\n${lineupLink(ctx, `Nominate a game ${ARROW}`)}`,
    )
    .addFields(nominatedGamesField(entries, ctx));
  appendBreadcrumb(embed, ctx);
  return { embed };
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
  const embed = createLineupEmbed(ctx, 'voting', 'Voting Open');
  embed.setDescription(
    descIntro(ctx) +
      VOTING_BODY +
      deadlineStr +
      `\n\n${lineupLink(ctx, `Cast your votes ${ARROW}`)}`,
  );
  if (games.length > 0) embed.addFields(ballotField(games, ctx));
  appendBreadcrumb(embed, ctx);
  return { embed };
}

/** Matches found — decided phase (AC-5). */
export function buildDecidedEmbed(
  ctx: EmbedContext,
  matches: MatchSummary[],
): EmbedWithRow {
  const sorted = [...matches].sort((a, b) => b.voteCount - a.voteCount);
  // ROK-1302: terminal copy when the lineup opted out of the scheduling phase.
  const copy = decidedEmbedCopy(ctx.schedulingEnabled !== false);
  const embed = createLineupEmbed(ctx, 'decided', 'Matches Decided');
  embed.setDescription(
    descIntro(ctx) +
      copy.body +
      `\n\n${lineupLink(ctx, `View results ${ARROW}`)}`,
  );

  const podium = topVotedField(sorted, ctx);
  if (podium) embed.addFields(podium);
  addTierField(embed, matches, ctx, true, copy.schedulingFieldName);
  addTierField(embed, matches, ctx, false, copy.rallyFieldName);
  appendBreadcrumb(embed, ctx);
  return { embed };
}

/** Add the scheduling ("threshold met") or rallying tier field, when non-empty. */
function addTierField(
  embed: EmbedBuilder,
  matches: MatchSummary[],
  ctx: EmbedContext,
  thresholdMet: boolean,
  name: string,
): void {
  const tier = matches.filter((m) => m.thresholdMet === thresholdMet);
  if (tier.length === 0) return;
  embed.addFields({
    name,
    value: tier.map((m) => gameLink(m, ctx)).join('\n'),
  });
}

/** Scheduling opened for a match (AC-8). */
export function buildSchedulingEmbed(
  ctx: EmbedContext,
  gameName: string,
  matchId: number,
): EmbedWithRow {
  const embed = createLineupEmbed(ctx, 'scheduling', 'Scheduling');
  embed.setDescription(
    schedulingBody(gameName) +
      `\n\n${lineupLink(ctx, `Vote on a time ${ARROW}`, matchId)}`,
  );
  appendBreadcrumb(embed, ctx);
  return { embed };
}

/** The trailing link line of the event-created embed (event first, then lineup). */
function eventCreatedLinks(ctx: EmbedContext, eventId?: number): string {
  const lineup = lineupLink(ctx, `Open lineup ${ARROW}`);
  if (!eventId) return lineup;
  return `[Open event ${ARROW}](${ctx.baseUrl}/events/${eventId}) · ${lineup}`;
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
  const embed = createLineupEmbed(ctx, 'event_created', 'Event Created');
  embed.setDescription(
    `[**${gameName}**](${ctx.baseUrl}/games/${gameId}) is officially ` +
      'scheduled and open for signups. Head to the event page to confirm ' +
      `your spot.\n\n\u{1F4C5} **Starts** ${discordTs(eventDate)}` +
      `\n\n${eventCreatedLinks(ctx, eventId)}`,
  );
  if (memberNames?.length) {
    embed.addFields({
      name: `\u{1F465} Players (${memberNames.length})`,
      value: formatRoster(memberNames),
    });
  }
  appendBreadcrumb(embed, ctx);
  return { embed };
}

/** Masked link label for a tiebreaker round, by mode. */
function tiebreakerLabel(mode: 'bracket' | 'veto'): string {
  return mode === 'veto'
    ? `Cast your vetoes ${ARROW}`
    : `Vote in bracket ${ARROW}`;
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
  const embed = createLineupEmbed(ctx, 'tiebreaker_started', 'Tiebreaker');
  embed.setDescription(
    descIntro(ctx) +
      `It's a tie! A ${mode} tiebreaker is now running. ${modeBlurb}` +
      deadlineStr +
      `\n\n${lineupLink(ctx, tiebreakerLabel(mode))}`,
  );
  appendBreadcrumb(embed, ctx);
  return { embed };
}

/** Tiebreaker reminder (24h or 1h before round deadline) — ROK-1117. */
export function buildTiebreakerReminderEmbed(
  ctx: EmbedContext,
  mode: 'bracket' | 'veto',
  deadline: Date,
  threshold: '24h' | '1h',
): EmbedWithRow {
  const headline =
    threshold === '1h'
      ? '\u23F0 Tiebreaker closing in 1 hour — cast your vote!'
      : "\u23F0 Tiebreaker closing in 24 hours — don't miss your chance to vote.";
  const embed = createLineupEmbed(
    ctx,
    'tiebreaker_reminder',
    'Tiebreaker Reminder',
  );
  embed.setDescription(
    `${headline}\n\n**Closes** ${discordTs(deadline)}` +
      `\n\n${lineupLink(ctx, tiebreakerLabel(mode))}`,
  );
  appendBreadcrumb(embed, ctx);
  return { embed };
}
