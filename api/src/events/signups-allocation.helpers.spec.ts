/**
 * Unit tests for pure helper functions in signups-allocation.helpers.ts (ROK-825).
 *
 * All functions are stateless — no DB or NestJS DI required.
 * Tests cover role capacity extraction, fill tracking, position management,
 * tentative occupant detection, role-change diffing, promotion warnings,
 * and the BFS rearrangement chain solver.
 */
import {
  extractRoleCapacity,
  countFilledPerRole,
  buildOccupiedPositions,
  findFirstAvailableInSet,
  findFirstGap,
  findOldestTentativeOccupant,
  findRoleChanges,
  buildPromotionWarnings,
  bfsRearrangementChain,
} from './signups-allocation.helpers';

// ─── extractRoleCapacity ──────────────────────────────────────────────────

describe('extractRoleCapacity', () => {
  it('extracts tank, healer, dps from slotConfig', () => {
    const result = extractRoleCapacity({ tank: 2, healer: 4, dps: 14 });
    expect(result).toEqual({ tank: 2, healer: 4, dps: 14 });
  });

  it('uses defaults when slotConfig is null', () => {
    const result = extractRoleCapacity(null);
    expect(result).toEqual({ tank: 2, healer: 4, dps: 14 });
  });

  it('uses defaults for missing role keys', () => {
    const result = extractRoleCapacity({ tank: 1 });
    expect(result).toEqual({ tank: 1, healer: 4, dps: 14 });
  });

  it('uses defaults for all roles when slotConfig is empty object', () => {
    const result = extractRoleCapacity({});
    expect(result).toEqual({ tank: 2, healer: 4, dps: 14 });
  });

  it('ignores unrelated keys in slotConfig', () => {
    const result = extractRoleCapacity({
      tank: 1,
      healer: 2,
      dps: 3,
      type: 'mmo',
      bench: 5,
    });
    expect(result).toEqual({ tank: 1, healer: 2, dps: 3 });
  });

  it('handles zero capacity slots', () => {
    const result = extractRoleCapacity({ tank: 0, healer: 0, dps: 0 });
    expect(result).toEqual({ tank: 0, healer: 0, dps: 0 });
  });
});

// ─── countFilledPerRole ──────────────────────────────────────────────────

describe('countFilledPerRole', () => {
  it('counts assignments by role', () => {
    const assignments = [
      { role: 'tank' },
      { role: 'tank' },
      { role: 'healer' },
      { role: 'dps' },
      { role: 'dps' },
      { role: 'dps' },
    ];
    const result = countFilledPerRole(assignments);
    expect(result).toEqual({ tank: 2, healer: 1, dps: 3 });
  });

  it('returns zero counts when assignments is empty', () => {
    const result = countFilledPerRole([]);
    expect(result).toEqual({ tank: 0, healer: 0, dps: 0 });
  });

  it('ignores assignments with null role', () => {
    const assignments = [{ role: null }, { role: 'tank' }, { role: null }];
    const result = countFilledPerRole(assignments);
    expect(result).toEqual({ tank: 1, healer: 0, dps: 0 });
  });

  it('ignores unknown roles like bench', () => {
    const assignments = [{ role: 'bench' }, { role: 'tank' }];
    const result = countFilledPerRole(assignments);
    expect(result).toEqual({ tank: 1, healer: 0, dps: 0 });
  });
});

// ─── buildOccupiedPositions ──────────────────────────────────────────────

describe('buildOccupiedPositions', () => {
  it('collects position numbers per role', () => {
    const assignments = [
      { role: 'tank', position: 1 },
      { role: 'tank', position: 2 },
      { role: 'healer', position: 1 },
      { role: 'dps', position: 3 },
    ];
    const result = buildOccupiedPositions(assignments);
    expect(result.tank).toEqual(new Set([1, 2]));
    expect(result.healer).toEqual(new Set([1]));
    expect(result.dps).toEqual(new Set([3]));
  });

  it('returns empty sets for all roles when assignments is empty', () => {
    const result = buildOccupiedPositions([]);
    expect(result.tank).toEqual(new Set());
    expect(result.healer).toEqual(new Set());
    expect(result.dps).toEqual(new Set());
  });

  it('ignores null role assignments', () => {
    const assignments = [{ role: null, position: 1 }];
    const result = buildOccupiedPositions(assignments);
    expect(result.tank).toEqual(new Set());
    expect(result.healer).toEqual(new Set());
    expect(result.dps).toEqual(new Set());
  });

  it('ignores unknown roles', () => {
    const assignments = [{ role: 'bench', position: 1 }];
    const result = buildOccupiedPositions(assignments);
    expect(result.tank).toEqual(new Set());
  });
});

