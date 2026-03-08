/**
 * Unit tests for signups-flow.helpers.ts — signup transaction orchestration.
 * Focuses on ROK-739: role preference preservation during auto-allocation.
 */
import * as schema from '../drizzle/schema';
import { signupTxBody, type FlowDeps } from './signups-flow.helpers';
import type { SignupTxParams } from './signups.service.types';

/** Create a minimal mock transaction with chainable Drizzle methods. */
function createMockTx() {
  const setCalls: Array<Record<string, unknown>> = [];
  const insertCalls: Array<Record<string, unknown>> = [];

  const mockTx = {
    setCalls,
    insertCalls,
    select: jest.fn().mockReturnValue({
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue({
          limit: jest.fn().mockResolvedValue([]),
        }),
      }),
    }),
    insert: jest.fn().mockImplementation(() => ({
      values: jest.fn().mockImplementation((vals: unknown) => {
        insertCalls.push(vals as Record<string, unknown>);
        return {
          onConflictDoNothing: jest.fn().mockReturnValue({
            returning: jest.fn().mockResolvedValue([]),
          }),
          returning: jest.fn().mockResolvedValue([]),
        };
      }),
    })),
    update: jest.fn().mockReturnValue({
      set: jest.fn().mockImplementation((vals: unknown) => {
        setCalls.push(vals as Record<string, unknown>);
        return {
          where: jest.fn().mockResolvedValue(undefined),
        };
      }),
    }),
    delete: jest.fn().mockReturnValue({
      where: jest.fn().mockResolvedValue(undefined),
    }),
  };

  return mockTx;
}

/** Build a minimal MMO event row for testing. */
function createMmoEventRow(
  overrides?: Partial<typeof schema.events.$inferSelect>,
) {
  return {
    id: 1,
    title: 'Test MMO Event',
    creatorId: 99,
    slotConfig: { type: 'mmo', tank: 2, healer: 4, dps: 14, flex: 5, bench: 0 },
    maxAttendees: null,
    gameId: 1,
    description: null,
    duration: null,
    eventType: null,
    region: null,
    gameVariant: null,
    coverImageUrl: null,
    isCancelled: false,
    cancelReason: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    seriesId: null,
    ...overrides,
  } as unknown as typeof schema.events.$inferSelect;
}

/** Build a minimal signup row. */
function createSignupRow(
  overrides?: Partial<typeof schema.eventSignups.$inferSelect>,
) {
  return {
    id: 10,
    eventId: 1,
    userId: 1,
    note: null,
    signedUpAt: new Date(),
    characterId: null,
    confirmationStatus: 'pending',
    status: 'signed_up',
    preferredRoles: null,
    discordUserId: null,
    discordUsername: null,
    discordAvatarHash: null,
    attendanceStatus: null,
    attendanceRecordedAt: null,
    roachedOutAt: null,
    ...overrides,
  } as unknown as typeof schema.eventSignups.$inferSelect;
}

/** Build mock FlowDeps with tracking for autoAllocateSignup calls. */
function createMockDeps(): FlowDeps & {
  autoAllocateCalls: Array<{ signupId: number }>;
} {
  const autoAllocateCalls: Array<{ signupId: number }> = [];
  return {
    db: {} as FlowDeps['db'],
    logger: { log: jest.fn(), warn: jest.fn() },
    cancelPromotion: jest.fn().mockResolvedValue(undefined),
    autoAllocateSignup: jest
      .fn()
      .mockImplementation(async (_tx, _eventId, signupId) => {
        autoAllocateCalls.push({ signupId });
      }),
    autoAllocateCalls,
  };
}

