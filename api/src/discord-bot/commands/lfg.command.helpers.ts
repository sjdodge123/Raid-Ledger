/**
 * ROK-1454 D10/D11 — copy and component builders for the `/lfg` slash command.
 *
 * Pure: nothing here touches the database, the Discord client or the clock it
 * is not handed. The command file owns IO; this file owns words and buttons,
 * which is what makes every reply testable without a gateway.
 *
 * ROK-1471 extends these replies with a link to the forum post. That is an
 * additive line in the description — no builder here needs to change shape.
 */
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import type { LfgGroupSummaryDto } from '@raid-ledger/contract';
import {
  createChannelEmbed,
  type ChannelEmbed,
} from '../embeds/embed-chrome.helpers';
import { formatRoster } from '../embeds/embed-roster.helpers';
import {
  gameDetailUrl,
  maskedLink,
} from '../services/discord-embed-event-chrome.helpers';
import { LFG_BUTTON_IDS } from '../discord-bot.constants';

/**
 * The autocomplete value that means "show me my groups".
 *
 * Discord forbids mixing subcommands with top-level options, so the AC's
 * literal `/lfg list` is honoured by a sentinel CHOICE rather than a subcommand
 * (D10). It is non-numeric, and every game choice is `String(games.id)`, so the
 * two value spaces are disjoint by construction.
 */
export const LFG_LIST_SENTINEL = 'list';

/** Always the FIRST autocomplete choice, whatever the user has typed. */
export const LFG_LIST_CHOICE: { name: string; value: string } = {
  name: '📋 My groups',
  value: LFG_LIST_SENTINEL,
};

/**
 * Discord allows 5 action rows of 5 buttons AND at most 25 embed fields on one
 * message. Both ceilings are 25, and the overflow notice is itself a field, so
 * an overflowing list can only list 24 groups — see {@link buildListReply}.
 */
export const LFG_MAX_WITHDRAW_BUTTONS = 25;
const BUTTONS_PER_ROW = 5;
const LABEL_CAP = 80;

/** The same copy every other command uses for an unlinked Discord account. */
export const LFG_UNLINKED_REPLY = 'You need a linked Raid Ledger account.';

/**
 * `NotDeactivatedGuard` only guards the HTTP routes, so the slash-command path
 * has to refuse a deactivated or banned caller itself (D10).
 */
export const LFG_BLOCKED_REPLY = "This account can't post right now.";

/** Community-level render inputs, all optional and all nullable. */
export interface LfgReplyContext {
  communityName?: string | null;
  clientUrl?: string | null;
  timezone?: string | null;
}

/** What a join reply renders. `memberNames` may legitimately be empty (E8). */
export interface LfgJoinReplyInput {
  group: LfgGroupSummaryDto;
  /** False when the caller already held an active intent (idempotent re-post). */
  created: boolean;
  memberNames: string[];
  /** ROK-1471 D8 — link to the group's forum post; omitted when it has none. */
  postLink?: string | null;
}

/** ROK-1471 D8 — game id -> the masked link to that group's forum post. */
export type LfgPostLinks = ReadonlyMap<number, string>;

type AuthorGroup = Pick<
  LfgGroupSummaryDto,
  'activeCount' | 'isViable' | 'viabilityThreshold'
>;

/**
 * The D7 author-line vocabulary, shared verbatim with the channel embed so a
 * player reads the same words in their ephemeral reply and in the public post.
 *
 * @param group - Count plus the viability facts.
 * @returns e.g. `◌ NEEDS PLAYERS · 2 looking · needs 2 more`.
 */
export function lfgAuthorLine(group: AuthorGroup): string {
  const looking = `${group.activeCount} looking`;
  if (group.isViable) return `▸ READY TO SCHEDULE · ${looking}`;
  const threshold = group.viabilityThreshold;
  if (threshold === null || threshold <= group.activeCount) {
    return `◌ NEEDS PLAYERS · ${looking}`;
  }
  return `◌ NEEDS PLAYERS · ${looking} · needs ${threshold - group.activeCount} more`;
}

/**
 * A plain `expires 17 Sep` footer label in the community timezone.
 *
 * NEVER `<t:…>`: Discord does not render a Unix timestamp in a footer, and
 * `applyEmbedChrome` throws on the markup anyway.
 *
 * @param expiresAt - ISO instant, or null when nothing expires.
 * @param timezone - IANA zone; falls back to the runtime default.
 * @returns `expires 17 Sep`, or null.
 */
