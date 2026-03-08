/**
 * Adversarial tests for ROK-626: computeSlotCapacity and checkAutoBench edge cases.
 * Covers zero capacity, missing fields, boundary values, and generic slotConfig.
 */
import {
  computeSlotCapacity,
  checkAutoBench,
  shouldUseAutoAllocation,
  shouldUseAutoAllocationNew,
  isCancelledStatus,
} from './signups-signup.helpers';

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

type EventRow = Parameters<typeof checkAutoBench>[1];

describe('computeSlotCapacity', () => {
  it('returns sum of tank/healer/dps/flex for MMO type', () => {
    const result = computeSlotCapacity({
      type: 'mmo',
      tank: 1,
      healer: 1,
      dps: 1,
      flex: 1,
    });
    expect(result).toBe(4);
  });

  it('returns zero when all MMO roles are zero', () => {
    const result = computeSlotCapacity({
      type: 'mmo',
      tank: 0,
      healer: 0,
      dps: 0,
      flex: 0,
    });
    expect(result).toBe(0);
  });

  it('uses MMO defaults when role fields are missing', () => {
    // defaults: tank=2, healer=4, dps=14, flex=0
    const result = computeSlotCapacity({ type: 'mmo' });
    expect(result).toBe(20);
  });

  it('returns player count for generic type', () => {
    const result = computeSlotCapacity({
      type: 'generic',
      player: 8,
    });
    expect(result).toBe(8);
  });

  it('returns null for generic type without player field', () => {
    const result = computeSlotCapacity({ type: 'generic' });
    expect(result).toBeNull();
  });

  it('returns null for unknown type', () => {
    const result = computeSlotCapacity({ type: 'unknown' });
    expect(result).toBeNull();
  });

  it('does not include bench slots in MMO capacity', () => {
    const result = computeSlotCapacity({
      type: 'mmo',
      tank: 2,
      healer: 4,
      dps: 14,
      flex: 0,
      bench: 5,
    });
    expect(result).toBe(20);
  });

  it('does not include bench slots in generic capacity', () => {
    const result = computeSlotCapacity({
      type: 'generic',
      player: 10,
      bench: 5,
    });
    expect(result).toBe(10);
  });
});

describe('checkAutoBench — boundary conditions', () => {
  it('returns true when count equals capacity exactly', async () => {
    const eventRow = {
      maxAttendees: 10,
      slotConfig: null,
    } as EventRow;
    const result = await checkAutoBench(mockTx(10), eventRow, 1);
    expect(result).toBe(true);
  });

  it('returns false when count is one less than capacity', async () => {
    const eventRow = {
      maxAttendees: 10,
      slotConfig: null,
    } as EventRow;
    const result = await checkAutoBench(mockTx(9), eventRow, 1);
    expect(result).toBe(false);
  });

  it('returns true when count exceeds capacity', async () => {
    const eventRow = {
      maxAttendees: 5,
      slotConfig: null,
    } as EventRow;
    const result = await checkAutoBench(mockTx(7), eventRow, 1);
    expect(result).toBe(true);
  });

  it('returns true for zero-capacity MMO (all roles zero)', async () => {
    const eventRow = {
      maxAttendees: null,
      slotConfig: { type: 'mmo', tank: 0, healer: 0, dps: 0, flex: 0 },
    } as EventRow;
    // 0 capacity, 0 filled = full (0 >= 0)
    const result = await checkAutoBench(mockTx(0), eventRow, 1);
    expect(result).toBe(true);
  });

  it('returns true for zero-capacity generic event', async () => {
    const eventRow = {
      maxAttendees: null,
      slotConfig: { type: 'generic', player: 0 },
    } as EventRow;
    const result = await checkAutoBench(mockTx(0), eventRow, 1);
    expect(result).toBe(true);
  });

  it('skips DB query when dto requests bench', async () => {
    const tx = mockTx(999);
    const eventRow = {
      maxAttendees: 5,
      slotConfig: null,
    } as EventRow;
    const result = await checkAutoBench(tx, eventRow, 1, {
      slotRole: 'bench',
    });
    expect(result).toBe(false);
    // select should not have been called (early return)
    expect(tx.select).not.toHaveBeenCalled();
  });

  it('prefers slotConfig over maxAttendees', async () => {
    const eventRow = {
      maxAttendees: 100,
      slotConfig: { type: 'mmo', tank: 1, healer: 1, dps: 1, flex: 0 },
    } as EventRow;
    // capacity is 3 from slotConfig, not 100 from maxAttendees
    const result = await checkAutoBench(mockTx(3), eventRow, 1);
    expect(result).toBe(true);
  });

  it('uses maxAttendees when slotConfig is null', async () => {
    const eventRow = {
      maxAttendees: 5,
      slotConfig: null,
    } as EventRow;
    const result = await checkAutoBench(mockTx(4), eventRow, 1);
    expect(result).toBe(false);
  });

  it('returns false when no capacity source exists', async () => {
    const eventRow = {
      maxAttendees: null,
      slotConfig: null,
    } as EventRow;
    const result = await checkAutoBench(mockTx(100), eventRow, 1);
    expect(result).toBe(false);
  });
});