// ─── findFirstAvailableInSet ─────────────────────────────────────────────

describe('findFirstAvailableInSet', () => {
  it('returns 1 when set is empty', () => {
    expect(findFirstAvailableInSet(new Set())).toBe(1);
  });

  it('returns 1 when undefined is passed', () => {
    expect(findFirstAvailableInSet(undefined)).toBe(1);
  });

  it('returns 2 when position 1 is taken', () => {
    expect(findFirstAvailableInSet(new Set([1]))).toBe(2);
  });

  it('finds first gap in consecutive occupied positions', () => {
    expect(findFirstAvailableInSet(new Set([1, 2, 3]))).toBe(4);
  });

  it('finds gap in sparse occupied positions', () => {
    expect(findFirstAvailableInSet(new Set([1, 3, 4]))).toBe(2);
  });

  it('handles large dense sets', () => {
    const positions = new Set<number>();
    for (let i = 1; i <= 20; i++) positions.add(i);
    expect(findFirstAvailableInSet(positions)).toBe(21);
  });
});

// ─── findFirstGap ─────────────────────────────────────────────────────────

describe('findFirstGap', () => {
  it('returns 1 for empty array', () => {
    expect(findFirstGap([])).toBe(1);
  });

  it('returns 2 when position 1 is taken', () => {
    expect(findFirstGap([1])).toBe(2);
  });

  it('finds first gap in consecutive positions', () => {
    expect(findFirstGap([1, 2, 3])).toBe(4);
  });

  it('finds gap in sparse positions', () => {
    expect(findFirstGap([1, 3, 4])).toBe(2);
  });

  it('handles duplicate positions gracefully', () => {
    expect(findFirstGap([1, 1, 2, 2])).toBe(3);
  });
});

// ─── findOldestTentativeOccupant ─────────────────────────────────────────

describe('findOldestTentativeOccupant', () => {
  it('returns null when no assignments exist for the role', () => {
    const result = findOldestTentativeOccupant([], 'tank', new Map());
    expect(result).toBeNull();
  });

  it('returns null when all occupants are confirmed', () => {
    const assignments = [
      {
        id: 1,
        signupId: 10,
        role: 'tank',
        position: 1,
        eventId: 1,
        isOverride: 0,
      },
    ];
    const signupById = new Map([
      [10, { status: 'signed_up', signedUpAt: new Date('2026-01-01') }],
    ]);
    const result = findOldestTentativeOccupant(assignments, 'tank', signupById);
    expect(result).toBeNull();
  });

  it('returns the tentative occupant when present', () => {
    const assignments = [
      {
        id: 1,
        signupId: 10,
        role: 'tank',
        position: 1,
        eventId: 1,
        isOverride: 0,
      },
    ];
    const signupById = new Map([
      [10, { status: 'tentative', signedUpAt: new Date('2026-01-01') }],
    ]);
    const result = findOldestTentativeOccupant(assignments, 'tank', signupById);
    expect(result).not.toBeNull();
    expect(result.signupId).toBe(10);
  });

  it('returns the oldest tentative occupant when multiple exist', () => {
    const assignments = [
      {
        id: 1,
        signupId: 10,
        role: 'tank',
        position: 1,
        eventId: 1,
        isOverride: 0,
      },
      {
        id: 2,
        signupId: 20,
        role: 'tank',
        position: 2,
        eventId: 1,
        isOverride: 0,
      },
    ];
    const signupById = new Map([
      [10, { status: 'tentative', signedUpAt: new Date('2026-01-02') }],
      [20, { status: 'tentative', signedUpAt: new Date('2026-01-01') }],
    ]);
    const result = findOldestTentativeOccupant(assignments, 'tank', signupById);
    expect(result.signupId).toBe(20);
  });

  it('ignores assignments for different roles', () => {
    const assignments = [
      {
        id: 1,
        signupId: 10,
        role: 'healer',
        position: 1,
        eventId: 1,
        isOverride: 0,
      },
    ];
    const signupById = new Map([
      [10, { status: 'tentative', signedUpAt: new Date('2026-01-01') }],
    ]);
    const result = findOldestTentativeOccupant(assignments, 'tank', signupById);
    expect(result).toBeNull();
  });

  it('handles signup not found in map (treats as non-tentative)', () => {
    const assignments = [
      {
        id: 1,
        signupId: 99,
        role: 'tank',
        position: 1,
        eventId: 1,
        isOverride: 0,
      },
    ];
    const result = findOldestTentativeOccupant(assignments, 'tank', new Map());
    expect(result).toBeNull();
  });
});

