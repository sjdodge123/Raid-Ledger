/**
 * ROK-1454 D7 — the LFM channel embed.
 *
 * Channel grammar on the shared chrome, shaped on `buildQuickPlayEmbed`: an
 * author line that states the lifecycle position, a roster, one link, and — in
 * the open states only — the two badges that might make someone join. The
 * vocabulary is deliberately reusable: ROK-1471 renders the same author lines
 * as its forum tags.
 *
 * A PURE builder. It reads no database, no settings and no clock it was not
 * handed, so every state in the lifecycle is reachable from a fixture. The
 * chrome owns colour, author and footer — this file never calls `.setColor`,
 * `.setAuthor` or `.setFooter`, and `createChannelEmbed`'s phantom
 * `ChannelEmbed` type makes a personalized field a compile error.
 *
 * No button row, ever, in this story — which is what licenses the masked links
 * under the design rule "the masked link only where there is no button row".
 * ROK-1471 attaches a row on its forum surface and therefore passes
 * `linkStyle: 'button'`; the option is OPTIONAL and defaults to `'masked'` so
 * every 1454 call site renders byte-identically (AC5 i).
 */
import {
  createChannelEmbed,
  type ChannelEmbed,
  type EmbedState,
} from '../embeds/embed-chrome.helpers';
import {
  coopBadge,
  priceBadge,
  type EmbedBadge,
  type GameBadgeInputs,
} from '../embeds/embed-badges.helpers';
import { formatRoster } from '../embeds/embed-roster.helpers';
import {
  gameDetailUrl,
  maskedLink,
  openEventLink,
} from '../services/discord-embed-event-chrome.helpers';
import { absoluteEmbedImageUrl } from '../services/embed-thumbnail.helpers';
import { deriveViability } from '../../lfg/lfg-query.helpers';
import {
  LFG_BOARD_TAGS,
  type LfgBoardTag,
} from '../lfg-board/lfg-board.constants';
import type { EmbedContext } from '../services/discord-embed.factory';

const NEEDS = '◌'; // ◌
const OPEN = '▸'; // ▸
const SQUARE = '■'; // ■
const SEP = '·'; // ·
const ARROW = '↗'; // ↗
const MAGNIFIER = '\u{1F50E}'; // 🔎

/** Where a group's message sits in the lifecycle. Drives everything below. */
export type LfmRenderState = 'open' | 'scheduled' | 'expired' | 'closed';

/** What a converted group turned into — the link that replaces the group link. */
export type LfmTarget =
  | { kind: 'event'; eventId: number }
  | { kind: 'poll'; lineupId: number; matchId: number };

/** Everything the embed renders, already read and projected by the caller. */
export interface LfmGroupView {
  state: LfmRenderState;
  gameId: number;
  gameName: string;
  gameSlug: string;
  gameCoverUrl?: string | null;
  /** Head-count for the author line. At EXPIRED this is `last_member_count`. */
  memberCount: number;
  /** Display names in render order. Empty at EXPIRED — there is no roster. */
  memberNames?: readonly string[];
  /** `games.cooptimusOnlineMax`; null when Co-Optimus makes no claim. */
  viabilityThreshold?: number | null;
  /** Badge columns. Rendered in the open state only. */
  badges?: GameBadgeInputs | null;
  /** Soonest intent expiry, ISO. Footer copy while open. */
  expiresAt?: string | null;
  /** Set at SCHEDULED only. */
  target?: LfmTarget | null;
}

/**
 * Where the group link lives. `'button'` means the CALLER is attaching a Link
 * button (`buildLfgPostComponents`), so the description must not repeat it.
 */
export type LfmLinkStyle = 'masked' | 'button';

/** Additive render options. Every field optional — 1454 passes none. */
export interface LfmEmbedOptions {
  /** Defaults to `'masked'`, which is the ROK-1454 render exactly. */
  linkStyle?: LfmLinkStyle;
}

/** The embed and the push line for its FIRST post. Never a button row. */
export interface LfmEmbedResult {
  embed: ChannelEmbed;
  content: string;
}

/** Context URL first, then the deployment-wide fallback. */
function resolveClientUrl(context: EmbedContext): string | undefined {
  return context.clientUrl || process.env.CLIENT_URL;
}

/** The ONE definition of viable — `deriveViability`, never a local threshold. */
function isViable(group: LfmGroupView): boolean {
  return deriveViability(group.memberCount, group.viabilityThreshold ?? null);
}

/**
 * The D7 author vocabulary, DESTRUCTURED out of `LFG_BOARD_TAGS` rather than
 * retyped: the author line and ROK-1471's forum tags are then the same five
 * strings by construction, not by two developers agreeing (AC6).
 */
const [NEEDS_PLAYERS, READY_TO_SCHEDULE, SCHEDULED, EXPIRED, CLOSED] =
  LFG_BOARD_TAGS;

/**
 * The forum tag a group's current render deserves.
 *
 * @param group - The group as the caller read it.
 * @returns The tag, which is also the word its author line leads with.
 */
export function lfmStateTag(group: LfmGroupView): LfgBoardTag {
  if (group.state === 'scheduled') return SCHEDULED;
  if (group.state === 'expired') return EXPIRED;
  if (group.state === 'closed') return CLOSED;
  return isViable(group) ? READY_TO_SCHEDULE : NEEDS_PLAYERS;
}