export function formatExpiryLabel(
  expiresAt: string | null | undefined,
  timezone?: string | null,
): string | null {
  if (!expiresAt) return null;
  const when = new Date(expiresAt);
  if (Number.isNaN(when.getTime())) return null;
  // `formatToParts` + manual assembly, NOT a locale pattern: `en-GB` renders
  // September as `Sept`, and `en-US` renders `Sep 17`. Neither is `17 Sep`.
  const parts = new Intl.DateTimeFormat('en-US', {
    day: 'numeric',
    month: 'short',
    ...(timezone ? { timeZone: timezone } : {}),
  }).formatToParts(when);
  const day = parts.find((p) => p.type === 'day')?.value;
  const month = parts.find((p) => p.type === 'month')?.value;
  if (!day || !month) return null;
  return `expires ${day} ${month}`;
}

/**
 * ROK-1471 D8 — the masked link to a group's forum post.
 *
 * Built from the ids rather than stored: `https://discord.com/channels/{guild}/{thread}`
 * is Discord's own permalink shape, and a forum post's thread id IS its channel
 * id, so the two columns the row already carries are the whole address.
 *
 * @param guildId - Guild the post lives in.
 * @param threadId - `lfg_group_messages.thread_id`.
 * @returns A masked markdown link.
 */
export function forumPostLink(guildId: string, threadId: string): string {
  return maskedLink(
    'Open the post ↗',
    `https://discord.com/channels/${guildId}/${threadId}`,
  );
}

/** The masked link to the group page, or null without a configured origin. */
function groupLink(
  clientUrl: string | null | undefined,
  gameSlug: string,
): string | null {
  if (!clientUrl) return null;
  return maskedLink('Open group ↗', `${clientUrl}/lfg/${gameSlug}`);
}

/**
 * The links that close a reply: the group page, then the forum post when the
 * group has one. Null when there is neither — a description must never end on a
 * dangling separator, and Discord rejects an empty one outright.
 */
function linkLine(
  clientUrl: string | null | undefined,
  gameSlug: string,
  postLink: string | null | undefined,
): string | null {
  const links = [groupLink(clientUrl, gameSlug), postLink ?? null].filter(
    (link): link is string => Boolean(link),
  );
  return links.length > 0 ? links.join(' · ') : null;
}

/** Join the non-null lines of a description with blank lines between them. */
function describe(...parts: Array<string | null>): string {
  return parts.filter((p): p is string => Boolean(p)).join('\n\n');
}

/** Every `/lfg` reply is a settled statement of fact — slate, per ROK-1462 D5. */
function replyEmbed(ctx: LfgReplyContext, authorLine: string): ChannelEmbed {
  return createChannelEmbed({
    state: 'done',
    communityName: ctx.communityName,
    authorLine,
  });
}

/**
 * The ephemeral reply to `/lfg game:<pick>`.
 *
 * @param input - The group as the write path settled it, plus its roster.
 * @param ctx - Community name, web origin and timezone.
 * @returns A slate channel-chrome embed.
 */
export function buildJoinReply(
  input: LfgJoinReplyInput,
  ctx: LfgReplyContext,
): ChannelEmbed {
  const { group, created, memberNames } = input;
  // Alone is alone whether this hand is new or a repeat: a solo repeat must
  // not read "1 looking" beside "Nobody yet".
  const first = group.activeCount <= 1;
  const embed = replyEmbed(
    ctx,
    first ? "🔎 YOU'RE THE FIRST" : lfgAuthorLine(group),
  );
  applyTitle(embed, group, ctx);
  embed.setDescription(
    describe(
      joinBody(input, first),
      linkLine(ctx.clientUrl, group.gameSlug, input.postLink),
    ),
  );
  const expiry = formatExpiryLabel(group.soonestExpiresAt, ctx.timezone);
  if (expiry) applyFooterLabel(embed, ctx, expiry);
  return embed;

  function joinBody(_: LfgJoinReplyInput, isFirst: boolean): string {
    if (isFirst) {
      return `Nobody else is looking for **${group.gameName}** yet — I'll post when someone else is in.`;
    }
    const roster = formatRoster(memberNames) || 'Nobody yet';
    if (!created)
      return `You're already in — ${group.activeCount} looking\n${roster}`;
    return `That's ${group.activeCount} now — here's the group:\n${roster}`;
  }
}

/** Free-typed text that matched no game. */
export function buildUnknownGameReply(
  typed: string,
  ctx: LfgReplyContext,
): ChannelEmbed {
  const embed = replyEmbed(ctx, '✕ UNKNOWN GAME');
  embed.setDescription(`I don't know **${typed}** — pick it from the list.`);
  return embed;
}