// ─── findRoleChanges ─────────────────────────────────────────────────────

describe('findRoleChanges', () => {
  it('returns empty array when no role changes exist', () => {
    const before = [{ id: 1, signupId: 10, role: 'tank', position: 1 }];
    const after = [{ id: 1, signupId: 10, role: 'tank', position: 1 }];
    expect(findRoleChanges(before, after, 0)).toHaveLength(0);
  });

  it('detects a role change from tank to healer', () => {
    const before = [{ id: 1, signupId: 10, role: 'tank', position: 1 }];
    const after = [{ id: 1, signupId: 10, role: 'healer', position: 1 }];
    const changes = findRoleChanges(before, after, 0);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      signupId: 10,
      fromRole: 'tank',
      toRole: 'healer',
    });
  });

  it('excludes the specified signupId from changes', () => {
    const before = [{ id: 1, signupId: 10, role: 'tank', position: 1 }];
    const after = [{ id: 1, signupId: 10, role: 'healer', position: 1 }];
    expect(findRoleChanges(before, after, 10)).toHaveLength(0);
  });

  it('handles null roles as unknown string', () => {
    const before = [{ id: 1, signupId: 10, role: null, position: 1 }];
    const after = [{ id: 1, signupId: 10, role: 'tank', position: 1 }];
    const changes = findRoleChanges(before, after, 0);
    expect(changes).toHaveLength(1);
    expect(changes[0].fromRole).toBe('unknown');
    expect(changes[0].toRole).toBe('tank');
  });

  it('ignores signups not present in before snapshot', () => {
    const before: typeof after = [];
    const after = [{ id: 1, signupId: 10, role: 'tank', position: 1 }];
    expect(findRoleChanges(before, after, 0)).toHaveLength(0);
  });

  it('detects multiple simultaneous role changes', () => {
    const before = [
      { id: 1, signupId: 10, role: 'tank', position: 1 },
      { id: 2, signupId: 20, role: 'healer', position: 1 },
    ];
    const after = [
      { id: 1, signupId: 10, role: 'dps', position: 1 },
      { id: 2, signupId: 20, role: 'tank', position: 1 },
    ];
    const changes = findRoleChanges(before, after, 0);
    expect(changes).toHaveLength(2);
  });
});

// ─── buildPromotionWarnings ──────────────────────────────────────────────

