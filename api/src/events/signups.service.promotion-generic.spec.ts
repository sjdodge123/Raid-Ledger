import { SignupsService } from './signups.service';
import {
  createSignupsTestModule,
  type SignupsMocks,
} from './signups.spec-helpers';

let service: SignupsService;
let mockDb: Record<string, jest.Mock>;

const genericSlotConfig = { type: 'generic', player: 10, bench: 5 };
const mmoSlotConfig = { type: 'mmo', tank: 2, healer: 4, dps: 14, bench: 5 };

function makeSelectChain(returnValue: unknown) {
  return {
    from: jest.fn().mockReturnValue({
      where: jest.fn().mockReturnValue({
        limit: jest.fn().mockResolvedValue(returnValue),
      }),
    }),
  };
}

function makeSelectChainNoLimit(returnValue: unknown) {
  return {
    from: jest.fn().mockReturnValue({
      where: jest.fn().mockResolvedValue(returnValue),
    }),
  };
}

async function setupEach() {
  const setup = await createSignupsTestModule();
  service = setup.service;
  mockDb = setup.mockDb;
  mockDb.transaction.mockImplementation(
    async (cb: (tx: typeof mockDb) => Promise<unknown>) => cb(mockDb),
  );
}

// ─── promoteFromBench — shared guard tests ──────────────────────────────────

async function testNoSlotConfig() {
  mockDb.select.mockReturnValueOnce(makeSelectChain([{ slotConfig: null }]));
  expect(await service.promoteFromBench(1, 1)).toBeNull();
}

async function testEventNotFound() {
  mockDb.select.mockReturnValueOnce(makeSelectChain([]));
  expect(await service.promoteFromBench(1, 1)).toBeNull();
}

async function testSignupNotFound() {
  mockDb.select
    .mockReturnValueOnce(makeSelectChain([{ slotConfig: mmoSlotConfig }]))
    .mockReturnValueOnce(makeSelectChain([]));
  expect(await service.promoteFromBench(1, 99)).toBeNull();
}

// ─── generic event promotion tests ──────────────────────────────────────────

async function testPromoteToPlayerSlot() {
  mockDb.select
    .mockReturnValueOnce(makeSelectChain([{ slotConfig: genericSlotConfig }]))
    .mockReturnValueOnce(makeSelectChain([{ preferredRoles: null, userId: 1 }]))
    .mockReturnValueOnce(makeSelectChain([{ username: 'HeroPlayer' }]));
  mockDb.delete.mockReturnValueOnce({
    where: jest.fn().mockResolvedValue(undefined),
  });
  mockDb.select.mockReturnValueOnce(
    makeSelectChainNoLimit([{ position: 1 }, { position: 2 }]),
  );
  mockDb.insert.mockReturnValueOnce({
    values: jest.fn().mockResolvedValue(undefined),
  });
  mockDb.update.mockReturnValueOnce({
    set: jest.fn().mockReturnValue({
      where: jest.fn().mockResolvedValue(undefined),
    }),
  });
  const result = await service.promoteFromBench(1, 1);
  expect(result).toMatchObject({ role: 'player', username: 'HeroPlayer' });
  expect(result?.position).toBeGreaterThan(0);
  expect(result?.warning).toBeUndefined();
}

async function testPromoteFullSlots() {
  const fullConfig = { type: 'generic', player: 2, bench: 5 };
  mockDb.select
    .mockReturnValueOnce(makeSelectChain([{ slotConfig: fullConfig }]))
    .mockReturnValueOnce(makeSelectChain([{ preferredRoles: null, userId: 1 }]))
    .mockReturnValueOnce(makeSelectChain([{ username: 'BenchedPlayer' }]));
  mockDb.delete.mockReturnValueOnce({
    where: jest.fn().mockResolvedValue(undefined),
  });
  mockDb.select.mockReturnValueOnce(
    makeSelectChainNoLimit([{ position: 1 }, { position: 2 }]),
  );
  mockDb.insert.mockReturnValueOnce({
    values: jest.fn().mockResolvedValue(undefined),
  });
  const result = await service.promoteFromBench(1, 1);
  expect(result).toMatchObject({
    role: 'bench',
    position: 1,
    username: 'BenchedPlayer',
  });
  expect(result?.warning).toMatch(/All player slots are full/);
}

async function testPromoteFillsGap() {
  const config = { type: 'generic', player: 5, bench: 5 };
  mockDb.select
    .mockReturnValueOnce(makeSelectChain([{ slotConfig: config }]))
    .mockReturnValueOnce(makeSelectChain([{ preferredRoles: null, userId: 1 }]))
    .mockReturnValueOnce(makeSelectChain([{ username: 'GapFiller' }]));
  mockDb.delete.mockReturnValueOnce({
    where: jest.fn().mockResolvedValue(undefined),
  });
  mockDb.select.mockReturnValueOnce(
    makeSelectChainNoLimit([{ position: 1 }, { position: 3 }]),
  );
  mockDb.insert.mockReturnValueOnce({
    values: jest.fn().mockResolvedValue(undefined),
  });
  mockDb.update.mockReturnValueOnce({
    set: jest.fn().mockReturnValue({
      where: jest.fn().mockResolvedValue(undefined),
    }),
  });
  const result = await service.promoteFromBench(1, 1);
  expect(result?.role).toBe('player');
  expect(result?.position).toBe(2);
}

beforeEach(() => setupEach());

describe('SignupsService — promoteFromBench guards', () => {
  it('returns null when no slotConfig', () => testNoSlotConfig());
  it('returns null when event not found', () => testEventNotFound());
  it('returns null when signup not found', () => testSignupNotFound());
});

describe('SignupsService — generic event promotion', () => {
  it('promotes to first open player slot', () => testPromoteToPlayerSlot());
  it('returns bench with warning when full', () => testPromoteFullSlots());
  it('fills gap in player positions', () => testPromoteFillsGap());
});
