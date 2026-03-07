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

const FUTURE_DATE = new Date(Date.now() + 86_400_000);
const PAST_DATE = new Date(Date.now() - 86_400_000);

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

let service: InviteService;
let mockSignupsService: { signup: jest.Mock };
let mockSettingsService: {
  getBranding: jest.Mock;
  getClientUrl: jest.Mock;
};
let selectCallCount: number;
let selectSequence: unknown[][];
let mockDb: Record<string, jest.Mock>;

const inviteProviders = () => [
  InviteService,
  { provide: DrizzleAsyncProvider, useValue: mockDb },
  { provide: SignupsService, useValue: mockSignupsService },
  { provide: SettingsService, useValue: mockSettingsService },
  { provide: 'PugInviteService', useValue: null },
  { provide: 'DiscordBotClientService', useValue: null },
];

function buildMockDb() {
  selectCallCount = 0;
  const db: Record<string, jest.Mock> = {
    select: jest.fn().mockImplementation(() => {
      const idx = selectCallCount++;
      return makeChain(selectSequence[idx] ?? []);
    }),
    update: jest.fn().mockReturnValue(makeChain()),
    delete: jest.fn().mockReturnValue(makeChain()),
    insert: jest.fn().mockReturnValue(makeChain()),
    transaction: jest
      .fn()
      .mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn(db),
      ),
  };
  return db;
}

async function buildService() {
  mockDb = buildMockDb();
  const module = await Test.createTestingModule({
    providers: inviteProviders(),
  }).compile();
  return module.get(InviteService);
}

async function setupEach() {
  selectSequence = [[mockSlot], [mockEvent], [], [mockUserWithDiscord]];
  mockDb = buildMockDb();
  mockSignupsService = { signup: jest.fn().mockResolvedValue({ id: 1 }) };
  mockSettingsService = {
    getBranding: jest.fn().mockResolvedValue({ communityName: 'Test Guild' }),
    getClientUrl: jest.fn().mockResolvedValue('http://localhost:5173'),
  };

  const module: TestingModule = await Test.createTestingModule({
    providers: inviteProviders(),
  }).compile();

  service = module.get(InviteService);
}

// ---------------------------------------------------------------------------
// PugRoleSchema
// ---------------------------------------------------------------------------

function testPugRoleValid() {
  for (const role of ['tank', 'healer', 'dps', 'player'] as const) {
    expect(() => PugRoleSchema.parse(role)).not.toThrow();
    expect(PugRoleSchema.parse(role)).toBe(role);
  }
}

function testPugRoleInvalid() {
  expect(() => PugRoleSchema.parse('warrior')).toThrow();
  expect(() => PugRoleSchema.parse('')).toThrow();
  expect(() => PugRoleSchema.parse(null)).toThrow();
}

// ---------------------------------------------------------------------------
// Path 1: user WITH discordId
// ---------------------------------------------------------------------------

async function testPath1ReturnsSignup() {
  const result = await service.claimInvite('abc12345', 1);
  expect(result.type).toBe('signup');
  expect(result.eventId).toBe(42);
  expect(mockSignupsService.signup).toHaveBeenCalledTimes(1);
  expect(mockSignupsService.signup).toHaveBeenCalledWith(
    42,
    1,
    expect.objectContaining({ slotRole: 'dps' }),
  );
}

async function testPath1PlayerRole() {
  selectSequence = [
    [{ ...mockSlot, role: 'player' }],
    [mockEvent],
    [],
    [mockUserWithDiscord],
  ];
  const svc = await buildService();
  await svc.claimInvite('abc12345', 1);
  expect(mockSignupsService.signup).toHaveBeenCalledWith(
    42,
    1,
    expect.objectContaining({ slotRole: 'player' }),
  );
}

async function testPath1RoleOverride() {
  await service.claimInvite('abc12345', 1, 'tank');
  expect(mockSignupsService.signup).toHaveBeenCalledWith(
    42,
    1,
    expect.objectContaining({ slotRole: 'tank' }),
  );
}

async function testPath1DeletesSlot() {
  await service.claimInvite('abc12345', 1);
  expect(mockDb.delete).toHaveBeenCalled();
}

// ---------------------------------------------------------------------------
// Path 2: user WITHOUT discordId
// ---------------------------------------------------------------------------

async function testPath2ReturnsClaimed() {
  selectSequence = [[mockSlot], [mockEvent], [], [mockUserWithoutDiscord]];
  const svc = await buildService();
  const result = await svc.claimInvite('abc12345', 1);
  expect(result.type).toBe('claimed');
  expect(result.eventId).toBe(42);
}

async function testPath2UpdatesStatus() {
  selectSequence = [[mockSlot], [mockEvent], [], [mockUserWithoutDiscord]];
  const svc = await buildService();
  await svc.claimInvite('abc12345', 1);

  expect(mockDb.update).toHaveBeenCalled();
  const updateChain = mockDb.update.mock.results[0].value as Record<
    string,
    jest.Mock
  >;
  expect(updateChain.set).toHaveBeenCalledWith(
    expect.objectContaining({ status: 'claimed', claimedByUserId: 1 }),
  );
}