describe('buildPromotionWarnings', () => {
  it('returns empty array when assigned role is in preferred roles', () => {
    const warnings = buildPromotionWarnings(
      'user1',
      ['tank', 'dps'],
      'tank',
      [],
    );
    expect(warnings).toHaveLength(0);
  });

  it('warns when assigned role is not in preferred roles', () => {
    const warnings = buildPromotionWarnings('user1', ['tank'], 'healer', []);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('user1');
    expect(warnings[0]).toContain('healer');
    expect(warnings[0]).toContain('tank');
  });

  it('returns empty array when preferredRoles is null', () => {
    const warnings = buildPromotionWarnings('user1', null, 'tank', []);
    expect(warnings).toHaveLength(0);
  });

  it('returns empty array when preferredRoles is empty', () => {
    const warnings = buildPromotionWarnings('user1', [], 'dps', []);
    expect(warnings).toHaveLength(0);
  });

  it('returns empty array when assignedRole is null', () => {
    const warnings = buildPromotionWarnings('user1', ['tank'], null, []);
    expect(warnings).toHaveLength(0);
  });

  it('includes chain move messages', () => {
    const chainMoves = [
      { signupId: 1, username: 'mover', fromRole: 'dps', toRole: 'healer' },
    ];
    const warnings = buildPromotionWarnings(
      'user1',
      ['tank'],
      'tank',
      chainMoves,
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('mover');
    expect(warnings[0]).toContain('dps');
    expect(warnings[0]).toContain('healer');
  });

  it('includes both mismatch and chain move warnings', () => {
    const chainMoves = [
      { signupId: 1, username: 'mover', fromRole: 'tank', toRole: 'dps' },
    ];
    const warnings = buildPromotionWarnings(
      'user1',
      ['healer'],
      'tank',
      chainMoves,
    );
    expect(warnings).toHaveLength(2);
  });
});

// ─── bfsRearrangementChain ───────────────────────────────────────────────

describe('bfsRearrangementChain', () => {
  it('returns null when no rearrangement is possible', () => {
    // New player prefers tank, but tank is full and the occupant has no alt roles
    const result = bfsRearrangementChain(
      ['tank'],
      [{ id: 1, signupId: 10, role: 'tank', position: 1 }],
      [{ id: 10, preferredRoles: ['tank'] }],
      { tank: 1, healer: 2, dps: 3 },
      { tank: 1, healer: 0, dps: 0 },
    );
    expect(result).toBeNull();
  });

  it('returns null when preferences are for unknown roles', () => {
    const result = bfsRearrangementChain(
      ['support'],
      [],
      [],
      { tank: 1, healer: 2, dps: 3 },
      { tank: 0, healer: 0, dps: 0 },
    );
    expect(result).toBeNull();
  });

  it('returns null when no current assignments exist', () => {
    // No one to rearrange
    const result = bfsRearrangementChain(
      ['tank'],
      [],
      [],
      { tank: 1, healer: 1, dps: 3 },
      { tank: 1, healer: 0, dps: 0 },
    );
    expect(result).toBeNull();
  });

  it('finds a 1-step chain when occupant can move to open role', () => {
    // Tank occupant (signup 10) can move to dps (open); frees tank for new player
    const result = bfsRearrangementChain(
      ['tank'],
      [{ id: 1, signupId: 10, role: 'tank', position: 1 }],
      [{ id: 10, preferredRoles: ['tank', 'dps'] }],
      { tank: 1, healer: 1, dps: 3 },
      { tank: 1, healer: 0, dps: 0 },
    );
    expect(result).not.toBeNull();
    expect(result!.freedRole).toBe('tank');
    expect(result!.moves).toHaveLength(1);
    expect(result!.moves[0]).toMatchObject({
      signupId: 10,
      fromRole: 'tank',
      toRole: 'dps',
    });
  });

  it('returns null when newPrefs array is empty', () => {
    const result = bfsRearrangementChain(
      [],
      [{ id: 1, signupId: 10, role: 'tank', position: 1 }],
      [{ id: 10, preferredRoles: ['tank', 'dps'] }],
      { tank: 1, healer: 1, dps: 3 },
      { tank: 1, healer: 0, dps: 0 },
    );
    expect(result).toBeNull();
  });

  it('returns null when occupant has only one preferred role', () => {
    // tryOccupantMoves returns null for prefs.length <= 1
    const result = bfsRearrangementChain(
      ['tank'],
      [{ id: 1, signupId: 10, role: 'tank', position: 1 }],
      [{ id: 10, preferredRoles: ['tank'] }],
      { tank: 1, healer: 2, dps: 3 },
      { tank: 1, healer: 0, dps: 0 },
    );
    expect(result).toBeNull();
  });

  it('returns null when chain depth would exceed MAX_DEPTH without a solution', () => {
    // 4 roles all full, each occupant only willing to move to the next role.
    // Any rearrangement chain would require more than 3 steps and cannot close.
    // We add a 4th role 'flex' to force a chain longer than MAX_DEPTH = 3.
    const result = bfsRearrangementChain(
      ['tank'],
      [
        { id: 1, signupId: 10, role: 'tank', position: 1 },
        { id: 2, signupId: 20, role: 'dps', position: 1 },
        { id: 3, signupId: 30, role: 'healer', position: 1 },
        { id: 4, signupId: 40, role: 'dps', position: 2 },
      ],
      [
        { id: 10, preferredRoles: ['tank', 'dps'] },
        // signup 20 can only move to 'flex' which is not in roleCapacity
        { id: 20, preferredRoles: ['dps', 'flex'] },
        { id: 30, preferredRoles: ['healer', 'dps'] },
        { id: 40, preferredRoles: ['dps', 'healer'] },
      ],
      { tank: 1, healer: 1, dps: 2 },
      { tank: 1, healer: 1, dps: 2 },
    );
    // flex role is not in roleCapacity so chains through dps occupants
    // cannot free a slot — should return null
    expect(result).toBeNull();
  });

  it('does not mutate the input newPrefs array', () => {
    const newPrefs = ['tank', 'dps'];
    const originalPrefs = [...newPrefs];
    bfsRearrangementChain(
      newPrefs,
      [],
      [],
      { tank: 1, dps: 3 },
      { tank: 0, dps: 0 },
    );
    expect(newPrefs).toEqual(originalPrefs);
  });
});