/** The D7 author line. Its state word is `lfmStateTag`'s, always. */
function authorLine(group: LfmGroupView): string {
  const n = String(group.memberCount);
  const tag = lfmStateTag(group);
  if (group.state === 'scheduled')
    return `${SQUARE} ${tag} ${SEP} ${n} players`;
  if (group.state === 'expired')
    return `${SQUARE} ${tag} ${SEP} ${n} were looking`;
  if (group.state === 'closed')
    return `${SQUARE} ${tag} ${SEP} ${n} still looking`;
  if (tag === READY_TO_SCHEDULE) return `${OPEN} ${tag} ${SEP} ${n} looking`;
  const threshold = group.viabilityThreshold ?? null;
  const head = `${NEEDS} ${tag} ${SEP} ${n} looking`;
  if (threshold === null) return head;
  return `${head} ${SEP} needs ${String(threshold - group.memberCount)} more`;
}

/**
 * State to chrome state. Terminal is terminal regardless of head-count: a
 * SCHEDULED group that is still over its threshold is done, not live.
 */
function chromeState(group: LfmGroupView): EmbedState {
  if (group.state !== 'open') return 'done';
  return isViable(group) ? 'live' : 'needs_you';
}

/** `expires 17 Sep`, plain text — Discord does not render `<t:…>` in a footer. */
function footerLabel(
  group: LfmGroupView,
  timezone?: string | null,
): string | undefined {
  // Terminal groups do not expire, so the label would be a lie.
  if (group.state !== 'open' || !group.expiresAt) return undefined;
  // Assembled from parts rather than a locale string: `en-GB` renders
  // September as `Sept`, and `en-US` puts the month first. The community
  // timezone decides WHICH day it is, so it cannot be dropped.
  const parts = new Intl.DateTimeFormat('en-US', {
    day: 'numeric',
    month: 'short',
    ...(timezone ? { timeZone: timezone } : {}),
  }).formatToParts(new Date(group.expiresAt));
  const value = (type: string): string =>
    parts.find((p) => p.type === type)?.value ?? '';
  return `expires ${value('day')} ${value('month')}`;
}

/** The masked link that closes the description, or null without a client URL. */
function trailingLink(
  group: LfmGroupView,
  clientUrl: string | undefined,
): string | null {
  if (!clientUrl) return null;
  const target = group.target;
  if (group.state === 'scheduled' && target) {
    if (target.kind === 'event')
      return openEventLink(clientUrl, target.eventId);
    // The final segment is a MATCH id (`web/src/app-routes.tsx:125`). A poll id
    // here yields a dead link that no type-check can see — only a user 404.
    const path = `/community-lineup/${String(target.lineupId)}/schedule/${String(target.matchId)}`;
    return maskedLink(`Open poll ${ARROW}`, `${clientUrl}${path}`);
  }
  return maskedLink(
    `Open group ${ARROW}`,
    `${clientUrl}/lfg/${group.gameSlug}`,
  );
}

/** Roster then link; at EXPIRED, the D6 copy with neither. */
function description(
  group: LfmGroupView,
  clientUrl: string | undefined,
  linkStyle: LfmLinkStyle,
): string {
  if (group.state === 'expired') return 'Nobody scheduled it.';
  // `formatRoster` returns '' for an empty roster and Discord REJECTS an empty
  // value — the fallback is a posting failure away, not a cosmetic default.
  const lines = [formatRoster(group.memberNames ?? []) || 'Nobody yet'];
  // The Link button only exists while the group is open (AC5 iv): a terminal
  // render drops the whole component row, so suppressing its masked link too
  // would leave an archived post with no way back to the group.
  const suppressed = linkStyle === 'button' && group.state === 'open';
  const link = suppressed ? null : trailingLink(group, clientUrl);
  if (link) lines.push(link);
  return lines.join('\n');
}

/** Co-op + price, inline, open states only — terminal renders thin them away. */
function badgeFields(
  group: LfmGroupView,
  now: number,
): Array<EmbedBadge & { inline: true }> {
  const badges = group.badges;
  if (group.state !== 'open' || !badges) return [];
  return [coopBadge(badges), priceBadge(badges, now)]
    .filter((b): b is EmbedBadge => b !== null)
    .map((b) => ({ ...b, inline: true }));
}

/**
 * Build the LFM channel embed for a group.
 *
 * @param group - The group as the caller read it, already projected.
 * @param context - Community name, client URL and the community timezone.
 * @param now - Epoch ms the price badge ages against; injectable so the 24h
 *   staleness marker is reachable from a fixture without a time bomb.
 * @param options - ROK-1471 D7. `linkStyle: 'button'` omits the masked group
 *   link while open, for callers that attach a Link button instead.
 * @returns The chromed embed plus the push line for its FIRST post. Edits pass
 *   no content, so the caller drops `content` on every subsequent render.
 */
export function buildLfmEmbed(
  group: LfmGroupView,
  context: EmbedContext,
  now: number = Date.now(),
  options: LfmEmbedOptions = {},
): LfmEmbedResult {
  const clientUrl = resolveClientUrl(context);
  const embed = createChannelEmbed({
    state: chromeState(group),
    communityName: context.communityName,
    authorLine: authorLine(group),
    footerLabel: footerLabel(group, context.timezone),
  });
  embed.setTitle(group.gameName);
  const titleUrl = gameDetailUrl(clientUrl, group.gameId);
  if (titleUrl) embed.setURL(titleUrl);
  embed.setDescription(
    description(group, clientUrl, options.linkStyle ?? 'masked'),
  );
  const fields = badgeFields(group, now);
  if (fields.length > 0) embed.addFields(fields);
  const thumbnail = absoluteEmbedImageUrl(group.gameCoverUrl);
  if (thumbnail) embed.setThumbnail(thumbnail);
  const content = `${MAGNIFIER} ${group.gameName} ${SEP} ${String(group.memberCount)} looking for a group`;
  return { embed, content };
}
