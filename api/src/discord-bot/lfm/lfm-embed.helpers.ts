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
 * No button row in ROK-1454 — which is what licensed the masked links under the
 * design rule "the masked link only where there is no button row". ROK-1471 D7
 * adds a row on the forum surface, and therefore the ONE additive option that
 * honours the same rule: `linkStyle: 'button'` drops the group link and nothing
 * else. It defaults to `'masked'`, so every 1454 call site and every 1454
 * assertion is unchanged. A second builder would be a spec violation.
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
 * ROK-1471 D7 — where the group link lives in this render.
 *
 * `'masked'` closes the description with `[Open group ↗]` (1454, the default).
 * `'button'` omits it because the caller is attaching a Link button that goes
 * to the same place, and the design rule forbids carrying both.
 */
export type LfmLinkStyle = 'masked' | 'button';

/** Additive render options. Every field is optional, by design (D7). */
export interface LfmEmbedOptions {
  /** Defaults to `'masked'` — the 1454 behaviour, byte for byte. */
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
 * The D7 author vocabulary. ROK-1471 reuses these strings verbatim.
 */
function authorLine(group: LfmGroupView): string {
  const n = String(group.memberCount);
  if (group.state === 'scheduled')
    return `${SQUARE} SCHEDULED ${SEP} ${n} players`;
  if (group.state === 'expired')
    return `${SQUARE} EXPIRED ${SEP} ${n} were looking`;
  if (group.state === 'closed')
    return `${SQUARE} CLOSED ${SEP} ${n} still looking`;
  if (isViable(group)) return `${OPEN} READY TO SCHEDULE ${SEP} ${n} looking`;
  const threshold = group.viabilityThreshold ?? null;
  const head = `${NEEDS} NEEDS PLAYERS ${SEP} ${n} looking`;
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
  linkStyle: LfmLinkStyle,
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
  // Only the GROUP link has a button twin. The SCHEDULED target above points at
  // the event or poll the group became, which no button in the row carries —
  // dropping it would strand the terminal render with no way to reach it.
  if (linkStyle === 'button') return null;
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
  const link = trailingLink(group, clientUrl, linkStyle);
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
 * @param options - ROK-1471 D7. Omit it for the 1454 render, byte for byte.
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
