/**
 * ROK-626: Shared bench feedback suffix for Discord signup confirmations.
 */

/**
 * Returns a bench notice suffix to append to Discord signup confirmations.
 * Returns empty string if the signup was not benched.
 */
export function benchSuffix(assignedSlot: string | null | undefined): string {
  if (assignedSlot === 'bench') {
    return '\n> The roster is full — you have been placed on the **bench**. You will be promoted when a slot opens up.';
  }
  return '';
}
