import { SignupsService } from './signups.service';
import { createSignupsTestModule } from './signups.spec-helpers';

let service: SignupsService;
let mockDb: Record<string, jest.Mock>;

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

function setupDeleteMock() {
  mockDb.delete.mockReturnValueOnce({
    where: jest.fn().mockReturnValue({
      where: jest.fn().mockResolvedValue(undefined),
    }),
  });
}

function setupInsertAndUpdate() {
  mockDb.insert.mockReturnValueOnce({
    values: jest.fn().mockResolvedValue(undefined),
  });
  mockDb.update.mockReturnValueOnce({
    set: jest.fn().mockReturnValue({
      where: jest.fn().mockResolvedValue(undefined),
    }),
  });
}

async function setupEach() {
  const setup = await createSignupsTestModule();
  service = setup.service;
  mockDb = setup.mockDb;
  mockDb.transaction.mockImplementation(
    async (cb: (tx: typeof mockDb) => Promise<unknown>) => cb(mockDb),
  );
}

// ─── MMO promotion tests ────────────────────────────────────────────────────

function setupMmoBase(preferred: string[], userId: number, username: string) {
  mockDb.select
    .mockReturnValueOnce(makeSelectChain([{ slotConfig: mmoSlotConfig }]))
    .mockReturnValueOnce(
      makeSelectChain([{ preferredRoles: preferred, userId }]),
    )
    .mockReturnValueOnce(makeSelectChain([{ username }]));
}

function setupAutoAllocate(
  beforeSnapshot: unknown[],
  signups: unknown[],
  currentAssignments: unknown[],
  newAssignment: unknown[],
  afterSnapshot: unknown[],
) {
  mockDb.select
    .mockReturnValueOnce({
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockResolvedValue(beforeSnapshot),
      }),
    })
    .mockReturnValueOnce({
      from: jest
        .fn()
        .mockReturnValue({ where: jest.fn().mockResolvedValue(signups) }),
    })
    .mockReturnValueOnce({
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockResolvedValue(currentAssignments),
      }),
    })
    .mockReturnValueOnce(makeSelectChain(newAssignment))
    .mockReturnValueOnce({
      from: jest
        .fn()
        .mockReturnValue({ where: jest.fn().mockResolvedValue(afterSnapshot) }),
    });
}

async function testMmoPromotion() {
  setupMmoBase(['dps'], 1, 'DragonSlayer99');
  const signup = {
    id: 1,
    preferredRoles: ['dps'],
    status: 'signed_up',
    signedUpAt: new Date(),
  };
  setupAutoAllocate(
    [],
    [signup],
    [],
    [{ role: 'dps', position: 1 }],
    [{ id: 2, signupId: 1, role: 'dps', position: 1 }],
  );
  setupDeleteMock();
  setupInsertAndUpdate();
  const result = await service.promoteFromBench(1, 1);
  expect(result).toMatchObject({
    role: 'dps',
    position: 1,
    username: 'DragonSlayer99',
  });
}

async function testMmoAllocationFails() {
  setupMmoBase(['healer'], 2, 'CasualCarl');
  const fullHealers = [
    { id: 10, signupId: 10, role: 'healer', position: 1 },
    { id: 11, signupId: 11, role: 'healer', position: 2 },
    { id: 12, signupId: 12, role: 'healer', position: 3 },
    { id: 13, signupId: 13, role: 'healer', position: 4 },
  ];
  mockDb.select
    .mockReturnValueOnce({
      from: jest
        .fn()
        .mockReturnValue({ where: jest.fn().mockResolvedValue([]) }),
    })
    .mockReturnValueOnce({
      from: jest
        .fn()
        .mockReturnValue({ where: jest.fn().mockResolvedValue([]) }),
    })
    .mockReturnValueOnce({
      from: jest
        .fn()
        .mockReturnValue({ where: jest.fn().mockResolvedValue(fullHealers) }),
    })
    .mockReturnValueOnce(makeSelectChain([]));
  setupDeleteMock();
  mockDb.insert.mockReturnValueOnce({
    values: jest.fn().mockResolvedValue(undefined),
  });
  const result = await service.promoteFromBench(1, 2);
  expect(result).toMatchObject({
    role: 'bench',
    position: 1,
    username: 'CasualCarl',
  });
  expect(result?.warning).toMatch(/Could not find a suitable roster slot/);
}