/**
 * `/lfg` with no option (and the `list` sentinel) — the caller's own groups
 * with one withdraw button each.
 *
 * @param groups - Everything `LfgService.listGroups` returned; filtered here.
 * @param ctx - Community name, web origin and timezone.
 * @param postLinks - ROK-1471 D8 — forum post links by game id. A game absent
 *   from the map simply renders no link.
 * @returns The embed plus up to five action rows of withdraw buttons.
 */
export function buildListReply(
  groups: LfgGroupSummaryDto[],
  ctx: LfgReplyContext,
  postLinks?: LfgPostLinks,
): {
  embeds: ChannelEmbed[];
  components: ActionRowBuilder<ButtonBuilder>[];
} {
  const own = groups.filter((g) => g.hasOwnIntent);
  const embed = replyEmbed(ctx, `📋 YOUR GROUPS · ${own.length}`);
  if (own.length === 0) {
    embed.setDescription(
      "You're not looking for anything right now — try `/lfg game:<name>`.",
    );
    return { embeds: [embed], components: [] };
  }
  const shown =
    own.length > LFG_MAX_WITHDRAW_BUTTONS
      ? own.slice(0, LFG_MAX_WITHDRAW_BUTTONS - 1)
      : own;
  embed.addFields(shown.map((g) => listField(g, ctx, postLinks?.get(g.gameId))));
  const overflow = own.length - shown.length;
  if (overflow > 0) {
    embed.addFields({
      name: 'More groups',
      value: `+${overflow} more on the site`,
    });
  }
  return { embeds: [embed], components: withdrawRows(shown) };
}

/** One `{game}` → `{n} looking · expires 17 Sep` field. */
function listField(
  group: LfgGroupSummaryDto,
  ctx: LfgReplyContext,
  postLink?: string,
): { name: string; value: string } {
  const expiry = formatExpiryLabel(group.soonestExpiresAt, ctx.timezone);
  const looking = `${group.activeCount} looking`;
  const head = expiry ? `${looking} · ${expiry}` : looking;
  return {
    name: group.gameName,
    value: postLink ? `${head}\n${postLink}` : head,
  };
}

/** Pack withdraw buttons five to a row. */
function withdrawRows(
  groups: LfgGroupSummaryDto[],
): ActionRowBuilder<ButtonBuilder>[] {
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  for (let i = 0; i < groups.length; i += BUTTONS_PER_ROW) {
    rows.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        groups.slice(i, i + BUTTONS_PER_ROW).map(withdrawButton),
      ),
    );
  }
  return rows;
}

/** One `Withdraw · {game}` button, labelled within Discord's 80-char cap. */
function withdrawButton(group: LfgGroupSummaryDto): ButtonBuilder {
  return new ButtonBuilder()
    .setCustomId(withdrawCustomId(group.gameId))
    .setLabel(`Withdraw · ${group.gameName}`.slice(0, LABEL_CAP))
    .setStyle(ButtonStyle.Secondary);
}

/** Title the reply with the game, linked to its detail page when possible. */
function applyTitle(
  embed: ChannelEmbed,
  group: LfgGroupSummaryDto,
  ctx: LfgReplyContext,
): void {
  embed.setTitle(group.gameName);
  const url = gameDetailUrl(ctx.clientUrl, group.gameId);
  if (url) embed.setURL(url);
}

/** Rewrite the chrome footer with an extra label, keeping the community first. */
function applyFooterLabel(
  embed: ChannelEmbed,
  ctx: LfgReplyContext,
  label: string,
): void {
  const community = ctx.communityName?.trim() || 'Raid Ledger';
  embed.setFooter({ text: `${community} · ${label}` });
}

/** The custom id a withdraw button carries. */
export function withdrawCustomId(gameId: number): string {
  return `${LFG_BUTTON_IDS.WITHDRAW}:${gameId}`;
}

/**
 * Parse a withdraw button's custom id.
 *
 * Refuses `LFG_BUTTON_IDS.JOIN` explicitly: that prefix is RESERVED for
 * ROK-1471 and must find no handler in this story.
 *
 * @param customId - The interaction's custom id.
 * @returns The game id, or null when this is not a withdraw button.
 */
export function parseWithdrawCustomId(customId: string): number | null {
  const prefix = `${LFG_BUTTON_IDS.WITHDRAW}:`;
  if (!customId.startsWith(prefix)) return null;
  const raw = customId.slice(prefix.length);
  if (!/^\d+$/.test(raw)) return null;
  return Number(raw);
}
