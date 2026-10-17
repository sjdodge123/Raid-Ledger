import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PugsService } from './pugs.service';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { PUG_SLOT_EVENTS } from '../discord-bot/discord-bot.constants';

let testModule: TestingModule;
let service: PugsService;
let eventEmitter: jest.Mocked<EventEmitter2>;
let mockDb: {
  insert: jest.Mock;
  select: jest.Mock;
  update: jest.Mock;
  delete: jest.Mock;
};

const mockEvent = {
  id: 42,
  title: 'Test Raid',
  creatorId: 1,
  cancelledAt: null,
};

const mockInsertedPugSlot = {
  id: 'pug-uuid-123',
  eventId: 42,
  discordUsername: 'testplayer',
  discordUserId: null,
  discordAvatarHash: null,
  role: 'dps',
  class: null,
  spec: null,
  notes: null,
  status: 'pending',
  inviteCode: 'ab3cd4ef',
  serverInviteUrl: null,
  claimedByUserId: null,
  createdBy: 1,
  createdAt: new Date('2026-02-19T00:00:00Z'),
  updatedAt: new Date('2026-02-19T00:00:00Z'),
};

function createChainMock(resolvedValue: unknown[] = []) {
  const chain: Record<string, jest.Mock> = {};
  chain.from = jest.fn().mockReturnValue(chain);
  chain.where = jest.fn().mockReturnValue(chain);
  chain.limit = jest.fn().mockResolvedValue(resolvedValue);
  chain.set = jest.fn().mockReturnValue(chain);
  chain.values = jest.fn().mockReturnValue(chain);
  chain.returning = jest.fn().mockResolvedValue(resolvedValue);
  chain.orderBy = jest.fn().mockResolvedValue(resolvedValue);
  return chain;
}

async function setupEach() {
  let selectCallCount = 0;
  mockDb = {
    insert: jest.fn().mockReturnValue(createChainMock([mockInsertedPugSlot])),
    select: jest.fn().mockImplementation(() => {
      selectCallCount++;
      return selectCallCount === 1
        ? createChainMock([mockEvent])
        : createChainMock([]);
    }),
    update: jest.fn().mockReturnValue(createChainMock()),
    delete: jest.fn().mockReturnValue(createChainMock()),
  };

  testModule = await Test.createTestingModule({
    providers: [
      PugsService,
      { provide: DrizzleAsyncProvider, useValue: mockDb },
      { provide: EventEmitter2, useValue: { emit: jest.fn() } },
    ],
  }).compile();

  service = testModule.get(PugsService);
  eventEmitter = testModule.get(EventEmitter2);
}

async function teardownEach() {
  jest.clearAllMocks();
  await testModule.close();
}

async function testEmitsPugSlotCreated() {
  await service.create(42, 1, false, {
    discordUsername: 'testplayer',
    role: 'dps',
  });

  expect(eventEmitter.emit).toHaveBeenCalledWith(
    PUG_SLOT_EVENTS.CREATED,
    expect.objectContaining({
      pugSlotId: 'pug-uuid-123',
      eventId: 42,
      discordUsername: 'testplayer',
    }),
  );
}

async function testEmitsCorrectEventName() {
  await service.create(42, 1, false, {
    discordUsername: 'testplayer',
    role: 'tank',
  });
  expect(eventEmitter.emit).toHaveBeenCalledWith(
    'pug-slot.created',
    expect.anything(),
  );
}

async function testNoEmitOnFailure() {
  mockDb.insert.mockReturnValue({
    values: jest.fn().mockReturnValue({
      returning: jest
        .fn()
        .mockRejectedValue(Object.assign(new Error('unique_event_pug'), {})),
    }),
  });

  await expect(
    service.create(42, 1, false, {
      discordUsername: 'testplayer',
      role: 'dps',
    }),
  ).rejects.toThrow();

  expect(eventEmitter.emit).not.toHaveBeenCalled();
}

async function testReturnsValidDto() {
  const result = await service.create(42, 1, false, {
    discordUsername: 'testplayer',
    role: 'dps',
  });

  expect(result).toEqual(
    expect.objectContaining({
      id: 'pug-uuid-123',
      eventId: 42,
      discordUsername: 'testplayer',
      role: 'dps',
      status: 'pending',
    }),
  );
}

beforeEach(() => setupEach());
afterEach(() => teardownEach());

describe('PugsService — create', () => {
  it('should emit PUG_SLOT_EVENTS.CREATED after creation', () =>
    testEmitsPugSlotCreated());
  it('should emit with the correct event name string', () =>
    testEmitsCorrectEventName());
  it('should not emit event when creation fails', () => testNoEmitOnFailure());
  it('should return valid PugSlotResponseDto', () => testReturnsValidDto());
});

// ═══════════════════════════════════════════════════════════════════════════
// ROK-1621 — generating a share link must not materialise a roster occupant
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The web modal's own test proves the UI stops POSTing to /pugs. This proves
 * the SERVICE it now calls never inserts one either — otherwise the phantom
 * would simply move from the client's call site to the server's.
 *
 * MUTATION: make `createEventInviteLink` fall back to `this.create(...)` (the
 * pre-ROK-1621 shape) and the `insert` assertion fails on a received call.
 */
async function testInviteLinkInsertsNoPugRow(): Promise<void> {
  // event lookup -> no existing code; then the uniqueness probes find nothing.
  const res = await service.createEventInviteLink(42, 1, true);

  expect(res.inviteCode).toEqual(expect.any(String));
  expect(res.inviteCode).toHaveLength(8);
  // The whole point: no roster occupant was created.
  expect(mockDb.insert).not.toHaveBeenCalled();
}

/**
 * A second press must hand back the SAME link rather than rotating it —
 * otherwise every click invalidates the URL the organiser already shared.
 *
 * MUTATION: delete the `if (existing?.inviteCode) return ...` short-circuit
 * and this fails on the `update` assertion (a fresh code is written).
 */
async function testInviteLinkIsIdempotent(): Promise<void> {
  mockDb.select = jest
    .fn()
    .mockImplementation(() => createChainMock([{ inviteCode: 'keepme12' }]));

  const res = await service.createEventInviteLink(42, 1, true);

  expect(res.inviteCode).toBe('keepme12');
  expect(mockDb.update).not.toHaveBeenCalled();
  expect(mockDb.insert).not.toHaveBeenCalled();
}

/**
 * The CI discord-smoke tier caught a silent permission tightening here: the
 * path this replaces called `verifyEventExists`, so any member could generate
 * a share link, and `verifyEventPermission` narrowed that to creator/admin —
 * `/invite` started answering "Only event creator or admin/operator can manage
 * PUG slots". This pins the prior semantics so it cannot regress silently
 * again; changing it is a product decision, not a refactor side effect.
 *
 * MUTATION: swap `verifyEventExists` back for `verifyEventPermission` in
 * `createEventInviteLink` and this fails — the non-creator is refused.
 */
async function testInviteLinkAllowsNonCreator(): Promise<void> {
  // userId 99 is neither the event creator (1) nor an admin.
  const res = await service.createEventInviteLink(42, 99, false);

  expect(res.inviteCode).toEqual(expect.any(String));
}

describe('PugsService — createEventInviteLink (ROK-1621)', () => {
  it('lets a non-creator member generate the share link, as before', () =>
    testInviteLinkAllowsNonCreator());
  it('creates no pug_slots row when a share link is generated', () =>
    testInviteLinkInsertsNoPugRow());
  it('returns the existing code on a repeat press, rotating nothing', () =>
    testInviteLinkIsIdempotent());
});