async function testMmoRoleMismatchWarning() {
  setupMmoBase(['healer'], 1, 'HealerWannabe');
  const fullHealers = [
    { id: 10, signupId: 10, role: 'healer', position: 1 },
    { id: 11, signupId: 11, role: 'healer', position: 2 },
    { id: 12, signupId: 12, role: 'healer', position: 3 },
    { id: 13, signupId: 13, role: 'healer', position: 4 },
  ];
  const signup = {
    id: 1,
    preferredRoles: ['healer'],
    status: 'signed_up',
    signedUpAt: new Date(),
  };
  setupAutoAllocate(
    [],
    [signup],
    fullHealers,
    [{ role: 'dps', position: 1 }],
    [{ id: 20, signupId: 1, role: 'dps', position: 1 }],
  );
  setupDeleteMock();
  setupInsertAndUpdate();
  const result = await service.promoteFromBench(1, 1);
  expect(result?.role).toBe('dps');
  expect(result?.warning).toMatch(/not in their preferred roles/);
  expect(result?.warning).toMatch(/healer/);
}

async function testMmoChainMoves() {
  const before = [{ id: 5, signupId: 2, role: 'dps', position: 1 }];
  const after = [
    { id: 5, signupId: 2, role: 'healer', position: 1 },
    { id: 6, signupId: 1, role: 'dps', position: 2 },
  ];
  setupMmoBase(['dps'], 1, 'NewGuy');
  const signup = {
    id: 1,
    preferredRoles: ['dps'],
    status: 'signed_up',
    signedUpAt: new Date(),
  };
  setupAutoAllocate(
    before,
    [signup],
    before,
    [{ role: 'dps', position: 2 }],
    after,
  );
  mockDb.select
    .mockReturnValueOnce(
      makeSelectChainNoLimit([{ id: 2, userId: 2, discordUsername: null }]),
    )
    .mockReturnValueOnce(
      makeSelectChainNoLimit([{ id: 2, username: 'ChainedPlayer' }]),
    );
  setupDeleteMock();
  setupInsertAndUpdate();
  const result = await service.promoteFromBench(1, 1);
  expect(result?.chainMoves).toBeDefined();
  expect(result?.chainMoves?.length).toBeGreaterThan(0);
  expect(result?.chainMoves?.[0]).toMatch(/ChainedPlayer/);
  expect(result?.chainMoves?.[0]).toMatch(/dps.*healer|healer.*dps/);
}

async function testMmoPromotedNotInChainMoves() {
  const before: unknown[] = [];
  const after = [{ id: 6, signupId: 1, role: 'dps', position: 1 }];
  setupMmoBase(['dps'], 1, 'PromotedPlayer');
  const signup = {
    id: 1,
    preferredRoles: ['dps'],
    status: 'signed_up',
    signedUpAt: new Date(),
  };
  setupAutoAllocate(
    before,
    [signup],
    [],
    [{ role: 'dps', position: 1 }],
    after,
  );
  setupDeleteMock();
  setupInsertAndUpdate();
  const result = await service.promoteFromBench(1, 1);
  expect(result?.chainMoves).toEqual([]);
  expect(result?.warning).toBeUndefined();
}

