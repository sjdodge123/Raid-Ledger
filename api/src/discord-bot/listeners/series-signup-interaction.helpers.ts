import type {
  JoinSeriesResponseDto,
  LeaveSeriesResponseDto,
  SeriesSignupStateDto,
} from '@raid-ledger/contract';
import {
  SERIES_BUTTON_IDS,
  type SeriesButtonId,
} from '../series-signup/series-signup.constants';

/** A series role pick carried in a customId. */
export type SeriesRole = 'tank' | 'healer' | 'dps';

/** A parsed `series_*` customId: `action:eventId[:characterId|-[:roles|-]]`. */
export interface ParsedSeriesCustomId {
  action: SeriesButtonId;
  eventId: number;
  characterId: string | null;
  roles: SeriesRole[] | null;
}

const ACTIONS: ReadonlySet<string> = new Set(Object.values(SERIES_BUTTON_IDS));
const ROLES: ReadonlySet<string> = new Set(['tank', 'healer', 'dps']);
const MAX_CUSTOM_ID = 100;
const NONE = '-';

function isSeriesAction(value: string): value is SeriesButtonId {
  return ACTIONS.has(value);
}

function isRole(value: string): value is SeriesRole {
  return ROLES.has(value);
}

function parseRoles(raw: string | undefined): SeriesRole[] | null {
  if (!raw || raw === NONE) return null;
  const roles = raw.split(',').filter(isRole);
  return roles.length > 0 ? roles : null;
}

/** Parse a `series_*` customId; null for anything that is not ours. */
export function parseSeriesCustomId(
  customId: string,
): ParsedSeriesCustomId | null {
  const [action, eventIdRaw, charRaw, rolesRaw] = customId.split(':');
  if (!action || !isSeriesAction(action) || !eventIdRaw) return null;
  if (!/^\d+$/.test(eventIdRaw)) return null;
  return {
    action,
    eventId: Number(eventIdRaw),
    characterId: charRaw && charRaw !== NONE ? charRaw : null,
    roles: parseRoles(rolesRaw),
  };
}

/**
 * Build a `series_*` customId carrying the picks so far (`-` = none).
 * Throws when the result exceeds Discord's 100-character limit.
 */
export function buildSeriesCustomId(
  action: SeriesButtonId,
  eventId: number,
  characterId: string | null,
  roles: readonly SeriesRole[] | null,
): string {
  const rolePart = roles && roles.length > 0 ? roles.join(',') : NONE;
  const id = `${action}:${eventId}:${characterId ?? NONE}:${rolePart}`;
  if (id.length > MAX_CUSTOM_ID) {
    throw new Error(`Series customId exceeds ${MAX_CUSTOM_ID} characters`);
  }
  return id;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function discordDate(iso: string): string {
  return `<t:${Math.floor(Date.parse(iso) / 1000)}:D>`;
}

/** "Sign up for the 6 upcoming nights (A → B). 1 night you declined stays declined." */
export function formatJoinSummary(state: SeriesSignupStateDto): string {
  const range =
    state.firstNight && state.lastNight
      ? ` (${discordDate(state.firstNight)} → ${discordDate(state.lastNight)})`
      : '';
  const kept = state.nights.filter((n) => n.state === 'stays_inactive').length;
  const keptLine =
    kept > 0 ? ` ${plural(kept, 'night')} you declined stays declined.` : '';
  return `Sign up for the ${plural(state.joinableCount, 'upcoming night')}${range}.${keptLine}`;
}

/** "You're in for N nights." plus a failed-night line when any failed. */
export function formatJoinedReply(
  res: Pick<
    JoinSeriesResponseDto,
    'attachedEventIds' | 'createdEventIds' | 'keptEventIds' | 'failed'
  >,
): string {
  const joined = res.attachedEventIds.length + res.createdEventIds.length;
  const head = `You're in for ${plural(joined, 'night')}.`;
  if (res.failed.length === 0) return head;
  return `${head}\n${plural(res.failed.length, 'night')} could not be joined.`;
}

/** Nights a leave could not cancel: the user is still signed up for them. */
function stillSignedUpLine(
  failed: LeaveSeriesResponseDto['failed'] | undefined,
): string {
  const first = failed?.[0];
  if (!failed || !first) return '';
  const n = failed.length;
  const how =
    n === 1
      ? 'Leave it from the event page.'
      : 'Leave them from each event page.';
  return `\n**Still signed up:** ${plural(n, 'night')} could not be cancelled (${first.message}). ${how}`;
}

/**
 * "You've left the series — N nights cancelled." plus the <23h warning and,
 * mirroring the web toast, the nights whose cancel failed.
 */
export function formatLeftReply(
  res: Pick<
    LeaveSeriesResponseDto,
    'cancelledEventIds' | 'lateCancelledEventIds' | 'failed'
  >,
): string {
  const head = `You've left the series — ${plural(res.cancelledEventIds.length, 'night')} cancelled.`;
  const failedLine = stillSignedUpLine(res.failed);
  const late = res.lateCancelledEventIds.length;
  if (late === 0) return `${head}${failedLine}`;
  const tail =
    late === 1
      ? '1 of them starts within 23 hours, so it counts as a late cancellation.'
      : `${late} of them start within 23 hours, so they count as late cancellations.`;
  return `${head}\n**Heads up:** ${tail}${failedLine}`;
}
