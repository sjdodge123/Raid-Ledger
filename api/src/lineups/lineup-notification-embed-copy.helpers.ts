/**
 * ROK-1461 (slice C) — body copy and field builders for the lineup embeds.
 *
 * Extracted from `lineup-notification-embed.helpers.ts` so that file stays
 * under its counted-line budget once every builder gained a masked link and a
 * state-carrying author line. Pure string/field construction — no chrome.
 */
import type { APIEmbedField } from 'discord.js';
import type {
  EmbedContext,
  MatchSummary,
  NominationEntry,
} from './lineup-notification-embed.helpers';

/** Games listed before a nomination/ballot field collapses into "and N more". */
const LIST_CAP = 15;

/** Medals for the single-line `🏆 Top voted` summary. */
const MEDALS = ['\u{1F947}', '\u{1F948}', '\u{1F949}'];

/** Operator-authored blurb, rendered above the body when present. */
export function descIntro(ctx: EmbedContext): string {
  return ctx.lineupDescription ? `${ctx.lineupDescription}\n\n` : '';
}

/** Body of the lineup-created embed (phase walkthrough). */
export const CREATED_BODY =
  'A new **Community Lineup** has started! Suggest games now; voting ' +
  'opens automatically once nominations close. Phases advance on ' +
  'their own as each deadline passes:' +
  '\n\n' +
  '1. \u{1F539} **Nominations** *(current)* — suggest games to play\n' +
  '2. \u2796 **Voting** — pick your favorites from the nominees\n' +
  '3. \u2796 **Scheduling** — top picks are matched, scheduled, and played!';

/** Static "how to nominate" field on the created embed. */
export const HOW_TO_NOMINATE_FIELD: APIEmbedField = {
  name: '\u{1F4DD} How to Nominate',
  value:
    '\u2022 Browse the lineup page and add games from your library\n' +
    '\u2022 Paste a **Steam store URL** in this channel to auto-nominate\n' +
    '\u2022 Use the **Common Ground game filter** to find games the group already owns\n' +
    '\n' +
    'The lineup has a **nomination cap** that grows with the number of ' +
    'unique nominators — the more people who participate, the more ' +
    'games can be added.',
};

/** Body of the voting-open embed. */
export const VOTING_BODY =
  'Nominations are closed — voting is now open. Pick the games you ' +
  'most want to play; each member gets a limited number of votes, ' +
  'so choose wisely.';

/** Body of the scheduling-open embed for one match. */
export function schedulingBody(gameName: string): string {
  return (
    `The **${gameName}** match has enough players! Now it's time to ` +
    'find a time that works. Suggest time slots or vote on ones ' +
    'already proposed. Once a slot has enough votes, any member ' +
    'can create the event.'
  );
}

/** `N of M nominations filled.`, degrading to the bare count without a cap. */
export function nominationProgress(
  ctx: EmbedContext,
  fallback: number,
): string {
  const count = ctx.nominationCount ?? fallback;
  return ctx.nominationCap
    ? `${count} of ${ctx.nominationCap} nominations filled.`
    : `${count} nominations filled.`;
}

/** Join a capped list of lines with an "...and N more" overflow marker. */
function capped(lines: string[], total: number): string {
  const overflow =
    total > LIST_CAP ? `\n*...and ${total - LIST_CAP} more*` : '';
  return lines.join('\n') + overflow;
}

/** Field listing the games nominated so far. */
export function nominatedGamesField(
  entries: NominationEntry[],
  ctx: EmbedContext,
): APIEmbedField {
  const lines = entries
    .slice(0, LIST_CAP)
    .map(
      (e) =>
        `\u{1F3AE} [**${e.gameName}**](${ctx.baseUrl}/games/${e.gameId}) — nominated by ${e.nominatorName}`,
    );
  return {
    name: 'Nominated Games',
    value: capped(lines, entries.length) || 'None',
  };
}

/** Field listing the games on the voting ballot. */
export function ballotField(
  games: { id: number; name: string }[],
  ctx: EmbedContext,
): APIEmbedField {
  const lines = games
    .slice(0, LIST_CAP)
    .map((g) => `\u{1F3AE} [${g.name}](${ctx.baseUrl}/games/${g.id})`);
  return {
    name: `Games on the Ballot (${games.length})`,
    value: capped(lines, games.length),
  };
}

/** Format a match as a linked game line with vote count. */
export function gameLink(m: MatchSummary, ctx: EmbedContext): string {
  return `\u{1F3AE} [**${m.gameName}**](${ctx.baseUrl}/games/${m.gameId}) — ${m.voteCount} votes`;
}

/**
 * Single-line `🏆 Top voted` field: the top three by votes, ` · `-joined.
 *
 * @param sorted - Matches already sorted by descending vote count.
 * @param ctx - Lineup context supplying the web origin for game links.
 * @returns The field, or null when nothing was voted on.
 */
export function topVotedField(
  sorted: MatchSummary[],
  ctx: EmbedContext,
): APIEmbedField | null {
  const top = sorted.slice(0, 3);
  if (top.length === 0) return null;
  const value = top
    .map(
      (m, i) =>
        `${MEDALS[i]} [**${m.gameName}**](${ctx.baseUrl}/games/${m.gameId}) — ${m.voteCount} votes`,
    )
    .join(' · ');
  return { name: '\u{1F3C6} Top voted', value };
}
