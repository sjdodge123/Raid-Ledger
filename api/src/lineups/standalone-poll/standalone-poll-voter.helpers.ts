/**
 * Voter split helper for standalone poll auto-signup (ROK-1031).
 * Separates voters into those who voted for the selected slot
 * vs those who voted for other slots.
 */

/** Split voters into selected-slot voters and other-slot voters. */
export function splitVotersBySlot<T extends { userId: number; slotId: number }>(
  slots: { id: number; proposedTime: Date }[],
  allVoters: T[],
  startTime?: string,
): { selectedVoters: T[]; otherVoters: T[] } {
  if (!startTime) return { selectedVoters: allVoters, otherVoters: [] };
  const selectedSlot = slots.find(
    (s) => new Date(s.proposedTime).getTime() === new Date(startTime).getTime(),
  );
  if (!selectedSlot) return { selectedVoters: allVoters, otherVoters: [] };
  const selectedVoters = allVoters.filter((v) => v.slotId === selectedSlot.id);
  const selectedIds = new Set(selectedVoters.map((v) => v.userId));
  const otherVoters = allVoters.filter(
    (v) => v.slotId !== selectedSlot.id && !selectedIds.has(v.userId),
  );
  return { selectedVoters, otherVoters };
}

/** Format a time for DM display. */
export function formatPollTime(isoTime: string): string {
  return new Date(isoTime).toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
