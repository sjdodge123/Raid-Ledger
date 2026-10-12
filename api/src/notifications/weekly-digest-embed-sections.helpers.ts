/**
 * Weekly Discord digest v2 — per-section field builders (ROK-1771 spec §4.1).
 *
 * One builder per field: Been playing, Last 7 days (+
 * week-over-week arrows), Firsts & milestones, Coming up (Discord timestamps
 * in the value only), Looking for group and Best price. Each returns null when
 * its section is empty and fits its value under the §4.1 per-field cap. Every
 * name goes through `boldName`/`sanitizeName` — never interpolated raw.
 * The spotlight field lives in `weekly-digest-embed-spotlight.helpers.ts`.
 */
import type { APIEmbedField } from 'discord.js';
import type { DigestBestPriceSection } from './weekly-digest-best-price.helpers';
import type {
  DigestLfgLine,
  DigestPlayingLine,
  DigestSection,
} from './weekly-digest-data.helpers';
import { boldCount, fitOrClip } from './weekly-digest-embed-spotlight.helpers';
import {
  DIGEST_FIELD_CAPS,
  boldName,
  eventLink,
  gameLink,
  lfgLink,
  plural,
  pollLink,
  type DigestLinks,
} from './weekly-digest-embed-text.helpers';
import type { DigestMilestones } from './weekly-digest-milestones.helpers';
import type { WeeklyRecap } from './weekly-digest-recap.helpers';
import {
  UPCOMING_EVENT_LIMIT,
  UPCOMING_POLL_LIMIT,
  type UpcomingEvent,
  type UpcomingPoll,
  type WeeklyUpcoming,
} from './weekly-digest-upcoming.helpers';

/** Field names (spotlight's is per kind — `spotlightFieldName`). */
export const DIGEST_FIELD_NAMES = {
  playing: '\u{1F3AE} Been playing',
  recap: '\u{1F4CA} Last 7 days',
  milestones: '\u{1F3C6} Firsts & milestones',
  upcoming: '\u{1F4C5} Coming up',
  lfg: '\u{1F50E} Looking for group',
  bestPrice: '\u{1F3F7} Best price',
} as const;

/** Line caps (§4.1) and the §4.2 trimmed caps. */
export const DIGEST_LINE_CAPS = {
  milestones: 5,
  milestonesTrimmed: 3,
  upcomingEvents: 5,
  upcomingPolls: 2,
  lfgTrimmed: 3,
} as const;

function field(name: string, value: string): APIEmbedField | null {
  return value === '' ? null : { name, value, inline: false };
}

/** ` ▲2` / ` ▼1`; empty when flat or when last week is unknown. */
export function weekArrow(current: number, prior: number | null): string {
  if (prior === null || current === prior) return '';
  const diff = current - prior;
  return diff > 0 ? ` ▲${String(diff)}` : ` ▼${String(-diff)}`;
}

/** Last week counts as unknown when absent or entirely empty (AC7). */
function knownPrior(prior: WeeklyRecap | null): WeeklyRecap | null {
  if (!prior) return null;
  return prior.eventsRun === 0 && prior.playersAttended === 0 ? null : prior;
}

/** `**6** events ▲2 · **14** players ▼1` + the past-events link. */
export function recapField(
  recap: WeeklyRecap | null,
  priorRecap: WeeklyRecap | null,
  links: DigestLinks | null,
): APIEmbedField | null {
  if (!recap) return null;
  const prior = knownPrior(priorRecap);
  const counts =
    `${boldCount(recap.eventsRun, 'event')}${weekArrow(recap.eventsRun, prior?.eventsRun ?? null)}` +
    ` · ${boldCount(recap.playersAttended, 'player')}${weekArrow(recap.playersAttended, prior?.playersAttended ?? null)}`;
  const value = fitOrClip(
    [counts],
    1,
    links?.recap ?? null,
    DIGEST_FIELD_CAPS.recap,
    'past events',
  );
  return field(DIGEST_FIELD_NAMES.recap, value);
}

/** Been playing: `**Game** · N players` per line. */
export function playingField(
  section: DigestSection<DigestPlayingLine>,
  links: DigestLinks | null,
): APIEmbedField | null {
  if (section.items.length === 0) return null;
  const lines = section.items.map((line) => {
    const name = boldName(line.name, gameLink(links, line.gameId));
    return `${name} · ${plural(line.playerCount, 'player')}`;
  });
  const value = fitOrClip(
    lines,
    section.total,
    links?.playing ?? null,
    DIGEST_FIELD_CAPS.playing,
  );
  return field(DIGEST_FIELD_NAMES.playing, value);
}

function newMembersLine(m: DigestMilestones['newMembers']): string | null {
  if (m.total === 0) return null;
  const count = `(${plural(m.total, 'new member')})`;
  const names = m.names.map((n) => boldName(n, null));
  const hidden = m.total - names.length;
  if (hidden > 0) names.push(`${String(hidden)} more`);
  const last = names.pop();
  if (last === undefined) return `👋 Welcome ${count}`;
  const list = names.length > 0 ? `${names.join(', ')} and ${last}` : last;
  return `👋 Welcome ${list} ${count}`;
}