describe('shouldUseAutoAllocation', () => {
  const mmoEvent = {
    slotConfig: { type: 'mmo', tank: 2, healer: 4, dps: 14 },
  } as Parameters<typeof shouldUseAutoAllocation>[0];

  const genericEvent = {
    slotConfig: { type: 'generic', player: 10 },
  } as Parameters<typeof shouldUseAutoAllocation>[0];

  const noConfigEvent = {
    slotConfig: null,
  } as Parameters<typeof shouldUseAutoAllocation>[0];

  it('returns false for non-MMO events', () => {
    const signup = {
      preferredRoles: ['dps'],
    } as Parameters<typeof shouldUseAutoAllocation>[1];
    expect(shouldUseAutoAllocation(genericEvent, signup, undefined, false)).toBe(
      false,
    );
  });

  it('returns false when autoBench is true', () => {
    const signup = {
      preferredRoles: ['dps'],
    } as Parameters<typeof shouldUseAutoAllocation>[1];
    expect(shouldUseAutoAllocation(mmoEvent, signup, undefined, true)).toBe(
      false,
    );
  });

  it('returns false when dto.slotRole is bench', () => {
    const signup = {
      preferredRoles: ['dps'],
    } as Parameters<typeof shouldUseAutoAllocation>[1];
    expect(
      shouldUseAutoAllocation(mmoEvent, signup, { slotRole: 'bench' }, false),
    ).toBe(false);
  });

  it('returns true for MMO with preferred roles', () => {
    const signup = {
      preferredRoles: ['tank', 'healer'],
    } as Parameters<typeof shouldUseAutoAllocation>[1];
    expect(shouldUseAutoAllocation(mmoEvent, signup, undefined, false)).toBe(
      true,
    );
  });

  it('returns true for MMO with single slotRole and no prefs', () => {
    const signup = {
      preferredRoles: null,
    } as Parameters<typeof shouldUseAutoAllocation>[1];
    expect(
      shouldUseAutoAllocation(mmoEvent, signup, { slotRole: 'tank' }, false),
    ).toBe(true);
  });

  it('returns false for MMO with no prefs and no slotRole', () => {
    const signup = {
      preferredRoles: null,
    } as Parameters<typeof shouldUseAutoAllocation>[1];
    expect(shouldUseAutoAllocation(mmoEvent, signup, undefined, false)).toBe(
      false,
    );
  });

  it('returns false when slotConfig is null', () => {
    const signup = {
      preferredRoles: ['dps'],
    } as Parameters<typeof shouldUseAutoAllocation>[1];
    expect(shouldUseAutoAllocation(noConfigEvent, signup, undefined, false)).toBe(
      false,
    );
  });
});

describe('shouldUseAutoAllocationNew', () => {
  const mmoEvent = {
    slotConfig: { type: 'mmo', tank: 2, healer: 4, dps: 14 },
  } as Parameters<typeof shouldUseAutoAllocationNew>[0];

  it('returns false when autoBench is true', () => {
    expect(
      shouldUseAutoAllocationNew(
        mmoEvent,
        { preferredRoles: ['dps'] },
        true,
      ),
    ).toBe(false);
  });

  it('returns true when dto has preferred roles', () => {
    expect(
      shouldUseAutoAllocationNew(
        mmoEvent,
        { preferredRoles: ['tank', 'healer'] },
        false,
      ),
    ).toBe(true);
  });

  it('returns false for undefined dto', () => {
    expect(shouldUseAutoAllocationNew(mmoEvent, undefined, false)).toBe(false);
  });
});

describe('isCancelledStatus', () => {
  it.each(['roached_out', 'declined', 'departed'])(
    'returns true for %s',
    (status) => {
      expect(isCancelledStatus(status)).toBe(true);
    },
  );

  it.each(['signed_up', 'tentative', 'bench', ''])(
    'returns false for %s',
    (status) => {
      expect(isCancelledStatus(status)).toBe(false);
    },
  );
});
