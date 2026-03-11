/**
 * Adversarial tests for ROK-626: roster query helpers edge cases.
 * Tests getAssignedSlotRole, findNextPosition, and slotConfigFromEvent.
 */
import {
  getAssignedSlotRole,
  findNextPosition,
  slotConfigFromEvent,
} from './signups-roster-query.helpers';

function createMockDb(rows: unknown[] = []) {
  return {
    select: jest.fn().mockReturnValue({
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue({
          limit: jest.fn().mockResolvedValue(rows),
        }),
      }),
    }),
  } as unknown as Parameters<typeof getAssignedSlotRole>[0];
}

describe('getAssignedSlotRole', () => {
  it('returns role when assignment exists', async () => {
    const db = createMockDb([{ role: 'bench' }]);
    const result = await getAssignedSlotRole(db, 1);
    expect(result).toBe('bench');
  });

  it('returns null when no assignment exists', async () => {
    const db = createMockDb([]);
    const result = await getAssignedSlotRole(db, 1);
    expect(result).toBeNull();
  });

  it.each(['tank', 'healer', 'dps', 'flex', 'player'])(
    'returns %s for role assignments of that type',
    async (role) => {
      const db = createMockDb([{ role }]);
      const result = await getAssignedSlotRole(db, 1);
      expect(result).toBe(role);
    },
  );
});

describe('findNextPosition', () => {
  function createMockTxForPositions(positions: number[]) {
    return {
      select: jest.fn().mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest
            .fn()
            .mockResolvedValue(positions.map((p) => ({ position: p }))),
        }),
      }),
    } as unknown as Parameters<typeof findNextPosition>[0];
  }

  it('returns 1 when no existing positions', async () => {
    const tx = createMockTxForPositions([]);
    const result = await findNextPosition(tx, 1, 'bench');
    expect(result).toBe(1);
  });

  it('returns max + 1 when positions exist', async () => {
    const tx = createMockTxForPositions([1, 2, 5]);
    const result = await findNextPosition(tx, 1, 'dps');
    expect(result).toBe(6);
  });

  it('uses explicit position when not autoBench', async () => {
    const tx = createMockTxForPositions([1, 2]);
    const result = await findNextPosition(tx, 1, 'tank', 3, false);
    expect(result).toBe(3);
  });

  it('ignores explicit position when autoBench is true', async () => {
    const tx = createMockTxForPositions([1, 2]);
    const result = await findNextPosition(tx, 1, 'bench', 99, true);
    // Should compute next = max(1,2) + 1 = 3, not 99
    expect(result).toBe(3);
  });

  it('ignores explicit position when it is undefined', async () => {
    const tx = createMockTxForPositions([4]);
    const result = await findNextPosition(tx, 1, 'healer', undefined, false);
    expect(result).toBe(5);
  });
});

describe('slotConfigFromEvent', () => {
  it('returns MMO slots with defaults', () => {
    const result = slotConfigFromEvent({ type: 'mmo' });
    expect(result).toEqual({
      tank: 2,
      healer: 4,
      dps: 14,
      bench: 0,
    });
  });

  it('returns custom MMO slot values', () => {
    const result = slotConfigFromEvent({
      type: 'mmo',
      tank: 3,
      healer: 5,
      dps: 10,
      flex: 2,
      bench: 4,
    });
    expect(result).toEqual({
      tank: 3,
      healer: 5,
      dps: 10,
      flex: 2,
      bench: 4,
    });
  });

  it('returns generic slots with defaults', () => {
    const result = slotConfigFromEvent({ type: 'generic' });
    expect(result).toEqual({ player: 10, bench: 5 });
  });

  it('returns custom generic slot values', () => {
    const result = slotConfigFromEvent({
      type: 'generic',
      player: 6,
      bench: 3,
    });
    expect(result).toEqual({ player: 6, bench: 3 });
  });

  it('returns zero bench for MMO when bench is 0', () => {
    const result = slotConfigFromEvent({
      type: 'mmo',
      tank: 2,
      healer: 4,
      dps: 14,
      flex: 0,
      bench: 0,
    });
    expect(result!.bench).toBe(0);
  });
});
