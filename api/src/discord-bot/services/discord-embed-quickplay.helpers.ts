/**
 * ROK-1447 (slice C) — the compact Quick Play embed.
 *
 * Quick Play used to borrow the scheduled-event layout, which carried a 📆 date
 * line, a 🔊 voice line, a `── ROSTER: N signed up ──` header and a button row.
 * None of that survives here: a session that is ALREADY happening in a voice
 * channel does not need to advertise when it starts, where it is, or a "Sign
 * up" button. What is left is a roster, one link, and — while it is live — the
 * two badges that might actually make someone join: co-op support and a sale.
 *
 * Shape table + acceptance criteria: `planning-artifacts/specs/ROK-1447.md`
 * §Shape, AC1–AC6. The badge vocabulary itself lives in
 * `../embeds/embed-badges.helpers` and is mirrored from the web.
 */
import {
  createChannelEmbed,
  type ChannelEmbed,
} from '../embeds/embed-chrome.helpers';
import {
  coopBadge,
  priceBadge,
  type EmbedBadge,
} from '../embeds/embed-badges.helpers';
import { formatRoster, type RosterEntry } from '../embeds/embed-roster.helpers';
import { formatDurationMs } from '../utils/format-duration';
import {
  buildCompletedPushContent,
  buildEventPushContent,
} from '../utils/push-content';
import {
  gameDetailUrl,
  openEventLink,
} from './discord-embed-event-chrome.helpers';
import { absoluteEmbedImageUrl } from './embed-thumbnail.helpers';
import type {
  EmbedContext,
  EmbedEventData,
  EmbedResult,
} from './discord-embed.factory';

const OPEN = '▸'; // ▸
const SQUARE = '■'; // ■
const SEP = '·'; // ·
const EN_DASH = '–'; // –

/** Which half of the Quick Play lifecycle is being rendered. */
export type QuickPlayState = 'live' | 'ended';

/**
 * The noun the LIVE author line counts with.
 *
 * `playing` is the default and the only value any pre-ROK-1446 caller uses. A
 * Just Chatting group (ROK-1446 D2 — presence-null members who cleared the
 * threshold together) has no game to play, so the channel-presence renderer
 * asks for `in voice` instead. Operator ruling, 2026-09-04.
 */
export type QuickPlayCountNoun = 'playing' | 'in voice';

/**
 * A Quick Play embed and its push line.
 *
 * Structurally an `EmbedResult`, so the ad-hoc service can keep destructuring
 * `{ embed, row, content }` — but `row` is never set: Quick Play has no button
 * row in either state (spec §Shape).
 */
export interface QuickPlayEmbedResult extends EmbedResult {
  embed: ChannelEmbed;
  content: string;
}

type SignupMention = NonNullable<EmbedEventData['signupMentions']>[number];

/** Context URL first, then the deployment-wide fallback. */
function resolveClientUrl(context: EmbedContext): string | undefined {
  return context.clientUrl || process.env.CLIENT_URL;
}

/**
 * A wall-clock time in the community's timezone, e.g. `6:00 PM`.
 *
 * Plain text on purpose: Discord does NOT render `<t:…>` markdown inside an
 * embed FOOTER (it does in a description), so a footer built from timestamp
 * tokens ships the literal `<t:1788372000:t>` to every reader. The start time
 * still gets native, per-reader localisation — via `setTimestamp`, which
 * Discord renders after the footer text.
 */
function clockTime(iso: string, timezone?: string | null): string {
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    ...(timezone ? { timeZone: timezone } : {}),
  });
}

/** `6:00–8:45 PM` — the shared meridiem is written once. */
function clockRange(event: EmbedEventData, timezone?: string | null): string {
  const start = clockTime(event.startTime, timezone);
  const end = clockTime(event.endTime, timezone);
  const [startClock, startMeridiem] = start.split(' ');
  const trimmed = end.endsWith(` ${startMeridiem}`) ? startClock : start;
  return `${trimmed}${EN_DASH}${end}`;
}

/** Participants still in voice — the head-count the LIVE author line reports. */
function activeCount(event: EmbedEventData): number {
  return (event.signupMentions ?? []).filter((m) => m.status !== 'left').length;
}

/** `▸ LIVE · Quick Play · 3 playing` / `■ ENDED · Quick Play · 2h 45m`. */
function authorLine(
  event: EmbedEventData,
  state: QuickPlayState,
  countNoun: QuickPlayCountNoun,
): string {
  if (state === 'ended') {
    const ms =
      new Date(event.endTime).getTime() - new Date(event.startTime).getTime();
    return `${SQUARE} ENDED ${SEP} Quick Play ${SEP} ${formatDurationMs(ms)}`;
  }
  const count = String(activeCount(event));
  return `${OPEN} LIVE ${SEP} Quick Play ${SEP} ${count} ${countNoun}`;
}

