/**
 * Auto-allocation standalone helpers for SignupsService.
 * Contains BFS chain rearrangement, role capacity, and slot-finding utilities.
 * Extracted from signups.service.ts for file size compliance (ROK-719).
 */
import type {
  OccupantMovesParams,
  ChainMoveEntryType,
  BfsEntryType,
  BfsSignupType,
} from './signups.service.types';

/** Context for auto-allocation algorithm. */
export interface AllocationContext {
  roleCapacity: Record<string, number>;
  allSignups: Array<{
    id: number;
    preferredRoles: string[] | null;
    status: string;
    signedUpAt: Date | null;
  }>;
  currentAssignments: Array<{
    id: number;
    signupId: number;
    role: string | null;
    position: number;
    eventId: number;
    isOverride: number;
  }>;
  filledPerRole: Record<string, number>;
  occupiedPositions: Record<string, Set<number>>;
}

/** Shared result type for bench promotion methods. */
export interface PromotionResult {
  role: string;
  position: number;
  username: string;
  chainMoves?: string[];
  warning?: string;
}

/** Snapshot of a roster assignment for chain-move detection. */
export type RosterSnapshot = {
  id: number;
  signupId: number;
  role: string | null;
  position: number;
};

/** Chain move detection result. */
export interface ChainMove {
  signupId: number;
  username: string;
  fromRole: string;
  toRole: string;
}

/** A chain move in the BFS rearrangement solver. */
export interface ChainMoveEntry {
  assignmentId: number;
  signupId: number;
  fromRole: string;
  toRole: string;
  position: number;
}

/** Result from the BFS rearrangement chain solver. */
export type RearrangementChainResult = {
  freedRole: string;
  moves: ChainMoveEntry[];
};

export function extractRoleCapacity(
  slotConfig: Record<string, unknown> | null,
): Record<string, number> {
  return {
    tank: (slotConfig?.tank as number) ?? 2,
    healer: (slotConfig?.healer as number) ?? 4,
    dps: (slotConfig?.dps as number) ?? 14,
  };
}

export function countFilledPerRole(
  assignments: Array<{ role: string | null }>,
): Record<string, number> {
  const filled: Record<string, number> = { tank: 0, healer: 0, dps: 0 };
  for (const a of assignments) {
    if (a.role && a.role in filled) filled[a.role]++;
  }
  return filled;
}

export function buildOccupiedPositions(
  assignments: Array<{ role: string | null; position: number }>,
): Record<string, Set<number>> {
  const occupied: Record<string, Set<number>> = {
    tank: new Set(),
    healer: new Set(),
    dps: new Set(),
  };
  for (const a of assignments) {
    if (a.role && a.role in occupied) occupied[a.role].add(a.position);
  }
  return occupied;
}

export function findFirstAvailableInSet(
  occupied: Set<number> | undefined,
): number {
  const set = occupied ?? new Set<number>();
  for (let pos = 1; ; pos++) {
    if (!set.has(pos)) return pos;
  }
}

export function findFirstGap(positions: number[]): number {
  const occupied = new Set(positions);
  let pos = 1;
  while (occupied.has(pos)) pos++;
  return pos;
}

export function findOldestTentativeOccupant(
  assignments: Array<{
    id: number;
    signupId: number;
    role: string | null;
    position: number;
  }>,
  role: string,
  signupById: Map<number, { status: string; signedUpAt: Date | null }>,
) {
  const tentative = assignments
    .filter(
      (a) =>
        a.role === role && signupById.get(a.signupId)?.status === 'tentative',
    )
    .sort((a, b) => {
      const aTime = signupById.get(a.signupId)?.signedUpAt?.getTime() ?? 0;
      const bTime = signupById.get(b.signupId)?.signedUpAt?.getTime() ?? 0;
      return aTime - bTime;
    });
  return tentative[0] ?? null;
}

export function findRoleChanges(
  before: RosterSnapshot[],
  after: RosterSnapshot[],
  excludeSignupId: number,
): Array<{ signupId: number; fromRole: string; toRole: string }> {
  const beforeMap = new Map(before.map((a) => [a.signupId, a]));
  const changes: Array<{
    signupId: number;
    fromRole: string;
    toRole: string;
  }> = [];
  for (const afterEntry of after) {
    if (afterEntry.signupId === excludeSignupId) continue;
    const beforeEntry = beforeMap.get(afterEntry.signupId);
    if (!beforeEntry || beforeEntry.role === afterEntry.role) continue;
    changes.push({
      signupId: afterEntry.signupId,
      fromRole: beforeEntry.role ?? 'unknown',
      toRole: afterEntry.role ?? 'unknown',
    });
  }
  return changes;
}

