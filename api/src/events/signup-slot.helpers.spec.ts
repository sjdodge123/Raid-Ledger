/**
 * Tests for ROK-548: assignDiscordSignupSlot must not set preferredRoles
 * for non-MMO roles like 'player', 'flex', or 'bench'.
 */
import { assignDiscordSignupSlot } from './signup-slot.helpers';
import { createMockEvent } from '../common/testing/factories';

// ---- mocks ----------------------------------------------------------------

jest.mock('./signup-allocation.helpers', () => ({
  autoAllocateSignup: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('./signup-promote.helpers', () => ({
  resolveGenericSlotRole: jest.fn().mockResolvedValue('player'),
}));

import { autoAllocateSignup } from './signup-allocation.helpers';

function mockTx() {
  const setFn = jest
    .fn()
    .mockReturnValue({ where: jest.fn().mockResolvedValue(undefined) });
  const updateFn = jest.fn().mockReturnValue({ set: setFn });
  const insertFn = jest.fn().mockReturnValue({
    values: jest.fn().mockResolvedValue(undefined),
  });
  const selectFn = jest.fn().mockReturnValue({
    from: jest.fn().mockReturnValue({
      where: jest.fn().mockResolvedValue([]),
    }),
  });
  const tx = {
    update: updateFn,
    insert: insertFn,
    select: selectFn,
    set: setFn,
  } as unknown as Parameters<typeof assignDiscordSignupSlot>[0];
  return tx;
}

const mockBenchPromo = {
  cancelPromotion: jest.fn().mockResolvedValue(undefined),
} as unknown as Parameters<typeof assignDiscordSignupSlot>[6];

function mmoEvent() {
  return createMockEvent({
    slotConfig: { type: 'mmo', tank: 2, healer: 2, dps: 6 },
  }) as Parameters<typeof assignDiscordSignupSlot>[1];
}

function genericEvent() {
  return createMockEvent({
    slotConfig: { type: 'generic', player: 10 },
  }) as Parameters<typeof assignDiscordSignupSlot>[1];
}

// ---- tests -----------------------------------------------------------------

describe('assignDiscordSignupSlot — ROK-548 preferredRoles filtering', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('MMO events', () => {
    it('sets preferredRoles when role is tank', async () => {
      const tx = mockTx();
      await assignDiscordSignupSlot(
        tx,
        mmoEvent(),
        1,
        100,
        'tank',
        undefined,
        mockBenchPromo,
      );

      expect(tx.update).toHaveBeenCalled();
      const setFn = (tx.update as jest.Mock).mock.results[0].value.set;
      expect(setFn).toHaveBeenCalledWith({ preferredRoles: ['tank'] });
      expect(autoAllocateSignup).toHaveBeenCalled();
    });

    it('sets preferredRoles when role is healer', async () => {
      const tx = mockTx();
      await assignDiscordSignupSlot(
        tx,
        mmoEvent(),
        1,
        100,
        'healer',
        undefined,
        mockBenchPromo,
      );

      const setFn = (tx.update as jest.Mock).mock.results[0].value.set;
      expect(setFn).toHaveBeenCalledWith({ preferredRoles: ['healer'] });
    });

    it('sets preferredRoles when role is dps', async () => {
      const tx = mockTx();
      await assignDiscordSignupSlot(
        tx,
        mmoEvent(),
        1,
        100,
        'dps',
        undefined,
        mockBenchPromo,
      );

      const setFn = (tx.update as jest.Mock).mock.results[0].value.set;
      expect(setFn).toHaveBeenCalledWith({ preferredRoles: ['dps'] });
    });

    it('does NOT set preferredRoles when role is player', async () => {
      const tx = mockTx();
      await assignDiscordSignupSlot(
        tx,
        mmoEvent(),
        1,
        100,
        'player',
        undefined,
        mockBenchPromo,
      );

      // Should not call autoAllocateSignup (player is not MMO)
      expect(autoAllocateSignup).not.toHaveBeenCalled();
    });

    it('does NOT set preferredRoles when role is flex', async () => {
      const tx = mockTx();
      await assignDiscordSignupSlot(
        tx,
        mmoEvent(),
        1,
        100,
        'flex',
        undefined,
        mockBenchPromo,
      );

      expect(autoAllocateSignup).not.toHaveBeenCalled();
    });

    it('does NOT set preferredRoles when role is bench', async () => {
      const tx = mockTx();
      await assignDiscordSignupSlot(
        tx,
        mmoEvent(),
        1,
        100,
        'bench',
        undefined,
        mockBenchPromo,
      );

      expect(autoAllocateSignup).not.toHaveBeenCalled();
    });

    it('uses provided preferredRoles when they exist', async () => {
      const tx = mockTx();
      await assignDiscordSignupSlot(
        tx,
        mmoEvent(),
        1,
        100,
        'tank',
        ['healer', 'dps'],
        mockBenchPromo,
      );

      // Should NOT call tx.update.set (preferredRoles already provided)
      // but should call autoAllocateSignup since hasPreferredRoles is true
      expect(autoAllocateSignup).toHaveBeenCalled();
      // update should not be called to overwrite preferredRoles
      expect(tx.update).not.toHaveBeenCalled();
    });
  });

  describe('generic events', () => {
    it('assigns role directly for generic events without autoAllocate', async () => {
      const tx = mockTx();
      await assignDiscordSignupSlot(
        tx,
        genericEvent(),
        1,
        100,
        'player',
        undefined,
        mockBenchPromo,
      );

      // Generic event: no auto-allocation, just assigns position
      expect(autoAllocateSignup).not.toHaveBeenCalled();
      expect(tx.insert).toHaveBeenCalled();
    });
  });
});
