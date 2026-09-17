/**
 * Helpers for building scheduling poll Discord embeds (ROK-1014).
 * Extracted to keep the factory file within the 300-line limit.
 *
 * ROK-1461 (slice C): the family renders through `createChannelEmbed`, so the
 * state lives in the author line, the colour comes from the shared palette,
 * the voter count left the footer, the title links `/games/:id`, and the
 * "Vote Now" BUTTON became a masked link on the last description line.
 */
import { SLOT_TIE_RULE, sortSchedulingSlots } from '@raid-ledger/contract';
import { absoluteEmbedImageUrl } from './embed-thumbnail.helpers';
import { createChannelEmbed } from '../embeds/embed-chrome.helpers';
import { sanitizeName } from '../embeds/embed-roster.helpers';
import type { ChannelEmbed, EmbedState } from '../embeds/embed-chrome.helpers';
import {
  gameDetailUrl,
  maskedLink,
} from './discord-embed-event-chrome.helpers';
import { formatEpoch } from '../../notifications/format-helpers';
import type { EmbedContext } from './discord-embed.factory';
import type {
  SchedulingPollEmbedData,
  SchedulingPollSlot,
  SchedulingPollStatus,
} from './discord-embed-scheduling.types';

const MAX_DISPLAY_SLOTS = 3;

/** Names shown per slot before the rest collapse into `+N more` (F-15). */
const MAX_VOTER_NAMES = 4;

/** ROK-1549 (S1-AC3): longest cancellation reason rendered before `…`. */
const MAX_REASON_CHARS = 300;

/** ROK-1604 (S3-AC3): mirrors the web expired banner's sentence family. */
const EXPIRED_HINT =
  '*The deadline passed without a lock-in \u2014 start a new poll to pick a time.*';

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
  // ROK-1545 split `cancelled` out of `closed`; both endings share the
  // `done` colour — ROK-1549 tells them apart in the author line + body.
  cancelled: 'done',
  closed: 'done',
};

/** Unix seconds for an ISO instant. */
function unixSeconds(iso: string): number {
  return Math.floor(new Date(iso).getTime() / 1000);
}

/** Format a slot time as a Discord timestamp (description surface only). */
function formatSlotTimestamp(iso: string): string {
  return `<t:${unixSeconds(iso)}:f>`;
}

/**
 * Terminal author labels — mirror the web banner (`SchedulingTerminalBanner`
 * `closed: 'Poll expired'`). The status itself comes from the shared
 * `pollStatusFromMatch`; only the copy is mirrored here (spec Q8).
 */
const TERMINAL_LABELS: Record<'cancelled' | 'closed', string> = {
  cancelled: `${SQUARE} POLL CANCELLED`,
  closed: `${SQUARE} POLL EXPIRED`,
};

/**
 * Slots in the ONE shared order (ROK-1548): votes desc, then earliest time,
 * then id. The web page and lock-in's fallback call the same comparator, so
 * the embed can no longer name a different winner (audit F-03).
 */
function sortedSlots(slots: SchedulingPollSlot[]): SchedulingPollSlot[] {
  return sortSchedulingSlots(slots);
}

/**
 * Who voted for a slot, truncated so one line stays well inside Discord's
 * limits. The list is the same for every reader — this is one shared message
 * — so it names people rather than addressing anyone (F-15).
 */
function voterNameList(names: string[]): string {
  if (names.length === 0) return '';
  // Display names are user-editable: strip mentions and escape the markdown
  // Discord honours so `[label](url)` cannot become a masked link (ROK-1460).
  const shown = names.slice(0, MAX_VOTER_NAMES).map(sanitizeName).join(', ');
  const rest = names.length - MAX_VOTER_NAMES;
  return ` ${SEP} ${rest > 0 ? `${shown}, +${rest} more` : shown}`;
}

/** Build slot lines for the embed description. */
function buildSlotLines(slots: SchedulingPollSlot[]): string[] {
  return sortedSlots(slots)
    .slice(0, MAX_DISPLAY_SLOTS)
    .map(
      (s) =>
        `${formatSlotTimestamp(s.proposedTime)} — **${s.voteCount}** vote${s.voteCount === 1 ? '' : 's'}${voterNameList(s.voterNames)}`,
    );
}

/** True when the two leading slots hold the same number of votes. */
function topSlotsAreTied(slots: SchedulingPollSlot[]): boolean {
  const [first, second] = sortedSlots(slots);
  return (
    first !== undefined &&
    second !== undefined &&
    first.voteCount > 0 &&
    first.voteCount === second.voteCount
  );
}

/**
 * The state-carrying author line for a scheduling poll (spec §Files).
 *
 * `LOCKED IN` reports the TOP-VOTED slot — the one the description renders
 * first and the one lock-in selects.
 *
 * @param data - The poll being rendered.
 * @param timezone - IANA zone the locked-in time is rendered in.
 * @returns e.g. `▸ POLL OPEN · 5 voters`. Never the bare community name.
 */