/**
 * `started` while live (the native timestamp supplies the time); the session
 * window once it has ended. Plain text — see `clockTime`.
 */
function footerLabel(
  event: EmbedEventData,
  state: QuickPlayState,
  timezone?: string | null,
): string {
  return state === 'ended' ? clockRange(event, timezone) : 'started';
}

/**
 * Identity for the roster: display name, then account username, then the
 * Discord username stored on the signup, never the id (ROK-1460).
 */
function rosterName(m: SignupMention): string {
  return m.displayName || m.username || m.discordUsername || '???';
}

/**
 * Bold names, capped at six.
 *
 * The `~~struck~~` mark is LIVE-only: it means "was in this session, gone right
 * now", which is only information while the session is running. At ENDED
 * everyone has left by definition, so striking the whole roster through says
 * nothing — the names render plain (operator decision, 2026-09-02).
 */
function rosterBlock(event: EmbedEventData, state: QuickPlayState): string {
  const entries: RosterEntry[] = (event.signupMentions ?? []).map((m) => ({
    name: rosterName(m),
    ...(state === 'live' && m.status === 'left' ? { struck: true } : {}),
  }));
  return formatRoster(entries) || 'Nobody yet';
}

/** `Attendance · 4 players` — reported once, at the end. */
function attendanceLine(event: EmbedEventData): string {
  const n = event.signupCount;
  return `Attendance ${SEP} ${String(n)} player${n === 1 ? '' : 's'}`;
}

/** Roster, then attendance once ended, then the masked event link. */
function description(
  event: EmbedEventData,
  clientUrl: string | undefined,
  state: QuickPlayState,
): string {
  const lines = [rosterBlock(event, state)];
  if (state === 'ended') lines.push(attendanceLine(event));
  const link = openEventLink(clientUrl, event.id);
  if (link) lines.push(link);
  return lines.join('\n');
}

/**
 * The inline badge fields, in a fixed order and never a placeholder.
 *
 * Both are dropped at ENDED: a price that was worth shouting about during the
 * session is just noise on the historical record (spec §Shape, thinning).
 */
function badgeFields(
  event: EmbedEventData,
  state: QuickPlayState,
  now: number,
): Array<EmbedBadge & { inline: true }> {
  const badges = event.game?.badges;
  if (state === 'ended' || !badges) return [];
  const resolved = [coopBadge(badges), priceBadge(badges, now)];
  return resolved
    .filter((b): b is EmbedBadge => b !== null)
    .map((b) => ({ ...b, inline: true }));
}

/** The bare game name linked to its detail page; the event title otherwise. */
function applyTitle(
  embed: ChannelEmbed,
  event: EmbedEventData,
  clientUrl: string | undefined,
): void {
  embed.setTitle(event.game?.name || event.title);
  const url = gameDetailUrl(clientUrl, event.game?.id);
  if (url) embed.setURL(url);
}

/**
 * Build the compact Quick Play embed for the channel surface.
 *
 * @param event - The ad-hoc event, with `game.badges` hydrated when known.
 * @param context - Community name, client URL and timezone.
 * @param state - `'live'` while people are in voice, `'ended'` afterwards.
 * @param now - Epoch ms the price badge ages against; defaults to the wall
 *   clock. Injectable so the 24h staleness marker is reachable from a test
 *   without a time bomb in the fixture (review H1).
 * @param countNoun - The noun the LIVE author line counts with. Defaults to
 *   `playing`, so every pre-ROK-1446 caller is byte-identical; the
 *   channel-presence renderer passes `in voice` for a Just Chatting group.
 * @returns The chromed embed and its push line. Never a button row.
 */
export function buildQuickPlayEmbed(
  event: EmbedEventData,
  context: EmbedContext,
  state: QuickPlayState,
  now: number = Date.now(),
  countNoun: QuickPlayCountNoun = 'playing',
): QuickPlayEmbedResult {
  const clientUrl = resolveClientUrl(context);
  const embed = createChannelEmbed({
    state: state === 'ended' ? 'done' : 'live',
    communityName: context.communityName,
    authorLine: authorLine(event, state, countNoun),
    footerLabel: footerLabel(event, state, context.timezone),
  });
  // Overrides the chrome's "now": the reader sees when the session STARTED,
  // localised by Discord itself.
  embed.setTimestamp(new Date(event.startTime));
  applyTitle(embed, event, clientUrl);
  embed.setDescription(description(event, clientUrl, state));
  const fields = badgeFields(event, state, now);
  if (fields.length > 0) embed.addFields(fields);
  const thumbnail = absoluteEmbedImageUrl(event.game?.coverUrl);
  if (thumbnail) embed.setThumbnail(thumbnail);
  const content =
    state === 'ended'
      ? buildCompletedPushContent(event)
      : buildEventPushContent(event, context.timezone);
  return { embed, content };
}
