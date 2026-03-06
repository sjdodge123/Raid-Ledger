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

type Assignment = {
  id: number;
  signupId: number;
  role: string | null;
  position: number;
};
type SignupPrefs = { id: number; preferredRoles: string[] | null };

/** Initializes the BFS queue with entries for each preferred role. */
function initQueue(
  newPrefs: string[],
  roleCapacity: Record<string, number>,
): QueueEntry[] {
  return newPrefs
    .filter((pref) => pref in roleCapacity)
    .map((pref) => ({
      roleToFree: pref,
      moves: [],
      usedSignupIds: new Set<number>(),
    }));
}

/** Finds a chain of role swaps that frees a slot for the new player. */
export function findRearrangementChain(
  newPrefs: string[],
  currentAssignments: Assignment[],
  allSignups: SignupPrefs[],
  roleCapacity: Record<string, number>,
  filledPerRole: Record<string, number>,
): ChainResult | null {
  const MAX_DEPTH = 3;
  const queue = initQueue(newPrefs, roleCapacity);
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

/** Processes one BFS queue entry, checking all occupants of the target role. */
function processQueueEntry(
  entry: QueueEntry,
  assignments: Assignment[],
  allSignups: SignupPrefs[],
  roleCapacity: Record<string, number>,
  filledPerRole: Record<string, number>,
  queue: QueueEntry[],
): ChainResult | null {
  const occupants = assignments.filter(
    (a) => a.role === entry.roleToFree && !entry.usedSignupIds.has(a.signupId),
  );
  for (const occ of occupants) {
    const r = tryOccupantMoves(
      occ,
      entry,
      allSignups,
      roleCapacity,
      filledPerRole,
      queue,
    );
    if (r) return r;
  }
  return null;
}

/** Builds a ChainMove from an occupant being moved to an alt role. */
function buildMove(
  occupant: Assignment,
  entry: QueueEntry,
  altRole: string,
): ChainMove {
  return {
    assignmentId: occupant.id,
    signupId: occupant.signupId,
    fromRole: entry.roleToFree,
    toRole: altRole,
    position: occupant.position,
  };
}

/** Tries moving an occupant to each of their alternate preferred roles. */
function tryOccupantMoves(
  occupant: Assignment,
  entry: QueueEntry,
  allSignups: SignupPrefs[],
  roleCapacity: Record<string, number>,
  filledPerRole: Record<string, number>,
  queue: QueueEntry[],
): ChainResult | null {
  const signup = allSignups.find((s) => s.id === occupant.signupId);
  const prefs = (signup?.preferredRoles as string[] | null) ?? [];
  if (prefs.length <= 1) return null;
  for (const alt of prefs) {
    if (alt === entry.roleToFree || !(alt in roleCapacity)) continue;
    const move = buildMove(occupant, entry, alt);
    const newMoves = [...entry.moves, move];
    const net = computeNetFilled(alt, newMoves, filledPerRole);
    if (net <= roleCapacity[alt]) {
      const freedRole =
        entry.moves.length === 0 ? entry.roleToFree : entry.moves[0].fromRole;
      return { freedRole, moves: newMoves };
    }
    const newUsed = new Set(entry.usedSignupIds);
    newUsed.add(occupant.signupId);
    queue.push({ roleToFree: alt, moves: newMoves, usedSignupIds: newUsed });
  }
  return null;
}

/** Computes net filled count for a role after applying pending moves. */
function computeNetFilled(
  role: string,
  moves: ChainMove[],
  filledPerRole: Record<string, number>,
): number {
  const into = moves.filter((m) => m.toRole === role).length;
  const outOf = moves.filter((m) => m.fromRole === role).length;
  return filledPerRole[role] + into - outOf;
}