export function buildPromotionWarnings(
  username: string,
  preferredRoles: string[] | null,
  assignedRole: string | null,
  chainMoves: ChainMove[],
): string[] {
  const warnings: string[] = [];
  const prefs = preferredRoles ?? [];
  if (prefs.length > 0 && assignedRole && !prefs.includes(assignedRole)) {
    warnings.push(
      `${username} was placed in **${assignedRole}** which is not in their preferred roles (${prefs.join(', ')}).`,
    );
  }
  for (const move of chainMoves) {
    warnings.push(
      `${move.username} moved from **${move.fromRole}** to **${move.toRole}** to accommodate the promotion.`,
    );
  }
  return warnings;
}

/**
 * BFS chain rearrangement solver for auto-allocation.
 * Max depth: 3 (prevents combinatorial explosion for large rosters).
 */
export function bfsRearrangementChain(
  newPrefs: string[],
  currentAssignments: Array<{
    id: number;
    signupId: number;
    role: string | null;
    position: number;
  }>,
  allSignups: Array<{ id: number; preferredRoles: string[] | null }>,
  roleCapacity: Record<string, number>,
  filledPerRole: Record<string, number>,
): RearrangementChainResult | null {
  const MAX_DEPTH = 3;
  const queue = seedBfsQueue(newPrefs, roleCapacity);

  while (queue.length > 0) {
    const entry = queue.shift()!;
    if (entry.moves.length >= MAX_DEPTH) continue;

    const result = processBfsEntry(
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

function seedBfsQueue(
  newPrefs: string[],
  roleCapacity: Record<string, number>,
): BfsEntryType[] {
  return newPrefs
    .filter((pref) => pref in roleCapacity)
    .map((pref) => ({
      roleToFree: pref,
      moves: [],
      usedSignupIds: new Set<number>(),
    }));
}

function processBfsEntry(
  entry: BfsEntryType,
  currentAssignments: Array<{
    id: number;
    signupId: number;
    role: string | null;
    position: number;
  }>,
  allSignups: BfsSignupType[],
  roleCapacity: Record<string, number>,
  filledPerRole: Record<string, number>,
  queue: BfsEntryType[],
): RearrangementChainResult | null {
  const occupants = currentAssignments.filter(
    (a) => a.role === entry.roleToFree && !entry.usedSignupIds.has(a.signupId),
  );

  for (const occupant of occupants) {
    const result = tryOccupantMoves({
      occupant,
      entry,
      allSignups,
      roleCapacity,
      filledPerRole,
      queue,
    });
    if (result) return result;
  }
  return null;
}

function tryOccupantMoves(
  p: OccupantMovesParams,
): RearrangementChainResult | null {
  const { occupant, entry, allSignups, roleCapacity, filledPerRole, queue } = p;
  const prefs =
    allSignups.find((s) => s.id === occupant.signupId)?.preferredRoles ?? [];
  if (prefs.length <= 1) return null;

  for (const altRole of prefs) {
    if (altRole === entry.roleToFree || !(altRole in roleCapacity)) continue;

    const move = buildChainMove(occupant, entry.roleToFree, altRole);
    const newMoves = [...entry.moves, move];
    const netFilled = computeNetFilled(
      newMoves,
      altRole,
      filledPerRole[altRole],
    );

    if (netFilled <= roleCapacity[altRole]) {
      const freedRole =
        entry.moves.length === 0 ? entry.roleToFree : entry.moves[0].fromRole;
      return { freedRole, moves: newMoves };
    }

    const newUsed = new Set([...entry.usedSignupIds, occupant.signupId]);
    queue.push({
      roleToFree: altRole,
      moves: newMoves,
      usedSignupIds: newUsed,
    });
  }
  return null;
}

function buildChainMove(
  occupant: { id: number; signupId: number; position: number },
  fromRole: string,
  toRole: string,
): ChainMoveEntryType {
  return {
    assignmentId: occupant.id,
    signupId: occupant.signupId,
    fromRole,
    toRole,
    position: occupant.position,
  };
}

function computeNetFilled(
  moves: ChainMoveEntryType[],
  altRole: string,
  baseFilled: number,
): number {
  const into = moves.filter((m) => m.toRole === altRole).length;
  const outOf = moves.filter((m) => m.fromRole === altRole).length;
  return baseFilled + into - outOf;
}
