/**
 * Weekly Discord digest — embed builder (ROK-1435 slice L3; v2 ROK-1771 L5).
 *
 * A pure function from {@link DigestSectionsV2} to one channel embed: up to
 * seven non-inline fields in the spec §4.1 order (Spotlight → Been playing →
 * Last 7 days → Firsts & milestones → Coming up → Looking for group → Best
 * price), each omitted when its section is empty, each fitted to its §4.1 cap
 * and, where it has one, closed by a masked "see all" link. A final §4.2 pass
 * (`fitDigestTotal`) keeps the whole embed within Discord's 6000 total. Built
 * on the shared `createChannelEmbed` chrome, so the colour comes from state,
 * the footer/author are the house ones, and no personalized field can be
 * added. Discord timestamps appear only in the Coming up value.
 *
 * Returns null when every section is empty — the service then posts nothing
 * and does not claim the week's dedup key (spec §5).
 */
import { embedLength, type APIEmbedField } from 'discord.js';
import {
  createChannelEmbed,
  type ChannelEmbed,
} from '../discord-bot/embeds/embed-chrome.helpers';
import type { DigestBestPriceSection } from './weekly-digest-best-price.helpers';
import type {
  DigestLfgLine,
  DigestPlayingLine,
  DigestSection,
  DigestSections,
} from './weekly-digest-data.helpers';
import {
  DIGEST_LINE_CAPS,
  bestPriceField,
  lfgField,
  milestonesField,
  playingField,
  recapField,
  upcomingField,
} from './weekly-digest-embed-sections.helpers';
import { spotlightField } from './weekly-digest-embed-spotlight.helpers';
import {
  DIGEST_EMBED_LIMITS,
  digestLinks,
  fitDigestTotal,
  type DigestLinks,
  type DigestTrimStep,
} from './weekly-digest-embed-text.helpers';
import {
  isEmptyDigestMilestones,
  type DigestMilestones,
} from './weekly-digest-milestones.helpers';
import {
  RECAP_WINDOW_DAYS,
  type WeeklyRecap,
} from './weekly-digest-recap.helpers';
import type { SpotlightCandidate } from './weekly-digest-spotlight.helpers';
import type { WeeklyUpcoming } from './weekly-digest-upcoming.helpers';

export { DIGEST_FIELD_NAMES } from './weekly-digest-embed-sections.helpers';

export const DIGEST_FOOTER_LABEL = 'Weekly digest';
export const DIGEST_DESCRIPTION =
  "Here's what the community got up to this week.";

/**
 * Everything the v2 digest renders — the single input the data layer (L6)
 * assembles. Each part is independently empty-able (AC14).
 */
export interface DigestSectionsV2 {
  /** `pickSpotlight`'s result; null ⇒ no spotlight field. */
  spotlight: SpotlightCandidate | null;
  playing: DigestSection<DigestPlayingLine>;
  /** Game ids to tag `🆕 new`; `[]` when there is no prior-week data (AC8). */
  newGameIds: readonly number[];
  /** This week's recap; null ⇒ no recap field. */
  recap: WeeklyRecap | null;
  /** The prior week (`endOffsetDays: 7`); null or all-zero ⇒ no arrows. */
  priorRecap: WeeklyRecap | null;
  milestones: DigestMilestones | null;
  upcoming: WeeklyUpcoming | null;
  lfg: DigestSection<DigestLfgLine>;
  bestPrice: DigestBestPriceSection | null;
}

/** True when nothing would render (Q6: Coming up alone is enough to post). */
export function isDigestV2Empty(s: DigestSectionsV2): boolean {
  return (
    s.spotlight === null &&
    s.playing.items.length === 0 &&
    s.recap === null &&
    (s.milestones === null || isEmptyDigestMilestones(s.milestones)) &&
    (s.upcoming === null ||
      (s.upcoming.events.length === 0 && s.upcoming.polls.length === 0)) &&
    s.lfg.items.length === 0 &&
    (s.bestPrice === null || s.bestPrice.items.length === 0)
  );
}

/**
 * @deprecated Transitional bridge until L6 assembles {@link DigestSectionsV2};
 * the v1 any-discount deals are dropped (replaced by Best price, ruling §11).
 */
export function digestSectionsV2FromV1(s: DigestSections): DigestSectionsV2 {
  return {
    spotlight: null,
    playing: s.playing,
    newGameIds: [],
    recap: s.recap,
    priorRecap: null,
    milestones: null,
    upcoming: null,
    lfg: s.lfg,
    bestPrice: null,
  };
}

export interface WeeklyDigestEmbedInput {
  sections: DigestSectionsV2;
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

/** The fields in §4.1 order with the given §4.2 trims applied. */
export function renderDigestFields(
  s: DigestSectionsV2,
  links: DigestLinks | null,
  applied: ReadonlySet<DigestTrimStep> = new Set(),
): APIEmbedField[] {
  return [
    spotlightField(s.spotlight, links),
    playingField(
      s.playing,
      s.newGameIds,
      applied.has('stripPlayingLinks') ? null : links,
    ),
    recapField(s.recap, s.priorRecap, links),
    milestonesField(
      s.milestones,
      applied.has('milestonesToThree')
        ? DIGEST_LINE_CAPS.milestonesTrimmed
        : DIGEST_LINE_CAPS.milestones,
    ),
    upcomingField(s.upcoming, links, !applied.has('dropPolls')),
    lfgField(
      s.lfg,
      links,
      applied.has('lfgToThree') ? DIGEST_LINE_CAPS.lfgTrimmed : undefined,
    ),
    applied.has('dropBestPrice') ? null : bestPriceField(s.bestPrice, links),
  ].filter((f): f is APIEmbedField => f !== null);
}

/** The digest's fields, trimmed per §4.2 until chrome + fields ≤ 6000. */
export function buildDigestFields(
  sections: DigestSectionsV2,
  links: DigestLinks | null,
  chromeLength = 0,
): APIEmbedField[] {
  return fitDigestTotal(
    (applied) => renderDigestFields(sections, links, applied),
    chromeLength,
  );
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
  if (isDigestV2Empty(input.sections)) return null;
  const links = digestLinks(input.clientUrl);
  const embed = createChannelEmbed({
    state: 'announcing',
    ...(input.communityName !== undefined
      ? { communityName: input.communityName }
      : {}),
    footerLabel: DIGEST_FOOTER_LABEL,
    ...(links ? { authorUrl: links.playing } : {}),
  });
  embed
    .setTitle(digestTitle(input.windowEnd, input.timeZone))
    .setDescription(DIGEST_DESCRIPTION);
  const chrome = embedLength(embed.toJSON());
  embed.addFields(buildDigestFields(input.sections, links, chrome));
  return embed;
}
