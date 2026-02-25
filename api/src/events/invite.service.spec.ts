import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { InviteService } from './invite.service';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { SignupsService } from './signups.service';
import { SettingsService } from '../settings/settings.service';
import { PugRoleSchema } from '@raid-ledger/contract';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a chain mock that terminates at .limit() with the given value.
 * Each call returns `this` for all chain methods except the terminal.
 */
function makeChain(limitValue: unknown[] = []) {
  const chain: Record<string, jest.Mock> = {};
  const methods = ['from', 'where', 'innerJoin', 'leftJoin', 'orderBy', 'set'];
  for (const m of methods) {
    chain[m] = jest.fn().mockReturnValue(chain);
  }
  chain.limit = jest.fn().mockResolvedValue(limitValue);
  chain.returning = jest.fn().mockResolvedValue(limitValue);
  return chain;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FUTURE_DATE = new Date(Date.now() + 86_400_000); // +1 day
const PAST_DATE = new Date(Date.now() - 86_400_000); // -1 day

const mockSlot = {
  id: 'slot-uuid-1',
  eventId: 42,
  inviteCode: 'abc12345',
  role: 'dps',
  status: 'invited',
  claimedByUserId: null,
  createdBy: 99,
};

const mockEvent = {
  id: 42,
  title: 'Mythic Raid Night',
  gameId: 1,
  cancelledAt: null,
  duration: [new Date('2026-02-10T18:00:00Z'), FUTURE_DATE] as [Date, Date],
};

const mockUserWithDiscord = { discordId: 'discord-user-1' };
const mockUserWithoutDiscord = { discordId: null };

// ---------------------------------------------------------------------------
// PugRoleSchema contract tests
// ---------------------------------------------------------------------------

describe('PugRoleSchema', () => {
  it.each(['tank', 'healer', 'dps', 'player'] as const)(
    'accepts "%s" as a valid PugRole',
    (role) => {
      expect(() => PugRoleSchema.parse(role)).not.toThrow();
      expect(PugRoleSchema.parse(role)).toBe(role);
    },
  );

  it('rejects unknown role values', () => {
    expect(() => PugRoleSchema.parse('warrior')).toThrow();
    expect(() => PugRoleSchema.parse('')).toThrow();
    expect(() => PugRoleSchema.parse(null)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// InviteService unit tests
// ---------------------------------------------------------------------------

describe('InviteService', () => {
  let service: InviteService;
  let mockSignupsService: { signup: jest.Mock };
  let mockSettingsService: {
    getBranding: jest.Mock;
    getClientUrl: jest.Mock;
  };

  // Track individual select call counts so we can return different rows
  let selectCallCount: number;

  // Per-test overrides for select sequences
  let selectSequence: unknown[][];

  function buildMockDb() {
    selectCallCount = 0;

    const mockDb: Record<string, jest.Mock> = {
      select: jest.fn().mockImplementation(() => {
        const idx = selectCallCount++;
        const value = selectSequence[idx] ?? [];
        return makeChain(value);
      }),
      update: jest.fn().mockReturnValue(makeChain()),
      delete: jest.fn().mockReturnValue(makeChain()),
      insert: jest.fn().mockReturnValue(makeChain()),
      transaction: jest
        .fn()
        .mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
          fn(mockDb),
        ),
    };

    return mockDb;
  }

  let mockDb: ReturnType<typeof buildMockDb>;

  beforeEach(async () => {
    // Default select sequence: slot → event → user (discordId path)
    selectSequence = [
      [mockSlot], // slot lookup
      [mockEvent], // event lookup
      [], // existing signup check (none)
      [mockUserWithDiscord], // user lookup
    ];

    mockDb = buildMockDb();

    mockSignupsService = { signup: jest.fn().mockResolvedValue({ id: 1 }) };
    mockSettingsService = {
      getBranding: jest.fn().mockResolvedValue({ communityName: 'Test Guild' }),
      getClientUrl: jest.fn().mockResolvedValue('http://localhost:5173'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InviteService,
        { provide: DrizzleAsyncProvider, useValue: mockDb },
        { provide: SignupsService, useValue: mockSignupsService },
        { provide: SettingsService, useValue: mockSettingsService },
        // Optional providers — omit to keep unit tests lean
        { provide: 'PugInviteService', useValue: null },
        { provide: 'DiscordBotClientService', useValue: null },
      ],
    }).compile();

    service = module.get(InviteService);
  });

  // =========================================================================
  // claimInvite — Path 1: user WITH discordId (existing RL member)
  // =========================================================================

  describe('claimInvite — Path 1 (user has discordId)', () => {
    it('returns type "signup" and calls signupsService.signup()', async () => {
      const result = await service.claimInvite('abc12345', 1);

      expect(result.type).toBe('signup');
      expect(result.eventId).toBe(42);
      expect(mockSignupsService.signup).toHaveBeenCalledTimes(1);
      expect(mockSignupsService.signup).toHaveBeenCalledWith(
        42,
        1,
        expect.objectContaining({ slotRole: 'dps' }),
      );
    });

    it('passes "player" role through to signup for generic rosters', async () => {
      selectSequence = [
        [{ ...mockSlot, role: 'player' }],
        [mockEvent],
        [],
        [mockUserWithDiscord],
      ];
      mockDb = buildMockDb();

      // Rebuild service with updated mockDb
      const module = await Test.createTestingModule({
        providers: [
          InviteService,
          { provide: DrizzleAsyncProvider, useValue: mockDb },
          { provide: SignupsService, useValue: mockSignupsService },
          { provide: SettingsService, useValue: mockSettingsService },
          { provide: 'PugInviteService', useValue: null },
          { provide: 'DiscordBotClientService', useValue: null },
        ],
      }).compile();

      const svc = module.get(InviteService);
      await svc.claimInvite('abc12345', 1);

      expect(mockSignupsService.signup).toHaveBeenCalledWith(
        42,
        1,
        expect.objectContaining({ slotRole: 'player' }),
      );
    });

    it('uses the roleOverride when provided instead of slot role', async () => {
      await service.claimInvite('abc12345', 1, 'tank');

      expect(mockSignupsService.signup).toHaveBeenCalledWith(
        42,
        1,
        expect.objectContaining({ slotRole: 'tank' }),
      );
    });

    it('deletes the PUG slot after creating a signup', async () => {
      await service.claimInvite('abc12345', 1);

      expect(mockDb.delete).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // claimInvite — Path 2: user WITHOUT discordId (PUG slot claim)
  // =========================================================================

  describe('claimInvite — Path 2 (user has no discordId)', () => {
    beforeEach(() => {
      selectSequence = [[mockSlot], [mockEvent], [], [mockUserWithoutDiscord]];
      mockDb = buildMockDb();
    });

    async function buildService() {
      const module = await Test.createTestingModule({
        providers: [
          InviteService,
          { provide: DrizzleAsyncProvider, useValue: mockDb },
          { provide: SignupsService, useValue: mockSignupsService },
          { provide: SettingsService, useValue: mockSettingsService },
          { provide: 'PugInviteService', useValue: null },
          { provide: 'DiscordBotClientService', useValue: null },
        ],
      }).compile();
      return module.get(InviteService);
    }

    it('returns type "claimed"', async () => {
      const svc = await buildService();
      const result = await svc.claimInvite('abc12345', 1);

      expect(result.type).toBe('claimed');
      expect(result.eventId).toBe(42);
    });

    it('updates pug_slots status to "claimed"', async () => {
      const svc = await buildService();
      await svc.claimInvite('abc12345', 1);

      expect(mockDb.update).toHaveBeenCalled();
      // The set() call on the chain should include status: 'claimed'
      const updateChain = mockDb.update.mock.results[0].value as Record<
        string,
        jest.Mock
      >;
      expect(updateChain.set).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'claimed', claimedByUserId: 1 }),
      );
    });

    it('calls signupsService.signup() so the player appears in the roster', async () => {
      const svc = await buildService();
      await svc.claimInvite('abc12345', 1);

      expect(mockSignupsService.signup).toHaveBeenCalledTimes(1);
      expect(mockSignupsService.signup).toHaveBeenCalledWith(
        42,
        1,
        expect.objectContaining({ slotRole: 'dps' }),
      );
    });

    it('passes "player" role to signup for generic rosters (no discordId path)', async () => {
      selectSequence = [
        [{ ...mockSlot, role: 'player' }],
        [mockEvent],
        [],
        [mockUserWithoutDiscord],
      ];
      mockDb = buildMockDb();
      const svc = await buildService();
      await svc.claimInvite('abc12345', 1);

      expect(mockSignupsService.signup).toHaveBeenCalledWith(
        42,
        1,
        expect.objectContaining({ slotRole: 'player' }),
      );
    });

    it('rethrows when signupsService.signup() fails (signup failure propagates)', async () => {
      const svc = await buildService();
      mockSignupsService.signup.mockRejectedValueOnce(
        new ConflictException('already signed up'),
      );

      await expect(svc.claimInvite('abc12345', 1)).rejects.toThrow(
        ConflictException,
      );
    });
  });

  // =========================================================================
  // claimInvite — Error cases
  // =========================================================================

  describe('claimInvite — error cases', () => {
    it('throws NotFoundException when the invite code does not exist', async () => {
      selectSequence = [[]]; // slot lookup returns nothing
      mockDb = buildMockDb();

      const module = await Test.createTestingModule({
        providers: [
          InviteService,
          { provide: DrizzleAsyncProvider, useValue: mockDb },
          { provide: SignupsService, useValue: mockSignupsService },
          { provide: SettingsService, useValue: mockSettingsService },
          { provide: 'PugInviteService', useValue: null },
          { provide: 'DiscordBotClientService', useValue: null },
        ],
      }).compile();
      const svc = module.get(InviteService);

      await expect(svc.claimInvite('badcode', 1)).rejects.toThrow(
        NotFoundException,
      );
      expect(mockSignupsService.signup).not.toHaveBeenCalled();
    });

    it('throws ConflictException when slot is already claimed', async () => {
      selectSequence = [[{ ...mockSlot, status: 'claimed' }]];
      mockDb = buildMockDb();

      const module = await Test.createTestingModule({
        providers: [
          InviteService,
          { provide: DrizzleAsyncProvider, useValue: mockDb },
          { provide: SignupsService, useValue: mockSignupsService },
          { provide: SettingsService, useValue: mockSettingsService },
          { provide: 'PugInviteService', useValue: null },
          { provide: 'DiscordBotClientService', useValue: null },
        ],
      }).compile();
      const svc = module.get(InviteService);

      await expect(svc.claimInvite('abc12345', 1)).rejects.toThrow(
        ConflictException,
      );
    });

    it('throws BadRequestException when the event has ended', async () => {
      selectSequence = [
        [mockSlot],
        [{ ...mockEvent, duration: [PAST_DATE, PAST_DATE] as [Date, Date] }],
      ];
      mockDb = buildMockDb();

      const module = await Test.createTestingModule({
        providers: [
          InviteService,
          { provide: DrizzleAsyncProvider, useValue: mockDb },
          { provide: SignupsService, useValue: mockSignupsService },
          { provide: SettingsService, useValue: mockSettingsService },
          { provide: 'PugInviteService', useValue: null },
          { provide: 'DiscordBotClientService', useValue: null },
        ],
      }).compile();
      const svc = module.get(InviteService);

      await expect(svc.claimInvite('abc12345', 1)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws ConflictException when user is already signed up (and deletes the PUG slot)', async () => {
      selectSequence = [
        [mockSlot],
        [mockEvent],
        [{ id: 99 }], // existing signup
        [mockUserWithDiscord],
      ];
      mockDb = buildMockDb();

      const module = await Test.createTestingModule({
        providers: [
          InviteService,
          { provide: DrizzleAsyncProvider, useValue: mockDb },
          { provide: SignupsService, useValue: mockSignupsService },
          { provide: SettingsService, useValue: mockSettingsService },
          { provide: 'PugInviteService', useValue: null },
          { provide: 'DiscordBotClientService', useValue: null },
        ],
      }).compile();
      const svc = module.get(InviteService);

      await expect(svc.claimInvite('abc12345', 1)).rejects.toThrow(
        ConflictException,
      );
      // The stale anonymous PUG slot should be cleaned up
      expect(mockDb.delete).toHaveBeenCalled();
      // No new signup should have been created
      expect(mockSignupsService.signup).not.toHaveBeenCalled();
    });
  });
});
