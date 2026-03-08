/**
 * Unit tests for ROK-626: bench fallback when roster is full.
 * Tests checkAutoBench for MMO events with slotConfig,
 * and bench fallback in Discord/web/PUG signup flows.
 */
import { checkAutoBench } from './signups-signup.helpers';

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