describe('signups-flow.helpers — ROK-739 role preference preservation', () => {
  describe('signupTxBody — new signup path', () => {
    it('should NOT overwrite preferredRoles when both preferredRoles and slotRole are present', async () => {
      const mockTx = createMockTx();
      const deps = createMockDeps();
      const eventRow = createMmoEventRow();

      // DTO has both preferredRoles (multi) and slotRole
      const dto = {
        preferredRoles: ['tank', 'dps'] as ('tank' | 'healer' | 'dps')[],
        slotRole: 'tank' as const,
      };

      const insertedSignup = createSignupRow({
        id: 10,
        preferredRoles: ['tank', 'dps'],
      });

      // Make insert return the newly created signup
      mockTx.insert.mockImplementationOnce(() => ({
        values: jest.fn().mockImplementation((vals: unknown) => {
          mockTx.insertCalls.push(vals as Record<string, unknown>);
          return {
            onConflictDoNothing: jest.fn().mockReturnValue({
              returning: jest.fn().mockResolvedValue([insertedSignup]),
            }),
          };
        }),
      }));

      // checkAutoBench select: no maxAttendees so returns false
      mockTx.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([]),
          }),
        }),
      });

      const params: SignupTxParams = {
        tx: mockTx as unknown as SignupTxParams['tx'],
        eventRow,
        eventId: 1,
        userId: 1,
        dto,
        user: undefined,
      };

      await signupTxBody(deps, params);

      // Auto-allocation should have been called
      expect(deps.autoAllocateSignup).toHaveBeenCalled();

      // The key assertion: preferredRoles should NOT be overwritten to ['tank']
      // Check that no update.set() call overwrites preferredRoles with [slotRole]
      const prefRolesOverwrites = mockTx.setCalls.filter(
        (call) => 'preferredRoles' in call,
      );
      for (const overwrite of prefRolesOverwrites) {
        // If any overwrite exists, it must NOT reduce multi-role prefs to single
        expect(overwrite.preferredRoles).not.toEqual(['tank']);
      }
    });

    it('should set preferredRoles from slotRole when NO preferredRoles are provided', async () => {
      const mockTx = createMockTx();
      const deps = createMockDeps();
      const eventRow = createMmoEventRow();

      // DTO has only slotRole, no preferredRoles
      const dto = { slotRole: 'healer' as const };

      const insertedSignup = createSignupRow({ id: 11 });

      mockTx.insert.mockImplementationOnce(() => ({
        values: jest.fn().mockImplementation((vals: unknown) => {
          mockTx.insertCalls.push(vals as Record<string, unknown>);
          return {
            onConflictDoNothing: jest.fn().mockReturnValue({
              returning: jest.fn().mockResolvedValue([insertedSignup]),
            }),
          };
        }),
      }));

      const params: SignupTxParams = {
        tx: mockTx as unknown as SignupTxParams['tx'],
        eventRow,
        eventId: 1,
        userId: 1,
        dto,
        user: undefined,
      };

      await signupTxBody(deps, params);

      // Auto-allocation should have been called
      expect(deps.autoAllocateSignup).toHaveBeenCalled();

      // When no preferredRoles exist, slotRole SHOULD be used as fallback preference
      const prefRolesOverwrites = mockTx.setCalls.filter(
        (call) => 'preferredRoles' in call,
      );
      expect(prefRolesOverwrites.length).toBeGreaterThan(0);
      expect(prefRolesOverwrites[0].preferredRoles).toEqual(['healer']);
    });
  });

  describe('signupTxBody — duplicate signup (ensureAssignment) path', () => {
    it('should NOT overwrite preferredRoles when duplicate signup has multi-role prefs and slotRole', async () => {
      const mockTx = createMockTx();
      const deps = createMockDeps();
      const eventRow = createMmoEventRow();

      const existingSignup = createSignupRow({
        id: 20,
        status: 'signed_up',
        preferredRoles: ['tank', 'dps'],
      });

      // DTO has both preferredRoles and slotRole
      const dto = {
        preferredRoles: ['tank', 'dps'] as ('tank' | 'healer' | 'dps')[],
        slotRole: 'tank' as const,
      };

      // Insert returns empty (duplicate detected via onConflictDoNothing)
      mockTx.insert.mockImplementationOnce(() => ({
        values: jest.fn().mockReturnValue({
          onConflictDoNothing: jest.fn().mockReturnValue({
            returning: jest.fn().mockResolvedValue([]),
          }),
        }),
      }));

      // Select calls (checkAutoBench skipped — maxAttendees is null):
      // 1. fetchExistingSignup
      // 2. check existing roster assignment
      // 3. syncConfirmationStatus
      mockTx.select
        // fetchExistingSignup
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([existingSignup]),
            }),
          }),
        })
        // check existing roster assignment (none — triggers ensureAssignment)
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([]),
            }),
          }),
        })
        // syncConfirmationStatus
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest
                .fn()
                .mockResolvedValue([{ confirmationStatus: 'confirmed' }]),
            }),
          }),
        });

      const params: SignupTxParams = {
        tx: mockTx as unknown as SignupTxParams['tx'],
        eventRow,
        eventId: 1,
        userId: 1,
        dto,
        user: undefined,
      };

      await signupTxBody(deps, params);

      // Auto-allocation should have been called
      expect(deps.autoAllocateSignup).toHaveBeenCalled();

      // preferredRoles should NOT be overwritten to ['tank']
      const prefRolesOverwrites = mockTx.setCalls.filter(
        (call) => 'preferredRoles' in call,
      );
      for (const overwrite of prefRolesOverwrites) {
        expect(overwrite.preferredRoles).not.toEqual(['tank']);
      }
    });
  });
});
