/**
 * ROK-2352 §3.4 — how much of a group's roster shape its distinct live
 * members can fill. Each member fills at most ONE slot, and only with a role
 * they ticked; the answer is a maximum assignment (augmenting paths), so a
 * tank/healer member never blocks a healer-only one from the healer slot.
 */
import type { LfgRosterShape } from '../../plugin-host/lfg-grouping.adapter';

type Role = keyof LfgRosterShape;
const ROLES: readonly Role[] = ['tank', 'healer', 'dps'];

/**
 * @param shape - The group's roster shape.
 * @param members - One entry per distinct member: the roles they ticked
 *   (none = "role not set", fills nothing).
 * @returns Filled slots per role, never above `shape`.
 */
export function assignRoleCoverage(
  shape: LfgRosterShape,
  members: readonly (readonly string[])[],
): LfgRosterShape {
  const rolesOf = members.map((r) => ROLES.filter((role) => r.includes(role)));
  const seats: Record<Role, number[]> = { tank: [], healer: [], dps: [] };
  const place = (m: number, seen: Set<Role>): boolean => {
    for (const role of rolesOf[m] ?? []) {
      if (seen.has(role)) continue;
      seen.add(role);
      const seat = seats[role];
      if (seat.length < shape[role]) {
        seat.push(m);
        return true;
      }
      for (let i = 0; i < seat.length; i += 1) {
        const other = seat[i];
        if (other !== undefined && place(other, seen)) {
          seat[i] = m;
          return true;
        }
      }
    }
    return false;
  };
  rolesOf.forEach((_, m) => place(m, new Set()));
  return {
    tank: seats.tank.length,
    healer: seats.healer.length,
    dps: seats.dps.length,
  };
}
