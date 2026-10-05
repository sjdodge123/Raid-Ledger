/**
 * Unit tests for ROK-626: bench fallback when roster is full.
 * Tests checkAutoBench for MMO events with slotConfig,
 * and bench fallback in Discord/web/PUG signup flows.
 */
import { checkAutoBench, checkSignupAutoBench } from './signups-signup.helpers';
import {
  displaceableRoles,
  hasDisplaceableTentative,
} from './signups-tentative-capacity.helpers';
import { isRosterFull } from './signups-auto-allocate.helpers';
import type { AllocationContext } from './signups-allocation.helpers';
import type { Tx, EventRow } from './signups.service.types';

function mockTx(nonBenchCount: number) {
  return {
    select: jest.fn().mockReturnValue({
      from: jest.fn().mockReturnValue({
        innerJoin: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([{ count: nonBenchCount }]),
        }),
      }),
    }),
  } as unknown as Parameters<typeof checkAutoBench>[0];
}

describe('checkAutoBench — MMO slotConfig support (ROK-626)', () => {
  it('should return true when MMO role slots are full', async () => {
    const eventRow = {
      maxAttendees: null,
      slotConfig: { type: 'mmo', tank: 2, healer: 2, dps: 4, flex: 2 },
    } as Parameters<typeof checkAutoBench>[1];
    // 2+2+4+2 = 10 total role slots, 10 filled = full
    const result = await checkAutoBench(mockTx(10), eventRow, 1);
    expect(result).toBe(true);
  });

  it('should return false when MMO role slots have room', async () => {
    const eventRow = {
      maxAttendees: null,
      slotConfig: { type: 'mmo', tank: 2, healer: 2, dps: 4, flex: 2 },
    } as Parameters<typeof checkAutoBench>[1];
    // 10 total role slots, only 8 filled = not full
    const result = await checkAutoBench(mockTx(8), eventRow, 1);
    expect(result).toBe(false);
  });

  it('should return false when dto already requests bench', async () => {
    const eventRow = {
      maxAttendees: null,
      slotConfig: { type: 'mmo', tank: 2, healer: 2, dps: 4, flex: 2 },
    } as Parameters<typeof checkAutoBench>[1];
    const result = await checkAutoBench(mockTx(10), eventRow, 1, {
      slotRole: 'bench',
    });
    expect(result).toBe(false);
  });

  it('should still work with maxAttendees (existing behavior)', async () => {
    const eventRow = {
      maxAttendees: 5,
      slotConfig: null,
    } as Parameters<typeof checkAutoBench>[1];
    const result = await checkAutoBench(mockTx(5), eventRow, 1);
    expect(result).toBe(true);
  });

  it('should return false for generic events without maxAttendees or slotConfig', async () => {
    const eventRow = {
      maxAttendees: null,
      slotConfig: null,
    } as Parameters<typeof checkAutoBench>[1];
    const result = await checkAutoBench(mockTx(0), eventRow, 1);
    expect(result).toBe(false);
  });

  it('should return false for generic slotConfig type', async () => {
    const eventRow = {
      maxAttendees: null,
      slotConfig: { type: 'generic', player: 5, bench: 2 },
    } as Parameters<typeof checkAutoBench>[1];
    // Generic events use player slots, not MMO roles.
    // checkAutoBench should support this via player capacity sum.
    const result = await checkAutoBench(mockTx(5), eventRow, 1);
    expect(result).toBe(true);
  });
});

// ─── ROK-1729: full-roster tentative displacement predicate ─────────────────

type Chain = Record<string, unknown>;

/** Each `select()` resolves to the next queued result set, in call order. */
function seqTx(results: unknown[][]) {
  const queue = [...results];
  const select = jest.fn(() => {
    const rows = queue.shift() ?? [];
    const chain: Chain = {};
    for (const m of ['from', 'innerJoin', 'where', 'limit'])
      chain[m] = jest.fn(() => chain);
    chain.then = (ok: (v: unknown) => unknown, err: (e: unknown) => unknown) =>
      Promise.resolve(rows).then(ok, err);
    return chain;
  });
  return { tx: { select } as unknown as Tx, select };
}

const FULL_MMO = {
  maxAttendees: null,
  slotConfig: { type: 'mmo', tank: 1, healer: 1, dps: 3, flex: 0 },
} as EventRow;
const GENERIC = {
  maxAttendees: null,
  slotConfig: { type: 'generic', player: 5 },
} as EventRow;

describe('displaceableRoles (ROK-1729)', () => {
  it('prefers preferredRoles over slotRole and drops non-MMO roles', () => {
    expect({
      prefs: displaceableRoles({ preferredRoles: ['dps'], slotRole: 'tank' }),
      slot: displaceableRoles({ slotRole: 'healer' }),
      flex: displaceableRoles({ slotRole: 'flex' }),
      none: displaceableRoles({}),
    }).toEqual({ prefs: ['dps'], slot: ['healer'], flex: [], none: [] });
  });
});