export function schedulingPollAuthorLine(
  data: SchedulingPollEmbedData,
  timezone?: string | null,
): string {
  const status = data.status ?? 'open';
  // ROK-1549 (S1-AC4): each ending names itself — cancelled vs expired.
  if (status === 'closed' || status === 'cancelled') {
    return TERMINAL_LABELS[status];
  }
  if (status === 'locked_in') {
    // The selected slot wins; the top-voted one is only a fallback for rows
    // locked in before the time was carried (or with no linked event).
    const chosen =
      data.lockedInTime ?? sortedSlots(data.slots)[0]?.proposedTime;
    // Operator walk 2026-09-02: an author line is NOT a `<t:…>` render
    // surface, so the locked-in time is formatted server-side instead of
    // handed to Discord as markup.
    return chosen
      ? `${SOLID} LOCKED IN ${SEP} ${formatEpoch(unixSeconds(chosen), timezone ?? undefined)}`
      : `${SOLID} LOCKED IN`;
  }
  const count = data.uniqueVoterCount;
  return `${OPEN} POLL OPEN ${SEP} ${count} voter${count === 1 ? '' : 's'}`;
}

/** Top-3 slot lines, or the empty state when nobody suggested a time. */
function slotBlock(slots: SchedulingPollSlot[]): string[] {
  return slots.length === 0
    ? ['*No times suggested yet.*']
    : buildSlotLines(slots);
}

/** The open / locked-in head: the voting intro above the slot block. */
function votingHead(slots: SchedulingPollSlot[]): string[] {
  return ['Vote for the best time to play!', '', ...slotBlock(slots)];
}

/** ROK-1549 (S1-AC3): `Closes <t:R> (<t:f>)`, or nothing without a deadline. */
function deadlineLines(deadline: string | null | undefined): string[] {
  if (!deadline) return [];
  const at = unixSeconds(deadline);
  return [`Closes <t:${at}:R> (<t:${at}:f>)`];
}

/**
 * ROK-1549 (S1-AC3): the persisted cancellation reason, capped then escaped
 * (mentions defanged, markdown + masked-link markers escaped). A blank reason
 * yields no line — never `Reason: null`.
 */
function reasonLines(reason: string | null | undefined): string[] {
  const trimmed = reason?.trim();
  if (!trimmed) return [];
  const capped =
    trimmed.length > MAX_REASON_CHARS
      ? `${sanitizeName(trimmed.slice(0, MAX_REASON_CHARS))}\u2026`
      : sanitizeName(trimmed);
  return ['', `**Reason:** ${capped}`];
}

/** ROK-1604 (S3-AC3): the leading time, only when some slot drew a vote. */
function leadingTimeLines(slots: SchedulingPollSlot[]): string[] {
  const leader = sortedSlots(slots)[0];
  if (!leader || leader.voteCount <= 0) return [];
  return ['', `Leading time was ${formatSlotTimestamp(leader.proposedTime)}`];
}

/** Open: intro, slots, tie rule when tied, deadline, then the vote link. */
function openDescription(data: SchedulingPollEmbedData): string[] {
  const lines = votingHead(data.slots);
  // The rule is the comparator's own copy — never restated locally.
  if (topSlotsAreTied(data.slots)) lines.push('', `*${SLOT_TIE_RULE}*`);
  // The deadline sits directly above the link it closes (S1-AC3).
  lines.push('', ...deadlineLines(data.deadline));
  lines.push(maskedLink(`Vote now ${ARROW}`, data.pollUrl));
  return lines;
}

/**
 * Terminal bodies (Q6): slots without the voting intro, then the reason
 * (cancelled) or leading time + hint (expired), then `View poll ↗`.
 * No tie rule, no deadline.
 */
function terminalDescription(data: SchedulingPollEmbedData): string[] {
  const lines = slotBlock(data.slots);
  if (data.status === 'cancelled') {
    lines.push(...reasonLines(data.cancelReason));
  } else {
    lines.push(...leadingTimeLines(data.slots), '', EXPIRED_HINT);
  }
  lines.push('', maskedLink(`View poll ${ARROW}`, data.pollUrl));
  return lines;
}

/** Description, switched on the poll status (ROK-1549 S1-AC3/AC4, S3-AC3). */
function buildDescription(data: SchedulingPollEmbedData): string {
  const status = data.status ?? 'open';
  if (status === 'open') return openDescription(data).join('\n');
  if (status === 'locked_in') {
    const lines = votingHead(data.slots);
    lines.push('', maskedLink(`Vote now ${ARROW}`, data.pollUrl));
    return lines.join('\n');
  }
  return terminalDescription(data).join('\n');
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
    authorLine: schedulingPollAuthorLine(data, context.timezone),
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