async function testMmoDiscordFallbackForChain() {
  const before = [{ id: 5, signupId: 2, role: 'tank', position: 1 }];
  const after = [
    { id: 5, signupId: 2, role: 'dps', position: 1 },
    { id: 6, signupId: 1, role: 'tank', position: 2 },
  ];
  setupMmoBase(['tank'], 1, 'RLUser');
  const signup = {
    id: 1,
    preferredRoles: ['tank'],
    status: 'signed_up',
    signedUpAt: new Date(),
  };
  setupAutoAllocate(
    before,
    [signup],
    before,
    [{ role: 'tank', position: 2 }],
    after,
  );
  mockDb.select.mockReturnValueOnce(
    makeSelectChainNoLimit([
      { id: 2, userId: null, discordUsername: 'DiscordAnon#1234' },
    ]),
  );
  setupDeleteMock();
  setupInsertAndUpdate();
  const result = await service.promoteFromBench(1, 1);
  expect(result?.chainMoves?.[0]).toMatch(/DiscordAnon#1234/);
}

async function testMmoNoWarningOnMatch() {
  setupMmoBase(['dps'], 1, 'PerfectMatch');
  const signup = {
    id: 1,
    preferredRoles: ['dps'],
    status: 'signed_up',
    signedUpAt: new Date(),
  };
  setupAutoAllocate(
    [],
    [signup],
    [],
    [{ role: 'dps', position: 1 }],
    [{ id: 2, signupId: 1, role: 'dps', position: 1 }],
  );
  setupDeleteMock();
  setupInsertAndUpdate();
  const result = await service.promoteFromBench(1, 1);
  expect(result?.role).toBe('dps');
  expect(result?.warning).toBeUndefined();
  expect(result?.chainMoves).toEqual([]);
}

async function testMmoAnonymousFallback() {
  mockDb.select
    .mockReturnValueOnce(makeSelectChain([{ slotConfig: mmoSlotConfig }]))
    .mockReturnValueOnce(
      makeSelectChain([{ preferredRoles: ['dps'], userId: null }]),
    );
  // No username lookup because userId is null
  const signup = {
    id: 1,
    preferredRoles: ['dps'],
    status: 'signed_up',
    signedUpAt: new Date(),
  };
  mockDb.select
    .mockReturnValueOnce({
      from: jest
        .fn()
        .mockReturnValue({ where: jest.fn().mockResolvedValue([]) }),
    })
    .mockReturnValueOnce({
      from: jest
        .fn()
        .mockReturnValue({ where: jest.fn().mockResolvedValue([signup]) }),
    })
    .mockReturnValueOnce({
      from: jest
        .fn()
        .mockReturnValue({ where: jest.fn().mockResolvedValue([]) }),
    })
    .mockReturnValueOnce(makeSelectChain([{ role: 'dps', position: 1 }]))
    .mockReturnValueOnce({
      from: jest.fn().mockReturnValue({
        where: jest
          .fn()
          .mockResolvedValue([
            { id: 2, signupId: 1, role: 'dps', position: 1 },
          ]),
      }),
    });
  setupDeleteMock();
  setupInsertAndUpdate();
  const result = await service.promoteFromBench(1, 1);
  expect(result?.username).toBe('Bench player');
}

beforeEach(() => setupEach());

describe('SignupsService — MMO promotion success', () => {
  it('uses autoAllocateSignup and returns result', () => testMmoPromotion());
  it('returns bench with warning on failure', () => testMmoAllocationFails());
  it('includes role mismatch warning', () => testMmoRoleMismatchWarning());
});

describe('SignupsService — MMO chain moves', () => {
  it('includes chain move details', () => testMmoChainMoves());
  it('does not include promoted player', () =>
    testMmoPromotedNotInChainMoves());
  it('uses discordUsername for anonymous', () =>
    testMmoDiscordFallbackForChain());
});

describe('SignupsService — MMO edge cases', () => {
  it('no warning when preferred role matches', () => testMmoNoWarningOnMatch());
  it('falls back to "Bench player" for anonymous', () =>
    testMmoAnonymousFallback());
});
