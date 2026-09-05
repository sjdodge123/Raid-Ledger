/**
 * ROK-1374 (Lane B) — the three tie-lifecycle channel embeds (D6).
 *
 * Discord ANNOUNCES a tie; it never compares and never carries a Pick button.
 * That is a grammar constraint, not a preference: ROK-1449's rule is that a
 * channel embed renders identical bytes for every viewer, and the readiness
 * comparison is built from per-viewer data (who owns what, each reader's own
 * download estimate). So nothing here may mention a user, render an "you own"
 * badge, or branch on the reader. The one ownership figure that IS allowed —
 * `N/M already own it` on the decided embed — is a roster-scoped aggregate,
 * the same number for everybody.
 *
 * Lives in its own file rather than in `lineup-notification-embed.helpers.ts`:
 * that file is 238/300 counted and these builders are ~70, which would push it
 * past the ESLint `max-lines` error.
 */
import {
  createChannelEmbed,
  type ChannelEmbed,
  type EmbedState,
} from '../discord-bot/embeds/embed-chrome.helpers';
import { lineupLink } from './lineup-notification-author.helpers';
import {
  appendBreadcrumb,
  resolveEmbedTitle,
} from './lineup-notification-embed-chrome.helpers';
import type {
  EmbedContext,
  EmbedWithRow,
} from './lineup-notification-embed.helpers';

/** Author-line glyphs, spelled out so a mojibake diff stays readable. */
const DOTTED = '◌'; // ◌ — awaiting a human
const SQUARE = '■'; // ■ — terminal
const SEP = '·';
const ARROW = '↗';

/** Footer label shared by the three tie embeds. */
const FOOTER = 'Tie';

/** A tied option, reduced to what a channel embed is allowed to render. */
export interface TieEmbedGame {
  id: number;
  name: string;
}

/**
 * Strip the mention opener from interpolated free text.
 *
 * A display name is user-controlled, so `<@123>` typed into a username would
 * ping the channel from an embed that AC9 requires to contain no `<@` at all.
 */
function plainName(value: string): string {
  return value.replaceAll('<@', '@');
}

/** `Deep Rock Galactic / Valheim` — the tied options, in detection order. */
function joinNames(games: ReadonlyArray<TieEmbedGame>): string {
  return games.map((game) => plainName(game.name)).join(' / ');
}

/** Chrome + bare title, mirroring `createLineupEmbed` for a non-lineup kind. */
function createTieEmbed(
  ctx: EmbedContext,
  state: EmbedState,
  authorLine: string,
): ChannelEmbed {
  const embed = createChannelEmbed({
    state,
    communityName: ctx.communityName,
    authorLine,
    footerLabel: FOOTER,
  });
  // AC9: the title is user-authored too — the one field the chrome left raw.
  embed.setTitle(plainName(resolveEmbedTitle(ctx)));
  return embed;
}

/**
 * `Both fit your group of 6` for a two-way tie, `All 3 fit …` beyond it.
 *
 * "your group" is the signed-up roster — the same set for every reader, so it
 * stays inside the identical-bytes rule.
 */
function fitLine(gameCount: number, rosterSize: number): string {
  const subject = gameCount === 2 ? 'Both' : `All ${gameCount}`;
  return `${subject} fit your group of ${rosterSize} — open the lineup to compare and pick.`;
}

/**
 * The tie announcement: the vote finished without a decidable winner.
 *
 * @param ctx - Lineup context supplying the web origin, title and community.
 * @param tiedGames - The tied options at detection, in detection order.
 * @param rosterSize - Signed-up roster size (`loadExpectedVoters`).
 * @returns The amber `needs_you` embed, identical for every viewer.
 */
export function buildTieDetectedEmbed(
  ctx: EmbedContext,
  tiedGames: ReadonlyArray<TieEmbedGame>,
  rosterSize: number,
): EmbedWithRow {
  const embed = createTieEmbed(
    ctx,
    'needs_you',
    `${DOTTED} TIED ${SEP} ${joinNames(tiedGames)}`,
  );
  embed.setDescription(
    `${fitLine(tiedGames.length, rosterSize)}` +
      `\n\n${lineupLink(ctx, `Open lineup ${ARROW}`)}`,
  );
  appendBreadcrumb(embed, ctx);
  return { embed };
}

/**
 * The same message, edited once a human picked a game.
 *
 * @param ctx - Lineup context.
 * @param game - The picked game.
 * @param pickedBy - Display name of the creator/operator who picked.
 * @param owned - Roster-scoped ownership aggregate — never per-viewer.
 * @returns The terminal `done` embed.
 */
export function buildTieDecidedEmbed(
  ctx: EmbedContext,
  game: TieEmbedGame,
  pickedBy: string,
  owned: { count: number; rosterSize: number },
): EmbedWithRow {
  const embed = createTieEmbed(
    ctx,
    'done',
    `${SQUARE} DECIDED ${SEP} ${plainName(game.name)}`,
  );
  embed.setDescription(
    `Tied on votes ${SEP} picked by ${plainName(pickedBy)} — ` +
      `${owned.count}/${owned.rosterSize} already own it` +
      `\n\n${lineupLink(ctx, `Open lineup ${ARROW}`)}`,
  );
  appendBreadcrumb(embed, ctx);
  return { embed };
}

/**
 * The same message, edited when the hold expired with no pick (D13).
 *
 * Expiry never selects a winner, so the copy says exactly that.
 *
 * @param ctx - Lineup context.
 * @param tiedGames - The options that were tied when the hold expired.
 * @returns The terminal `done` embed.
 */
export function buildTieExpiredEmbed(
  ctx: EmbedContext,
  tiedGames: ReadonlyArray<TieEmbedGame>,
): EmbedWithRow {
  const embed = createTieEmbed(ctx, 'done', `${SQUARE} EXPIRED ${SEP} undecided`);
  embed.setDescription(
    'Nobody picked — the lineup closed without a decision.' +
      `\n\nTied: ${joinNames(tiedGames)}` +
      `\n\n${lineupLink(ctx, `Open lineup ${ARROW}`)}`,
  );
  appendBreadcrumb(embed, ctx);
  return { embed };
}
