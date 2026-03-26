/**
 * Shared formatting utilities for Discord notification content.
 *
 * These functions transform Discord-specific markup (timestamps, mentions,
 * markdown) into human-readable plaintext for mobile push notification
 * previews (ROK-756, ROK-822, ROK-918).
 *
 * SOURCE OF TRUTH: Any mirrored copies in test tooling (e.g.
 * tools/test-bot/src/helpers/discord-markup.ts) must stay in sync with this file.
 */

/** Maximum length for mobile push notification content. */
export const MAX_CONTENT_LENGTH = 150;

/**
 * Format a Unix epoch (seconds) into a short, human-readable date string.
 * Uses en-US locale with abbreviated month, day, time, and timezone.
 */
export function formatEpoch(epoch: number): string {
  const d = new Date(epoch * 1000);
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZoneName: 'short',
  });
}

/**
 * Strip Discord markup, markdown formatting, and collapse whitespace.
 * Replaces timestamps with formatted dates, mentions with generic labels,
 * strips bold/italic markers, removes empty parentheses, and collapses
 * consecutive spaces.
 */
export function stripDiscordMarkup(text: string): string {
  return text
    .replace(/<t:(\d+)(?::[a-zA-Z])?>/g, (_, epoch) =>
      formatEpoch(Number(epoch)),
    )
    .replace(/<#\d+>/g, '#channel')
    .replace(/<@&\d+>/g, '@role')
    .replace(/<@!?\d+>/g, '@user')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/\(\s*\)/g, '')
    .replace(/ {2,}/g, ' ');
}

/**
 * Build a plaintext content string for Discord push notification previews.
 * Combines title and message, strips all Discord markup, and truncates
 * to MAX_CONTENT_LENGTH with an ellipsis if needed.
 */
export function buildPlaintextContent(title: string, message: string): string {
  const safeTitle = sanitizeValue(title);
  const safeMessage = sanitizeValue(message);
  const cleaned = stripDiscordMarkup(`${safeTitle}\n${safeMessage}`).trim();
  if (cleaned.length <= MAX_CONTENT_LENGTH) return cleaned;
  return cleaned.slice(0, MAX_CONTENT_LENGTH - 3) + '...';
}

/** Safely convert a value to a string, guarding against null/undefined/objects. */
function sanitizeValue(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean')
    return `${value}`;
  return '';
}