describe('hasDisplaceableTentative (ROK-1729)', () => {
  it('is false for a non-MMO event without querying', async () => {
    const { tx, select } = seqTx([[{ id: 1 }]]);
    const r = await hasDisplaceableTentative(
      tx,
      GENERIC,
      1,
      { slotRole: 'player' },
      7,
    );
    expect({ r, queries: select.mock.calls.length }).toEqual({
      r: false,
      queries: 0,
    });
  });

  it('is false for a bench request or no tank/healer/dps preference', async () => {
    const { tx, select } = seqTx([[{ id: 1 }], [{ id: 1 }]]);
    const bench = await hasDisplaceableTentative(
      tx,
      FULL_MMO,
      1,
      { slotRole: 'bench' },
      7,
    );
    const noRoles = await hasDisplaceableTentative(tx, FULL_MMO, 1, {}, 7);
    expect({ bench, noRoles, queries: select.mock.calls.length }).toEqual({
      bench: false,
      noRoles: false,
      queries: 0,
    });
  });

  it('is false when the incoming user is already tentative on the event', async () => {
    const { tx, select } = seqTx([[{ id: 3 }], [{ id: 9 }]]);
    const r = await hasDisplaceableTentative(
      tx,
      FULL_MMO,
      1,
      { preferredRoles: ['dps'] },
      7,
    );
    expect({ r, queries: select.mock.calls.length }).toEqual({
      r: false,
      queries: 1,
    });
  });

  it('is true when a tentative player holds a preferred role', async () => {
    const { tx } = seqTx([[], [{ id: 9 }]]);
    const r = await hasDisplaceableTentative(
      tx,
      FULL_MMO,
      1,
      { preferredRoles: ['tank', 'dps'] },
      7,
    );
    expect(r).toBe(true);
  });

  it('is false when no tentative player holds a preferred role', async () => {
    const { tx } = seqTx([[], []]);
    const r = await hasDisplaceableTentative(
      tx,
      FULL_MMO,
      1,
      { preferredRoles: ['dps'] },
      7,
    );
    expect(r).toBe(false);
  });
});

describe('checkSignupAutoBench (ROK-1729)', () => {
  const base = { eventRow: FULL_MMO, eventId: 1, userId: 7 };

  it('does NOT bench a confirmed newcomer on a full roster with a displaceable tentative', async () => {
    const { tx } = seqTx([[{ count: 5 }], [], [{ id: 9 }]]);
    const autoBench = await checkSignupAutoBench({
      ...base,
      tx,
      dto: { preferredRoles: ['dps'] },
    });
    expect(autoBench).toBe(false);
  });

  it('benches on a full roster with no displaceable tentative', async () => {
    const { tx } = seqTx([[{ count: 5 }], [], []]);
    const autoBench = await checkSignupAutoBench({
      ...base,
      tx,
      dto: { preferredRoles: ['dps'] },
    });
    expect(autoBench).toBe(true);
  });

  it('skips the tentative lookup when the roster has room or there is no dto', async () => {
    const room = seqTx([[{ count: 4 }]]);
    const noDto = seqTx([[{ count: 5 }]]);
    const r = {
      room: await checkSignupAutoBench({
        ...base,
        tx: room.tx,
        dto: { preferredRoles: ['dps'] },
      }),
      noDto: await checkSignupAutoBench({
        ...base,
        tx: noDto.tx,
        dto: undefined,
      }),
    };
    expect({
      ...r,
      queries: [room.select.mock.calls.length, noDto.select.mock.calls.length],
    }).toEqual({ room: false, noDto: true, queries: [1, 1] });
  });
});

describe('isRosterFull (ROK-1729)', () => {
  const slot = (role: string | null, position: number) => ({
    id: position,
    signupId: position,
    role,
    position,
    eventId: 1,
    isOverride: 0,
  });
  const ctx = (
    totalCapacity: number | null,
    roles: Array<string | null>,
  ): AllocationContext => ({
    roleCapacity: { tank: 1, healer: 1, dps: 3 },
    allSignups: [],
    currentAssignments: roles.map((r, i) => slot(r, i + 1)),
    filledPerRole: {},
    occupiedPositions: {},
    totalCapacity,
  });

  it('counts only non-bench, non-null assignments against total capacity', () => {
    const five = ['tank', 'healer', 'dps', 'dps', 'dps'];
    expect({
      full: isRosterFull(ctx(5, five)),
      benchIgnored: isRosterFull(
        ctx(5, ['tank', 'dps', 'bench', 'bench', null]),
      ),
      unbounded: isRosterFull(ctx(null, five)),
    }).toEqual({ full: true, benchIgnored: false, unbounded: false });
  });
});
