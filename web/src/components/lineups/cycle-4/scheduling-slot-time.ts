/**
 * Shared slot-time formatting for the scheduling poll surface (ROK-1543).
 *
 * The leader card and the ladder rows MUST render the same string for the
 * same slot — Layout B promotes one of the rows into the card, and two
 * formatters would make the promotion look like a different time.
 */

/** Format a slot's proposed time for display, flagging past slots. */
export function formatSlotTime(proposedTime: string): {
  label: string;
  isPast: boolean;
} {
  const d = new Date(proposedTime);
  const isPast = d <= new Date();
  const label = d.toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
  return { label, isPast };
}
