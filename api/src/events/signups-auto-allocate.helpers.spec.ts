/**
 * Tests for ROK-718: confirmed players should displace tentative occupants
 * from higher-priority roles instead of taking lower-priority open slots.
 */
import { tryDirectAllocation } from './signups-auto-allocate.helpers';
import type { AllocationContext } from './signups-allocation.helpers';

// Minimal mock tx — tryDirectAllocation calls insertAndConfirmSlot on success
function mockTx() {
  return {
    insert: jest.fn().mockReturnThis(),
    values: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
  } as unknown as Parameters<typeof tryDirectAllocation>[0];
}

const noopLogger = { log: jest.fn() };
const noopCancel = jest.fn().mockResolvedValue(undefined);

function buildCtx(
  overrides: Partial<AllocationContext> = {},
): AllocationContext {
  return {
    roleCapacity: { tank: 2, healer: 1, dps: 14 },
    filledPerRole: { tank: 0, healer: 0, dps: 0 },
    occupiedPositions: {
      tank: new Set<number>(),
      healer: new Set<number>(),
      dps: new Set<number>(),
    },
    allSignups: [],
    currentAssignments: [],
    ...overrides,
  };
}

// ── confirmed displaces tentative healer ─────────────────────────────────

function testConfirmedDefersForTentativeHealer() {
  const ctx = buildCtx({
    roleCapacity: { tank: 2, healer: 1, dps: 14 },
    filledPerRole: { tank: 0, healer: 1, dps: 0 },
    occupiedPositions: {
      tank: new Set(),
      healer: new Set([1]),
      dps: new Set(),
    },
    allSignups: [
      {
        id: 10,
        preferredRoles: ['healer', 'dps'],
        status: 'tentative',
        signedUpAt: new Date('2026-01-01'),
      },
      {
        id: 20,
        preferredRoles: ['healer', 'dps'],
        status: 'signed_up',
        signedUpAt: new Date('2026-01-02'),
      },
    ],
    currentAssignments: [
      {
        id: 100,
        signupId: 10,
        role: 'healer',
        position: 1,
        eventId: 1,
        isOverride: 0,
      },
    ],
  });
  return expect(
    tryDirectAllocation(
      mockTx(),
      1,
      20,
      ['healer', 'dps'],
      'signed_up',
      ctx,
      noopLogger,
      noopCancel,
    ),
  ).resolves.toBe(false);
}

// ── confirmed displaces tentative tank ───────────────────────────────────

function testConfirmedDefersForTentativeTank() {
  const ctx = buildCtx({
    roleCapacity: { tank: 1, healer: 2, dps: 14 },
    filledPerRole: { tank: 1, healer: 0, dps: 0 },
    occupiedPositions: {
      tank: new Set([1]),
      healer: new Set(),
      dps: new Set(),
    },
    allSignups: [
      {
        id: 10,
        preferredRoles: ['tank', 'dps'],
        status: 'tentative',
        signedUpAt: new Date('2026-01-01'),
      },
      {
        id: 20,
        preferredRoles: ['tank', 'dps'],
        status: 'signed_up',
        signedUpAt: new Date('2026-01-02'),
      },
    ],
    currentAssignments: [
      {
        id: 100,
        signupId: 10,
        role: 'tank',
        position: 1,
        eventId: 1,
        isOverride: 0,
      },
    ],
  });
  return expect(
    tryDirectAllocation(
      mockTx(),
      1,
      20,
      ['tank', 'dps'],
      'signed_up',
      ctx,
      noopLogger,
      noopCancel,
    ),
  ).resolves.toBe(false);
}

// ── tentative does NOT displace tentative ────────────────────────────────

async function testTentativeDoesNotDisplaceTentative() {
  const tx = mockTx();
  const ctx = buildCtx({
    roleCapacity: { tank: 2, healer: 1, dps: 14 },
    filledPerRole: { tank: 0, healer: 1, dps: 0 },
    occupiedPositions: {
      tank: new Set(),
      healer: new Set([1]),
      dps: new Set(),
    },
    allSignups: [
      {
        id: 10,
        preferredRoles: ['healer', 'dps'],
        status: 'tentative',
        signedUpAt: new Date('2026-01-01'),
      },
      {
        id: 20,
        preferredRoles: ['healer', 'dps'],
        status: 'tentative',
        signedUpAt: new Date('2026-01-02'),
      },
    ],
    currentAssignments: [
      {
        id: 100,
        signupId: 10,
        role: 'healer',
        position: 1,
        eventId: 1,
        isOverride: 0,
      },
    ],
  });
  // Tentative player should take the open DPS slot directly, not defer
  const result = await tryDirectAllocation(
    tx,
    1,
    20,
    ['healer', 'dps'],
    'tentative',
    ctx,
    noopLogger,
    noopCancel,
  );
  expect(result).toBe(true);
}

// ── no displacement when no tentative occupant ───────────────────────────

async function testNoDisplacementWhenNoTentative() {
  const tx = mockTx();
  const ctx = buildCtx({
    roleCapacity: { tank: 2, healer: 1, dps: 14 },
    filledPerRole: { tank: 0, healer: 1, dps: 0 },
    occupiedPositions: {
      tank: new Set(),
      healer: new Set([1]),
      dps: new Set(),
    },
    allSignups: [
      {
        id: 10,
        preferredRoles: ['healer'],
        status: 'signed_up',
        signedUpAt: new Date('2026-01-01'),
      },
      {
        id: 20,
        preferredRoles: ['healer', 'dps'],
        status: 'signed_up',
        signedUpAt: new Date('2026-01-02'),
      },
    ],
    currentAssignments: [
      {
        id: 100,
        signupId: 10,
        role: 'healer',
        position: 1,
        eventId: 1,
        isOverride: 0,
      },
    ],
  });
  // No tentative in healer — confirmed player should take open DPS directly
  const result = await tryDirectAllocation(
    tx,
    1,
    20,
    ['healer', 'dps'],
    'signed_up',
    ctx,
    noopLogger,
    noopCancel,
  );
  expect(result).toBe(true);
}

// ── direct allocation still works for open first-choice ──────────────────

async function testDirectAllocToOpenFirstChoice() {
  const tx = mockTx();
  const ctx = buildCtx({
    roleCapacity: { tank: 2, healer: 1, dps: 14 },
    filledPerRole: { tank: 0, healer: 0, dps: 0 },
    occupiedPositions: {
      tank: new Set(),
      healer: new Set(),
      dps: new Set(),
    },
    allSignups: [
      {
        id: 20,
        preferredRoles: ['healer', 'dps'],
        status: 'signed_up',
        signedUpAt: new Date('2026-01-01'),
      },
    ],
    currentAssignments: [],
  });
  const result = await tryDirectAllocation(
    tx,
    1,
    20,
    ['healer', 'dps'],
    'signed_up',
    ctx,
    noopLogger,
    noopCancel,
  );
  expect(result).toBe(true);
}

describe('tryDirectAllocation — ROK-718 tentative displacement priority', () => {
  it('confirmed player defers to tentative displacement for healer', () =>
    testConfirmedDefersForTentativeHealer());

  it('confirmed player defers to tentative displacement for tank', () =>
    testConfirmedDefersForTentativeTank());

  it('tentative player does NOT defer (takes open DPS directly)', () =>
    testTentativeDoesNotDisplaceTentative());

  it('confirmed player takes open DPS when healer occupant is not tentative', () =>
    testNoDisplacementWhenNoTentative());

  it('confirmed player takes open first-choice role directly', () =>
    testDirectAllocToOpenFirstChoice());
});
