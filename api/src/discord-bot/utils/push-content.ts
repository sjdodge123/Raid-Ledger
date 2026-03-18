import type { EmbedEventData } from '../services/discord-embed.factory';

/** Max total length for a push content line. */
const MAX_LENGTH = 80;

/**
 * Build a plaintext push notification preview for a scheduled event embed.
 * No Discord tokens, no markdown -- just a clean, human-readable summary.
 */
export function buildEventPushContent(event: EmbedEventData): string {
  const date = formatShortDate(event.startTime);
  const signup = formatSignupCount(event.signupCount, event.maxAttendees);
  const suffix = ` | ${date} | ${signup}`;
  const titleWithGame = buildTitleWithGame(event.title, event.game?.name);
  return truncateToFit(`\uD83D\uDCC5 ${titleWithGame}${suffix}`, MAX_LENGTH);
}

/**
 * Build a plaintext push notification preview for a cancelled event.
 */
export function buildCancelledPushContent(title: string): string {
  return truncateToFit(`\u274C Cancelled: ${title}`, MAX_LENGTH);
}

/**
 * Build a plaintext push notification preview for a completed scheduled event.
 */
export function buildCompletedPushContent(event: EmbedEventData): string {
  const titleWithGame = buildTitleWithGame(event.title, event.game?.name);
  return truncateToFit(`\u2705 ${titleWithGame} -- Completed`, MAX_LENGTH);
}

/**
 * Build a plaintext push notification preview for an ad-hoc spawn embed.
 */
export function buildAdHocSpawnPushContent(
  event: { title: string; gameName?: string },
  participantCount: number,
): string {
  const titleWithGame = buildTitleWithGame(event.title, event.gameName);
  return truncateToFit(
    `\uD83C\uDFAE ${titleWithGame} | ${participantCount} players`,
    MAX_LENGTH,
  );
}

/**
 * Build a plaintext push notification preview for an ad-hoc completed embed.
 */
export function buildAdHocCompletedPushContent(
  event: { title: string; gameName?: string },
  durationStr: string,
): string {
  return truncateToFit(
    `\u2705 ${event.title} -- Completed (${durationStr})`,
    MAX_LENGTH,
  );
}

/** Format "Title -- Game" or just "Title" if no game. */
function buildTitleWithGame(title: string, gameName?: string | null): string {
  return gameName ? `${title} -- ${gameName}` : title;
}

/** Format signup count: "3/8 signed up" or "3 signed up". */
function formatSignupCount(count: number, max?: number | null): string {
  return max ? `${count}/${max} signed up` : `${count} signed up`;
}

/** Format a date as short locale string (e.g. "Mar 16, 10:00 PM"). */
function formatShortDate(isoString: string): string {
  const d = new Date(isoString);
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

/** Truncate a string to max length, adding "..." if needed. */
function truncateToFit(str: string, max: number): string {
  if (str.length <= max) return str;
  return `${str.slice(0, max - 3)}...`;
}
