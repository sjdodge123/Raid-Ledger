/**
 * Utility for finding available roster slots from a slot configuration.
 *
 * Shared between SignupsService (auto-allocation) and DepartureGraceService
 * (priority rejoin reassignment) to keep slot parsing logic in one place.
 */

/**
 * Parse a slot configuration and find the first available (unoccupied) slot.
 *
 * Supports both event types:
 * - MMO: `{ type: 'mmo', tank: N, healer: N, dps: N }` — role-based slots
 * - Generic: `{ player: N }` or `{ maxPlayers: N }` or `{ count: N }` — player slots
 *
 * @param slotConfig - The event's slot configuration (from events.slotConfig jsonb)
 * @param occupiedSlots - Set of occupied slot keys in "role:position" format
 * @returns The first available slot, or null if all slots are full
 */
export function findFirstAvailableSlot(
  slotConfig: Record<string, unknown> | null,
  occupiedSlots: Set<string>,
): { role: string; position: number } | null {
  if (!slotConfig) return null;

  if (slotConfig.type === 'mmo') {
    return findFirstAvailableMmoSlot(slotConfig, occupiedSlots);
  }

  return findFirstAvailableGenericSlot(slotConfig, occupiedSlots);
}

function findFirstAvailableMmoSlot(
  slotConfig: Record<string, unknown>,
  occupiedSlots: Set<string>,
): { role: string; position: number } | null {
  const roles: Array<{ role: string; count: number }> = [
    { role: 'tank', count: (slotConfig.tank as number) ?? 0 },
    { role: 'healer', count: (slotConfig.healer as number) ?? 0 },
    { role: 'dps', count: (slotConfig.dps as number) ?? 0 },
  ];

  for (const { role, count } of roles) {
    for (let pos = 1; pos <= count; pos++) {
      if (!occupiedSlots.has(`${role}:${pos}`)) {
        return { role, position: pos };
      }
    }
  }

  return null;
}

function findFirstAvailableGenericSlot(
  slotConfig: Record<string, unknown>,
  occupiedSlots: Set<string>,
): { role: string; position: number } | null {
  const maxPlayers =
    (slotConfig.player as number) ??
    (slotConfig.maxPlayers as number) ??
    (slotConfig.count as number) ??
    0;

  for (let pos = 1; pos <= maxPlayers; pos++) {
    if (!occupiedSlots.has(`player:${pos}`)) {
      return { role: 'player', position: pos };
    }
  }

  return null;
}
