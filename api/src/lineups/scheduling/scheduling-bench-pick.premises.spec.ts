/**
 * ROK-2025 premises. The organizer's bench pick relies on two behaviours the
 * spec flagged UNVERIFIED; these tests pin them so a later change cannot
 * quietly break the pick.
 *
 * (a) An explicit `signup(…, { slotRole: 'bench' })` on a generic event lands
 *     on the bench: it is not auto-benched, not MMO-allocated, and the direct
 *     slot assignment writes a `bench` roster row (which `getAssignedSlotRole`
 *     reads back as `assignedSlot: 'bench'`).
 * (b) `splitYesVotersBySlot` keeps the input (vote) order, so the ORDER BY in
 *     `findScheduleVotes` reaches `autoSignupSlotVoters` intact.
 */
import { assignDirectSlot } from '../../events/signups-flow.helpers';
import type { FlowDeps } from '../../events/signups-flow.helpers';
import {
  checkAutoBench,
  shouldUseAutoAllocationNew,
} from '../../events/signups-signup.helpers';
import { splitYesVotersBySlot } from '../standalone-poll/standalone-poll-voter.helpers';

const BENCH_DTO = { slotRole: 'bench' as const };

function createMockTx() {
  const values = jest.fn().mockResolvedValue(undefined);
  const tx = {
    select: jest.fn().mockReturnValue({
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockResolvedValue([]),
      }),
    }),
    insert: jest.fn().mockReturnValue({ values }),
    update: jest.fn(),
    transaction: jest.fn(),
  };
  // Roster inserts run in a SAVEPOINT (ROK-1345): run the callback on tx.
  tx.transaction.mockImplementation((cb: (sp: unknown) => unknown) => cb(tx));
  return { tx, values };
}

function createMockDeps(): FlowDeps {
  return {
    db: {} as FlowDeps['db'],
    logger: { log: jest.fn(), warn: jest.fn() },
    cancelPromotion: jest.fn().mockResolvedValue(undefined),
    autoAllocateSignup: jest.fn().mockResolvedValue(undefined),
  };
}

describe('ROK-2025 premise (a): explicit bench signup on a generic event', () => {
  it('is not treated as an auto-bench, so the capacity count is skipped', async () => {
    const { tx } = createMockTx();
    const eventRow = { maxAttendees: 2, slotConfig: null };

    const autoBench = await checkAutoBench(
      tx as never,
      eventRow as never,
      1,
      BENCH_DTO,
    );

    expect(autoBench).toBe(false);
    expect(tx.select).not.toHaveBeenCalled();
  });

  it('never goes through MMO auto-allocation, even on an MMO event', () => {
    const generic = { slotConfig: null };
    const mmo = { slotConfig: { type: 'mmo' } };

    expect(shouldUseAutoAllocationNew(generic as never, BENCH_DTO, false)).toBe(
      false,
    );
    expect(shouldUseAutoAllocationNew(mmo as never, BENCH_DTO, false)).toBe(
      false,
    );
  });

  it('writes a bench roster row and does not confirm the signup', async () => {
    const { tx, values } = createMockTx();
    const deps = createMockDeps();

    const confirmed = await assignDirectSlot(deps, {
      tx: tx as never,
      eventRow: { slotConfig: null } as never,
      eventId: 1,
      signupId: 10,
      dto: BENCH_DTO,
      autoBench: false,
      logPrefix: 'Assigned user 5',
    });

    expect(confirmed).toBe(false);
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({ signupId: 10, role: 'bench' }),
    );
    expect(tx.update).not.toHaveBeenCalled();
    expect(deps.cancelPromotion).not.toHaveBeenCalled();
  });
});

describe('ROK-2025 premise (b): splitYesVotersBySlot keeps vote order', () => {
  const slots = [
    { id: 1, proposedTime: new Date('2026-11-01T19:00:00Z') },
    { id: 2, proposedTime: new Date('2026-11-02T19:00:00Z') },
  ];

  it('returns the selected slot yes-voters in the order they were given', () => {
    const votes = [
      { userId: 30, slotId: 1, stance: 'yes' as const },
      { userId: 10, slotId: 2, stance: 'yes' as const },
      { userId: 20, slotId: 1, stance: 'no' as const },
      { userId: 50, slotId: 1, stance: 'yes' as const },
      { userId: 40, slotId: 1, stance: null },
    ];

    const { selectedVoters } = splitYesVotersBySlot(
      slots,
      votes,
      '2026-11-01T19:00:00.000Z',
    );

    expect(selectedVoters.map((v) => v.userId)).toEqual([30, 50, 40]);
  });
});
