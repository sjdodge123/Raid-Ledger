/**
 * Builds a conflict warning string for Discord signup ephemeral replies (ROK-1031).
 * Appended to the signup success message when the user has overlapping events.
 */
import type { ConflictingEvent } from '../../events/event-conflict.helpers';

/**
 * Builds a conflict warning suffix for Discord ephemeral signup replies.
 * Returns an empty string when there are no conflicts.
 * @param conflicts - Array of conflicting events
 */
export function buildConflictWarning(conflicts: ConflictingEvent[]): string {
  if (conflicts.length === 0) return '';

  const titles = conflicts.map((c) => `**${c.title}**`).join(', ');

  return `\n⚠️ Note: you also have ${titles} at this time.`;
}