async function testPath2CallsSignup() {
  selectSequence = [[mockSlot], [mockEvent], [], [mockUserWithoutDiscord]];
  const svc = await buildService();
  await svc.claimInvite('abc12345', 1);
  expect(mockSignupsService.signup).toHaveBeenCalledTimes(1);
  expect(mockSignupsService.signup).toHaveBeenCalledWith(
    42,
    1,
    expect.objectContaining({ slotRole: 'dps' }),
  );
}

async function testPath2PlayerRole() {
  selectSequence = [
    [{ ...mockSlot, role: 'player' }],
    [mockEvent],
    [],
    [mockUserWithoutDiscord],
  ];
  const svc = await buildService();
  await svc.claimInvite('abc12345', 1);
  expect(mockSignupsService.signup).toHaveBeenCalledWith(
    42,
    1,
    expect.objectContaining({ slotRole: 'player' }),
  );
}

async function testPath2SignupFailNoUpdate() {
  selectSequence = [[mockSlot], [mockEvent], [], [mockUserWithoutDiscord]];
  const svc = await buildService();
  mockSignupsService.signup.mockRejectedValueOnce(
    new ConflictException('already signed up'),
  );
  await expect(svc.claimInvite('abc12345', 1)).rejects.toThrow(
    ConflictException,
  );
  expect(mockDb.update).not.toHaveBeenCalled();
}

async function testPath2SignupBeforeUpdate() {
  selectSequence = [[mockSlot], [mockEvent], [], [mockUserWithoutDiscord]];
  const svc = await buildService();
  const callOrder: string[] = [];
  mockSignupsService.signup.mockImplementation(() => {
    callOrder.push('signup');
    return Promise.resolve({ id: 1 });
  });
  mockDb.update.mockImplementation(() => {
    callOrder.push('update');
    return makeChain();
  });

  await svc.claimInvite('abc12345', 1);
  expect(callOrder).toEqual(['signup', 'update']);
}

// ---------------------------------------------------------------------------
// Error cases
// ---------------------------------------------------------------------------

async function testErrorInviteNotFound() {
  selectSequence = [[]];
  const svc = await buildService();
  await expect(svc.claimInvite('badcode', 1)).rejects.toThrow(
    NotFoundException,
  );
  expect(mockSignupsService.signup).not.toHaveBeenCalled();
}

async function testErrorAlreadyClaimed() {
  selectSequence = [[{ ...mockSlot, status: 'claimed' }]];
  const svc = await buildService();
  await expect(svc.claimInvite('abc12345', 1)).rejects.toThrow(
    ConflictException,
  );
}

async function testErrorEventEnded() {
  selectSequence = [
    [mockSlot],
    [{ ...mockEvent, duration: [PAST_DATE, PAST_DATE] as [Date, Date] }],
  ];
  const svc = await buildService();
  await expect(svc.claimInvite('abc12345', 1)).rejects.toThrow(
    BadRequestException,
  );
}

async function testErrorAlreadySignedUp() {
  selectSequence = [
    [mockSlot],
    [mockEvent],
    [{ id: 99 }],
    [mockUserWithDiscord],
  ];
  const svc = await buildService();
  await expect(svc.claimInvite('abc12345', 1)).rejects.toThrow(
    ConflictException,
  );
  expect(mockDb.delete).toHaveBeenCalled();
  expect(mockSignupsService.signup).not.toHaveBeenCalled();
}

beforeEach(() => setupEach());

describe('PugRoleSchema', () => {
  it('accepts valid PugRole values', () => testPugRoleValid());
  it('rejects unknown role values', () => testPugRoleInvalid());
});

describe('InviteService — Path 1 (user has discordId)', () => {
  it('returns type "signup" and calls signupsService', () =>
    testPath1ReturnsSignup());
  it('passes "player" role for generic rosters', () => testPath1PlayerRole());
  it('uses roleOverride when provided', () => testPath1RoleOverride());
  it('deletes PUG slot after signup', () => testPath1DeletesSlot());
});

describe('InviteService — Path 2 (no discordId)', () => {
  it('returns type "claimed"', () => testPath2ReturnsClaimed());
  it('updates pug_slots status to "claimed"', () => testPath2UpdatesStatus());
  it('calls signupsService.signup()', () => testPath2CallsSignup());
  it('passes "player" role for generic rosters', () => testPath2PlayerRole());
  it('rethrows signup failure without updating slot', () =>
    testPath2SignupFailNoUpdate());
  it('calls signup before updating PUG slot', () =>
    testPath2SignupBeforeUpdate());
});

describe('InviteService — error cases', () => {
  it('throws NotFoundException for missing invite code', () =>
    testErrorInviteNotFound());
  it('throws ConflictException for already claimed slot', () =>
    testErrorAlreadyClaimed());
  it('throws BadRequestException when event ended', () =>
    testErrorEventEnded());
  it('throws ConflictException when user already signed up', () =>
    testErrorAlreadySignedUp());
});
