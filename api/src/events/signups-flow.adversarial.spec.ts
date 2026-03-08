/**
 * Adversarial tests for ROK-626: signups-flow.helpers bench fallback paths.
 * Tests assignDirectSlot and assignBenchFallback orchestration behavior.
 */
import { assignDirectSlot, assignBenchFallback } from './signups-flow.helpers';
import type { FlowDeps } from './signups-flow.helpers';

function createMockTx() {
  return {
    select: jest.fn().mockReturnValue({
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockResolvedValue([]),
      }),
    }),
    insert: jest.fn().mockReturnValue({
      values: jest.fn().mockResolvedValue(undefined),
    }),
    update: jest.fn().mockReturnValue({
      set: jest.fn().mockReturnValue({
        where: jest.fn().mockResolvedValue(undefined),
      }),
    }),
  } as unknown as Parameters<typeof assignDirectSlot>[1]['tx'];
}

function createMockDeps(
  overrides?: Partial<FlowDeps>,
): FlowDeps {
  return {
    db: {} as FlowDeps['db'],
    logger: { log: jest.fn(), warn: jest.fn() },
    cancelPromotion: jest.fn().mockResolvedValue(undefined),
    autoAllocateSignup: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('assignDirectSlot', () => {
  it('assigns bench role when autoBench is true', async () => {
    const deps = createMockDeps();
    const tx = createMockTx();

    const result = await assignDirectSlot(deps, {
      tx,
      eventRow: { slotConfig: null } as Parameters<
        typeof assignDirectSlot
      >[1]['eventRow'],
      eventId: 1,
      signupId: 10,
      dto: { slotRole: 'dps' },
      autoBench: true,
      logPrefix: 'Test',
    });

    // Should NOT auto-confirm (bench is not a main role)
    expect(result).toBe(false);
    expect(tx.insert).toHaveBeenCalled();
    // cancelPromotion should NOT be called for bench
    expect(deps.cancelPromotion).not.toHaveBeenCalled();
    expect(deps.logger.log).toHaveBeenCalledWith(
      expect.stringContaining('auto-benched'),
    );
  });

  it('confirms signup when assigning non-bench role', async () => {
    const deps = createMockDeps();
    const tx = createMockTx();

    const result = await assignDirectSlot(deps, {
      tx,
      eventRow: { slotConfig: null } as Parameters<
        typeof assignDirectSlot
      >[1]['eventRow'],
      eventId: 1,
      signupId: 10,
      dto: { slotRole: 'tank' },
      autoBench: false,
      logPrefix: 'Test',
    });

    expect(result).toBe(true);
    expect(tx.update).toHaveBeenCalled();
    expect(deps.cancelPromotion).toHaveBeenCalledWith(
      1,
      'tank',
      expect.any(Number),
    );
  });

  it('returns false when no slot role can be resolved', async () => {
    const deps = createMockDeps();
    // resolveGenericSlotRole returns null when no capacity
    const tx = {
      ...createMockTx(),
      select: jest.fn().mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([]),
        }),
      }),
    } as unknown as Parameters<typeof assignDirectSlot>[1]['tx'];

    const result = await assignDirectSlot(deps, {
      tx,
      eventRow: {
        slotConfig: null,
        maxAttendees: null,
      } as Parameters<typeof assignDirectSlot>[1]['eventRow'],
      eventId: 1,
      signupId: 10,
      dto: undefined,
      autoBench: false,
      logPrefix: 'Test',
    });

    expect(result).toBe(false);
  });

  it('uses dto.slotRole when autoBench is false', async () => {
    const deps = createMockDeps();
    const tx = createMockTx();

    await assignDirectSlot(deps, {
      tx,
      eventRow: { slotConfig: null } as Parameters<
        typeof assignDirectSlot
      >[1]['eventRow'],
      eventId: 1,
      signupId: 10,
      dto: { slotRole: 'healer' },
      autoBench: false,
      logPrefix: 'Assigned user 5',
    });

    expect(deps.logger.log).toHaveBeenCalledWith(
      expect.stringContaining('healer'),
    );
  });

  it('overrides dto.slotRole with bench when autoBench is true', async () => {
    const deps = createMockDeps();
    const tx = createMockTx();

    await assignDirectSlot(deps, {
      tx,
      eventRow: { slotConfig: null } as Parameters<
        typeof assignDirectSlot
      >[1]['eventRow'],
      eventId: 1,
      signupId: 10,
      dto: { slotRole: 'tank' },
      autoBench: true,
      logPrefix: 'Test',
    });

    expect(deps.logger.log).toHaveBeenCalledWith(
      expect.stringContaining('bench'),
    );
    expect(deps.logger.log).toHaveBeenCalledWith(
      expect.stringContaining('auto-benched'),
    );
  });
});

describe('assignBenchFallback', () => {
  it('assigns signup to bench position 1 when no existing bench', async () => {
    const deps = createMockDeps();
    const tx = createMockTx();

    await assignBenchFallback(deps, tx, 1, 42);

    expect(tx.insert).toHaveBeenCalled();
    expect(deps.logger.log).toHaveBeenCalledWith(
      expect.stringContaining('Auto-benched'),
    );
    expect(deps.logger.log).toHaveBeenCalledWith(
      expect.stringContaining('42'),
    );
  });

  it('uses custom label in log message', async () => {
    const deps = createMockDeps();
    const tx = createMockTx();

    await assignBenchFallback(deps, tx, 1, 42, 'anonymous signup');

    expect(deps.logger.log).toHaveBeenCalledWith(
      expect.stringContaining('anonymous signup'),
    );
  });

  it('defaults label to "signup" when not provided', async () => {
    const deps = createMockDeps();
    const tx = createMockTx();

    await assignBenchFallback(deps, tx, 1, 42);

    expect(deps.logger.log).toHaveBeenCalledWith(
      expect.stringContaining('signup'),
    );
  });

  it('increments position when bench already has entries', async () => {
    const deps = createMockDeps();
    const insertValues = jest.fn().mockResolvedValue(undefined);
    const tx = {
      select: jest.fn().mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([
            { position: 1 },
            { position: 3 },
          ]),
        }),
      }),
      insert: jest.fn().mockReturnValue({
        values: insertValues,
      }),
    } as unknown as Parameters<typeof assignBenchFallback>[2];

    await assignBenchFallback(deps, tx, 1, 42);

    // position should be max(1,3) + 1 = 4
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ position: 4 }),
    );
  });
});