/** Every milestone line, in the §4.1 priority order. */
export function milestoneLines(m: DigestMilestones): string[] {
  const welcome = newMembersLine(m.newMembers);
  return [
    ...(welcome ? [welcome] : []),
    ...m.eventMilestones.map(
      (e) =>
        `🎉 ${boldName(e.name, null)} reached **${String(e.threshold)}** events`,
    ),
    ...m.firstGames.map(
      (g) => `🆕 First time the community played ${boldName(g.name, null)}`,
    ),
    ...m.hourMilestones.map(
      (h) =>
        `⏱️ ${boldName(h.name, null)} passed **${String(h.threshold)}** community hours`,
    ),
  ];
}

/** Firsts & milestones; at most `maxLines` lines including `+N more`. */
export function milestonesField(
  m: DigestMilestones | null,
  maxLines: number = DIGEST_LINE_CAPS.milestones,
): APIEmbedField | null {
  if (!m) return null;
  const lines = milestoneLines(m);
  if (lines.length === 0) return null;
  const shown = lines.length > maxLines ? lines.slice(0, maxLines - 1) : lines;
  const value = fitOrClip(
    shown,
    lines.length,
    null,
    DIGEST_FIELD_CAPS.milestones,
  );
  return field(DIGEST_FIELD_NAMES.milestones, value);
}

/** `<t:UNIX:f>` — localised per reader; field values only, never chrome. */
export function discordTimestamp(date: Date): string {
  return `<t:${String(Math.floor(date.getTime() / 1000))}:f>`;
}

function eventLine(e: UpcomingEvent, links: DigestLinks | null): string {
  const title = boldName(e.title, eventLink(links, e.eventId));
  return `${title} · ${discordTimestamp(e.startsAt)} · ${String(e.signupCount)} signed up`;
}

function pollLine(p: UpcomingPoll, links: DigestLinks | null): string {
  const url = pollLink(links, p.lineupId, p.matchId);
  const head = `🗳️ ${boldName(p.gameName, null)} poll · ${String(p.memberCount)} interested`;
  return url ? `${head} · [vote ↗](${url})` : head;
}

/** Coming up: ≤5 events, then ≤2 polls (none when `includePolls` is off). */
export function upcomingField(
  upcoming: WeeklyUpcoming | null,
  links: DigestLinks | null,
  includePolls = true,
): APIEmbedField | null {
  if (!upcoming) return null;
  const polls = includePolls ? upcoming.polls : [];
  if (upcoming.events.length === 0 && polls.length === 0) return null;
  const lines = [
    ...upcoming.events
      .slice(0, DIGEST_LINE_CAPS.upcomingEvents)
      .map((e) => eventLine(e, links)),
    ...polls
      .slice(0, DIGEST_LINE_CAPS.upcomingPolls)
      .map((p) => pollLine(p, links)),
  ];
  const total = upcoming.events.length + polls.length;
  // A read that hit its LIMIT hides an unknown remainder: "+ more", no number.
  const exact =
    upcoming.events.length < UPCOMING_EVENT_LIMIT &&
    polls.length < UPCOMING_POLL_LIMIT;
  const value = fitOrClip(
    lines,
    total,
    links?.upcoming ?? null,
    DIGEST_FIELD_CAPS.upcoming,
    'see all',
    exact,
  );
  return field(DIGEST_FIELD_NAMES.upcoming, value);
}

function lfgStatus(line: DigestLfgLine): string {
  return line.isViable ? 'ready' : `needs ${String(line.playersNeeded)} more`;
}

/** Looking for group (v1 lines); AC5: zero live groups ⇒ no field. */
export function lfgField(
  section: DigestSection<DigestLfgLine>,
  links: DigestLinks | null,
  maxLines?: number,
): APIEmbedField | null {
  if (section.items.length === 0) return null;
  const items =
    maxLines === undefined ? section.items : section.items.slice(0, maxLines);
  const lines = items.map(
    (line) =>
      `${boldName(line.gameName, lfgLink(links, line.gameSlug))} · ${String(line.activeCount)} looking · ${lfgStatus(line)}`,
  );
  const value = fitOrClip(
    lines,
    section.total,
    links?.lfg ?? null,
    DIGEST_FIELD_CAPS.lfg,
  );
  return field(DIGEST_FIELD_NAMES.lfg, value);
}

/** `**Name** −60% · $11.99 · all-time low · 5 wishlisted` (ruling §11). */
export function bestPriceField(
  section: DigestBestPriceSection | null,
  links: DigestLinks | null,
): APIEmbedField | null {
  if (!section || section.items.length === 0) return null;
  const lines = section.items.map(
    (line) =>
      `${boldName(line.name, gameLink(links, line.gameId))} −${String(line.cutPercent)}%` +
      ` · $${line.price.toFixed(2)} · all-time low · ${String(line.wishlisters)} wishlisted`,
  );
  const value = fitOrClip(
    lines,
    section.total,
    links?.bestPrice ?? null,
    DIGEST_FIELD_CAPS.bestPrice,
  );
  return field(DIGEST_FIELD_NAMES.bestPrice, value);
}
