/**
 * Discord markup stripping utilities — mirrored from the API source of truth.
 *
 * SOURCE OF TRUTH: api/src/notifications/format-helpers.ts
 *
 * This file mirrors the production logic for use in smoke tests.
 * If the production logic changes, this file must be updated to match.
 * The two files share identical transformation rules:
 *   - formatEpoch: Unix epoch → human-readable date string
 *   - stripDiscordMarkup: Discord tokens → plaintext replacements
 *   - simulatePlaintextContent: title + message → cleaned plaintext
 */

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
 * Simulate the DM processor's plaintext content transformation.
 * Combines title and message, then strips all Discord markup.
 * Used in smoke tests to verify what the push notification content
 * would look like without actually sending a DM (bot-to-bot DMs
 * fail with Discord error 50007).
 */
export function simulatePlaintextContent(
  title: string,
  message: string,
): string {
  const raw = `${title}\n${message}`;
  return stripDiscordMarkup(raw).trim();
}
