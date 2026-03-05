/**
 * BFS chain rearrangement solver for MMO auto-allocation (ROK-452).
 * Finds the shortest sequence of moves that frees a slot for a new player.
 */

interface ChainMove {
  assignmentId: number;
  signupId: number;
  fromRole: string;
  toRole: string;
  position: number;
}

export interface ChainResult {
  freedRole: string;
  moves: ChainMove[];
}

interface QueueEntry {
  roleToFree: string;
  moves: ChainMove[];
  usedSignupIds: Set<number>;
}

export function findRearrangementChain(
  newPrefs: string[],
  currentAssignments: Array<{
    id: number;
    signupId: number;
    role: string | null;
    position: number;
  }>,
  allSignups: Array<{
    id: number;
    preferredRoles: string[] | null;
  }>,
  roleCapacity: Record<string, number>,
  filledPerRole: Record<string, number>,
): ChainResult | null {
  const MAX_DEPTH = 3;
  const queue: QueueEntry[] = [];

  for (const pref of newPrefs) {
    if (pref in roleCapacity) {
      queue.push({
        roleToFree: pref,
        moves: [],
        usedSignupIds: new Set(),
      });
    }
  }

  while (queue.length > 0) {
    const entry = queue.shift()!;
    if (entry.moves.length >= MAX_DEPTH) continue;

    const result = processQueueEntry(
      entry,
      currentAssignments,
      allSignups,
      roleCapacity,
      filledPerRole,
      queue,
    );
    if (result) return result;
  }

  return null;
}

function processQueueEntry(
  entry: QueueEntry,
  currentAssignments: Array<{
    id: number;
    signupId: number;
    role: string | null;
    position: number;
  }>,
  allSignups: Array<{
    id: number;
    preferredRoles: string[] | null;
  }>,
  roleCapacity: Record<string, number>,
  filledPerRole: Record<string, number>,
  queue: QueueEntry[],
): ChainResult | null {
  const occupants = currentAssignments.filter(
    (a) => a.role === entry.roleToFree && !entry.usedSignupIds.has(a.signupId),
  );

  for (const occupant of occupants) {
    const result = tryOccupantMoves(
      occupant,
      entry,
      allSignups,
      roleCapacity,
      filledPerRole,
      queue,
    );
    if (result) return result;
  }

  return null;
}

function tryOccupantMoves(
  occupant: {
    id: number;
    signupId: number;
    role: string | null;
    position: number;
  },
  entry: QueueEntry,
  allSignups: Array<{
    id: number;
    preferredRoles: string[] | null;
  }>,
  roleCapacity: Record<string, number>,
  filledPerRole: Record<string, number>,
  queue: QueueEntry[],
): ChainResult | null {
  const signup = allSignups.find((s) => s.id === occupant.signupId);
  const prefs = (signup?.preferredRoles as string[] | null) ?? [];
  if (prefs.length <= 1) return null;

  for (const altRole of prefs) {
    if (altRole === entry.roleToFree || !(altRole in roleCapacity)) {
      continue;
    }

    const move: ChainMove = {
      assignmentId: occupant.id,
      signupId: occupant.signupId,
      fromRole: entry.roleToFree,
      toRole: altRole,
      position: occupant.position,
    };
    const newMoves = [...entry.moves, move];
    const netFilled = computeNetFilled(altRole, newMoves, filledPerRole);

    if (netFilled <= roleCapacity[altRole]) {
      const freedRole =
        entry.moves.length === 0 ? entry.roleToFree : entry.moves[0].fromRole;
      return { freedRole, moves: newMoves };
    }

    const newUsed = new Set(entry.usedSignupIds);
    newUsed.add(occupant.signupId);
    queue.push({
      roleToFree: altRole,
      moves: newMoves,
      usedSignupIds: newUsed,
    });
  }

  return null;
}

function computeNetFilled(
  role: string,
  moves: ChainMove[],
  filledPerRole: Record<string, number>,
): number {
  const into = moves.filter((m) => m.toRole === role).length;
  const outOf = moves.filter((m) => m.fromRole === role).length;
  return filledPerRole[role] + into - outOf;
}
