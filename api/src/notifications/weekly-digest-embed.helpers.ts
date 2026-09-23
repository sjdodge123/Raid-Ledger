/**
 * Weekly Discord digest — embed builder (ROK-1435 slice L3, spec §4).
 *
 * A pure function from {@link DigestSections} to one channel embed: four
 * non-inline fields in a fixed order, each omitted when its section is empty,
 * each fitted to Discord's 1024-char field value and closed by a masked
 * per-section "see all" link (operator ruling 6a, 2026-09-22). Built on the
 * shared `createChannelEmbed` chrome, so the colour comes from state, the
 * footer/author are the house ones, and no personalized field can be added.
 *
 * Returns null when every section is empty — L4 then posts nothing and does
 * not claim the week's dedup key (spec §5).
 */
import type { APIEmbedField } from 'discord.js';
import {
  createChannelEmbed,
  type ChannelEmbed,
} from '../discord-bot/embeds/embed-chrome.helpers';
import {
  isDigestEmpty,
  type DigestDealLine,
  type DigestLfgLine,
  type DigestPlayingLine,
  type DigestSection,
  type DigestSections,
} from './weekly-digest-data.helpers';
import {
  RECAP_WINDOW_DAYS,
  type WeeklyRecap,
} from './weekly-digest-recap.helpers';
import {
  DIGEST_EMBED_LIMITS,
  boldName,
  digestLinks,
  fitSectionLines,
  gameLink,
  lfgLink,
  plural,
  type DigestLinks,
} from './weekly-digest-embed-text.helpers';

/** Field names, in render order (spec §4). */
export const DIGEST_FIELD_NAMES = {
  playing: '\u{1F3AE} Been playing',
  recap: '\u{1F4CA} Last 7 days',
  deals: '\u{1F3F7} On sale',
  lfg: '\u{1F50E} Looking for group',
} as const;

export const DIGEST_FOOTER_LABEL = 'Weekly digest';
export const DIGEST_DESCRIPTION =
  "Here's what the community got up to this week.";

export interface WeeklyDigestEmbedInput {
  sections: DigestSections;
  /** Configured web origin (`getTrustedClientUrl`); null omits every link. */
  clientUrl: string | null;
  communityName?: string | null;
  /** End of the 7-day window — normally the moment the digest is built. */
  windowEnd: Date;
  /** IANA zone for the title's dates; defaults to UTC. */
  timeZone?: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function formatDay(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone,
  }).format(date);
}

/** `Week in review — Sep 15 to Sep 22`, capped at Discord's 256. */
export function digestTitle(windowEnd: Date, timeZone = 'UTC'): string {
  const start = new Date(windowEnd.getTime() - RECAP_WINDOW_DAYS * DAY_MS);
  const title = `Week in review — ${formatDay(start, timeZone)} to ${formatDay(windowEnd, timeZone)}`;
  return title.slice(0, DIGEST_EMBED_LIMITS.title);
}

function field(name: string, value: string): APIEmbedField {
  return { name, value, inline: false };
}

function playingField(
  section: DigestSection<DigestPlayingLine>,
  links: DigestLinks | null,
): APIEmbedField | null {
  if (section.items.length === 0) return null;
  const lines = section.items.map(
    (line) =>
      `${boldName(line.name, gameLink(links, line.gameId))} · ${plural(line.playerCount, 'player')}`,
  );
  const value = fitSectionLines(lines, section.total, links?.playing ?? null);
  return field(DIGEST_FIELD_NAMES.playing, value);
}

function recapField(
  recap: WeeklyRecap | null,
  links: DigestLinks | null,
): APIEmbedField | null {
  if (!recap) return null;
  const counts =
    `**${String(recap.eventsRun)}** ${recap.eventsRun === 1 ? 'event' : 'events'}` +
    ` · **${String(recap.playersAttended)}** ${recap.playersAttended === 1 ? 'player' : 'players'}`;
  const value = fitSectionLines(
    [counts],
    1,
    links?.recap ?? null,
    'past events',
  );
  return field(DIGEST_FIELD_NAMES.recap, value);
}

function dealText(line: DigestDealLine): string {
  const cut = `−${String(line.cutPercent)}%`;
  return line.price === null ? cut : `${cut} · $${line.price.toFixed(2)}`;
}

function dealsField(
  section: DigestSection<DigestDealLine>,
  links: DigestLinks | null,
): APIEmbedField | null {
  if (section.items.length === 0) return null;
  const lines = section.items.map(
    (line) =>
      `${boldName(line.name, gameLink(links, line.gameId))} ${dealText(line)}`,
  );
  const value = fitSectionLines(lines, section.total, links?.deals ?? null);
  return field(DIGEST_FIELD_NAMES.deals, value);
}

function lfgStatus(line: DigestLfgLine): string {
  return line.isViable ? 'ready' : `needs ${String(line.playersNeeded)} more`;
}

/** AC5: zero live groups ⇒ no field at all, never an empty one. */
function lfgField(
  section: DigestSection<DigestLfgLine>,
  links: DigestLinks | null,
): APIEmbedField | null {
  if (section.items.length === 0) return null;
  const lines = section.items.map(
    (line) =>
      `${boldName(line.gameName, lfgLink(links, line.gameSlug))} · ${String(line.activeCount)} looking · ${lfgStatus(line)}`,
  );
  const value = fitSectionLines(lines, section.total, links?.lfg ?? null);
  return field(DIGEST_FIELD_NAMES.lfg, value);
}

/** The digest's fields in render order, empty sections left out. */
export function buildDigestFields(
  sections: DigestSections,
  links: DigestLinks | null,
): APIEmbedField[] {
  return [
    playingField(sections.playing, links),
    recapField(sections.recap, links),
    dealsField(sections.deals, links),
    lfgField(sections.lfg, links),
  ].filter((f): f is APIEmbedField => f !== null);
}

/**
 * Build the weekly digest embed, or null when there is nothing to say.
 *
 * @param input - The assembled sections plus the chrome/link context.
 * @returns A `ChannelEmbed`, or null for an all-empty week.
 */
export function buildWeeklyDigestEmbed(
  input: WeeklyDigestEmbedInput,
): ChannelEmbed | null {
  if (isDigestEmpty(input.sections)) return null;
  const links = digestLinks(input.clientUrl);
  const embed = createChannelEmbed({
    state: 'announcing',
    communityName: input.communityName,
    footerLabel: DIGEST_FOOTER_LABEL,
    ...(links ? { authorUrl: links.playing } : {}),
  });
  embed
    .setTitle(digestTitle(input.windowEnd, input.timeZone))
    .setDescription(DIGEST_DESCRIPTION)
    .addFields(buildDigestFields(input.sections, links));
  return embed;
}
