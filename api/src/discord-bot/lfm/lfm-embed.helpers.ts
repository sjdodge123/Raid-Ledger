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
import type { LfgUrgency } from '@raid-ledger/contract';
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
const FIRE = '\u{1F525}'; // 🔥

/**
 * Where a group's message sits in the lifecycle. Drives everything below.
 *
 * ROK-1494 D3 adds `playing`: a now-group whose session has spawned. It is
 * NOT terminal — `TERMINAL_STATE.playing` is null — because the head-count in
 * its author line keeps moving as people join and leave voice.
 */
export type LfmRenderState =
  'open' | 'scheduled' | 'expired' | 'closed' | 'playing';

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
  /**
   * ROK-1479 D9 — the class the group renders as. Optional and absent means
   * `'week'`, so every ROK-1454/1471 fixture and call site renders
   * byte-identically to before this story (AC8).
   */
  urgency?: LfgUrgency;
  /**
   * How many of `memberCount` hold a `now` intent. **This is the definition of
   * a now-group** — the spec left it implicit, so it is stated here: a group
   * renders as "now" when `nowCount >= 1`, i.e. as soon as ANY member is
   * playing right now, not only when every member is.
   */
  nowCount?: number;
  /** Soonest expiry among the `now` intents only, ISO. Null when there are none. */
  soonestNowExpiresAt?: string | null;
  /**
   * ROK-1494 — the ad-hoc event a spawned now-group is playing in. Set at
   * `playing` only; the event link is derived from it and `clientUrl`, exactly
   * as the `scheduled` target link is, rather than carried pre-built.
   */
  playingEventId?: number | null;
  /**
   * `https://discord.com/channels/<guild>/<channel>` for the temp voice
   * channel. Null on purpose in the window between the spawn transaction
   * committing and `createForEvent` landing (contract D9) — the render then
   * still carries the event link rather than failing.
   */
  voiceChannelUrl?: string | null;
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
const [
  NEEDS_PLAYERS,
  READY_TO_SCHEDULE,
  SCHEDULED,
  EXPIRED,
  CLOSED,
  PLAYING_NOW,
] = LFG_BOARD_TAGS;

/**
 * The forum tag a group's current render deserves.
 *
 * @param group - The group as the caller read it.
 * @returns The tag, which is also the word its author line leads with.
 */
export function lfmStateTag(group: LfmGroupView): LfgBoardTag {
  // Before the viability branch: a live session is never "needs players".
  if (group.state === 'playing') return PLAYING_NOW;
  if (group.state === 'scheduled') return SCHEDULED;
  if (group.state === 'expired') return EXPIRED;
  if (group.state === 'closed') return CLOSED;
  return isViable(group) ? READY_TO_SCHEDULE : NEEDS_PLAYERS;
}

/**
 * ROK-1479 D9 — is this a "now" group?
 *
 * True the moment ANY live member holds a `now` intent (`nowCount >= 1`).
 * `urgency` carries the same fact for callers that project a single class
 * rather than a count. Terminal states are never "now": a scheduled, expired
 * or closed group has no clock left to run.
 */
function isNowGroup(group: LfmGroupView): boolean {
  if (group.state !== 'open') return false;
  return (group.nowCount ?? 0) >= 1 || group.urgency === 'now';
}

/**
 * `<t:EPOCH:t>` for the soonest `now` expiry — DESCRIPTION ONLY.
 *
 * `assertNoTimestampMarkup` (`embeds/embed-chrome.helpers.ts`) THROWS if this
 * reaches an author line or a footer, which is the whole reason D9 puts the
 * clock in the description and makes `footerLabel` return undefined instead.
 */
function nowExpiryMarkup(group: LfmGroupView): string | null {
  const iso = group.soonestNowExpiresAt ?? group.expiresAt;
  if (!iso) return null;
  const ms = new Date(iso).getTime();
  if (Number.isNaN(ms)) return null;
  return `<t:${String(Math.floor(ms / 1000))}:t>`;
}

/** The leading description line a now-group renders above its roster (D9). */
function nowLine(group: LfmGroupView): string | null {
  if (!isNowGroup(group)) return null;
  const until = nowExpiryMarkup(group);
  // Without a readable instant the line still states the urgency — dropping it
  // entirely would render a now-group as an ordinary weekly one.
  return until
    ? `${FIRE} Playing now ${SEP} until ${until}`
    : `${FIRE} Playing now`;
}

/** The D7 author line, with D9's plain `🔥 ` prefix and NEVER a timestamp. */
function authorLine(group: LfmGroupView): string {
  const line = stateAuthorLine(group);
  return isNowGroup(group) ? `${FIRE} ${line}` : line;
}

/** The D7 author line proper. Its state word is `lfmStateTag`'s, always. */
function stateAuthorLine(group: LfmGroupView): string {
  const n = String(group.memberCount);
  const tag = lfmStateTag(group);
  // ROK-1494 — the operator's own words. A plain string with no clock in it:
  // `assertNoTimestampMarkup` throws on `<t:` reaching this slot.
  if (group.state === 'playing') return `${OPEN} ${tag} ${SEP} ${n} in voice`;
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
  // ROK-1494 — the one state past `open` that is still live: a session in
  // progress is the most emerald thing the surface has.
  if (group.state === 'playing') return 'live';
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
  // ROK-1479 D9 — and so would `expires 17 Sep` on a 30-minute group. The
  // description's `<t:…:t>` is the only honest clock a now-group gets, because
  // the footer cannot render the markup at all.
  if (isNowGroup(group)) return undefined;
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

/** ROK-1494 — a live session: roster, then the voice link, then the event. */
function playingDescription(
  group: LfmGroupView,
  clientUrl: string | undefined,
): string {
  const lines = [formatRoster(group.memberNames ?? []) || 'Nobody yet'];
  if (group.voiceChannelUrl)
    lines.push(maskedLink(`Join voice ${ARROW}`, group.voiceChannelUrl));
  const eventId = group.playingEventId;
  const event =
    eventId === null || eventId === undefined
      ? null
      : openEventLink(clientUrl, eventId);
  if (event) lines.push(event);
  return lines.join('\n');
}

/** Roster then link; at EXPIRED, the D6 copy with neither. */
function description(
  group: LfmGroupView,
  clientUrl: string | undefined,
  linkStyle: LfmLinkStyle,
): string {
  if (group.state === 'expired') return 'Nobody scheduled it.';
  // ROK-1494 — the two links a live session needs, and no group link: the
  // place to be is the voice channel, not the group page.
  if (group.state === 'playing') return playingDescription(group, clientUrl);
  // `formatRoster` returns '' for an empty roster and Discord REJECTS an empty
  // value — the fallback is a posting failure away, not a cosmetic default.
  const lines: string[] = [];
  // ROK-1479 D9 — the urgency line leads, above the roster.
  const urgent = nowLine(group);
  if (urgent) lines.push(urgent);
  lines.push(formatRoster(group.memberNames ?? []) || 'Nobody yet');
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
