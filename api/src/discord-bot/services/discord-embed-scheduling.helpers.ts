/**
 * Helpers for building scheduling poll Discord embeds (ROK-1014).
 * Extracted to keep the factory file within the 300-line limit.
 *
 * ROK-1461 (slice C): the family renders through `createChannelEmbed`, so the
 * state lives in the author line, the colour comes from the shared palette,
 * the voter count left the footer, the title links `/games/:id`, and the
 * "Vote Now" BUTTON became a masked link on the last description line.
 */
import { absoluteEmbedImageUrl } from './embed-thumbnail.helpers';
import { createChannelEmbed } from '../embeds/embed-chrome.helpers';
import type { ChannelEmbed, EmbedState } from '../embeds/embed-chrome.helpers';
import {
  gameDetailUrl,
  maskedLink,
} from './discord-embed-event-chrome.helpers';
import type { EmbedContext } from './discord-embed.factory';
import type {
  SchedulingPollEmbedData,
  SchedulingPollSlot,
  SchedulingPollStatus,
} from './discord-embed-scheduling.types';

const MAX_DISPLAY_SLOTS = 3;

/** Author-line glyphs, spelled out so a mojibake diff stays readable. */
const OPEN = '\u25B8'; // ▸
const SOLID = '\u25CF'; // ●
const SQUARE = '\u25A0'; // ■
const SEP = '\u00B7'; // ·
const ARROW = '\u2197'; // ↗

/** Poll status onto the chrome state that owns its colour. */
const CHROME_STATES: Record<SchedulingPollStatus, EmbedState> = {
  open: 'announcing',
  locked_in: 'live',
  closed: 'done',
};

/** Format a slot time as a Discord timestamp. */
function formatSlotTimestamp(iso: string): string {
  const unix = Math.floor(new Date(iso).getTime() / 1000);
  return `<t:${unix}:f>`;
}

/** Slots highest-voted first — the order the description renders. */
function sortedSlots(slots: SchedulingPollSlot[]): SchedulingPollSlot[] {
  return [...slots].sort((a, b) => b.voteCount - a.voteCount);
}

/** Build slot lines for the embed description. */
function buildSlotLines(slots: SchedulingPollSlot[]): string[] {
  return sortedSlots(slots)
    .slice(0, MAX_DISPLAY_SLOTS)
    .map(
      (s) =>
        `${formatSlotTimestamp(s.proposedTime)} — **${s.voteCount}** vote${s.voteCount === 1 ? '' : 's'}`,
    );
}

/**
 * The state-carrying author line for a scheduling poll (spec §Files).
 *
 * `LOCKED IN` reports the TOP-VOTED slot — the one the description renders
 * first and the one lock-in selects.
 *
 * @param data - The poll being rendered.
 * @returns e.g. `▸ POLL OPEN · 5 voters`. Never the bare community name.
 */
export function schedulingPollAuthorLine(
  data: SchedulingPollEmbedData,
): string {
  const status = data.status ?? 'open';
  if (status === 'closed') return `${SQUARE} POLL CLOSED`;
  if (status === 'locked_in') {
    const [top] = sortedSlots(data.slots);
    return top
      ? `${SOLID} LOCKED IN ${SEP} ${formatSlotTimestamp(top.proposedTime)}`
      : `${SOLID} LOCKED IN`;
  }
  const count = data.uniqueVoterCount;
  return `${OPEN} POLL OPEN ${SEP} ${count} voter${count === 1 ? '' : 's'}`;
}

/** Description: intro, top-3 slots (or the empty state), then the vote link. */
function buildDescription(data: SchedulingPollEmbedData): string {
  const lines: string[] = ['Vote for the best time to play!', ''];
  if (data.slots.length === 0) {
    lines.push('*No times suggested yet.*');
  } else {
    lines.push(...buildSlotLines(data.slots));
  }
  lines.push('', maskedLink(`Vote now ${ARROW}`, data.pollUrl));
  return lines.join('\n');
}

/**
 * Build the scheduling-poll embed body with its shared chrome applied.
 *
 * @param data - Poll state, slots and the poll page URL.
 * @param context - Community name and web origin for the title link.
 * @returns A channel embed; this family carries no action row (ROK-1461).
 */
export function buildSchedulingPollEmbedBody(
  data: SchedulingPollEmbedData,
  context: EmbedContext,
): ChannelEmbed {
  const embed = createChannelEmbed({
    state: CHROME_STATES[data.status ?? 'open'],
    communityName: context.communityName,
    authorLine: schedulingPollAuthorLine(data),
    footerLabel: 'Scheduling Poll',
  });
  embed.setTitle(`When should we play ${data.gameName}?`);
  const gameUrl = gameDetailUrl(
    context.clientUrl || process.env.CLIENT_URL,
    data.gameId,
  );
  if (gameUrl) embed.setURL(gameUrl);
  embed.setDescription(buildDescription(data));

  const thumbnail = absoluteEmbedImageUrl(data.gameCoverUrl);
  if (thumbnail) embed.setThumbnail(thumbnail);
  return embed;
}
