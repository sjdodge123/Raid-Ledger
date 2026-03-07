import { SignupsService } from './signups.service';
import {
  createSignupsTestModule,
  mockEvent,
  mockSignup,
  type SignupsMocks,
} from './signups.spec-helpers';

let service: SignupsService;
let mockDb: Record<string, jest.Mock>;
let mockNotificationService: SignupsMocks['mockNotificationService'];

function makeSelectChain(resolved: unknown[]) {
  return {
    from: jest.fn().mockReturnValue({
      where: jest.fn().mockReturnValue({
        limit: jest.fn().mockResolvedValue(resolved),
      }),
    }),
  };
}

function makeSelectChainNoLimit(resolved: unknown[]) {
  return {
    from: jest.fn().mockReturnValue({
      where: jest.fn().mockResolvedValue(resolved),
    }),
  };
}

async function setupEach() {
  const setup = await createSignupsTestModule();
  service = setup.service;
  mockDb = setup.mockDb;
  mockNotificationService = setup.mockNotificationService;
}

const emptyRoster = {
  eventId: 1,
  pool: [],
  assignments: [],
  slots: { player: 10, bench: 5 },
};

function setupRosterUpdateMocks(eventTitle: string, oldAssignments: unknown[]) {
  mockDb.select
    .mockReturnValueOnce(makeSelectChain([{ ...mockEvent, title: eventTitle }]))
    .mockReturnValueOnce(makeSelectChainNoLimit([mockSignup]))
    .mockReturnValueOnce(makeSelectChainNoLimit(oldAssignments));
  mockDb.delete.mockReturnValueOnce({
    where: jest.fn().mockResolvedValue(undefined),
  });
  mockDb.insert.mockReturnValueOnce({
    values: jest.fn().mockResolvedValue(undefined),
  });
}

// ─── updateRoster tests ─────────────────────────────────────────────────────

async function testPermissionError() {
  mockDb.select.mockReturnValueOnce(
    makeSelectChain([{ ...mockEvent, creatorId: 999 }]),
  );
  await expect(
    service.updateRoster(1, 1, false, { assignments: [] }),
  ).rejects.toThrow('Only event creator, admin, or operator can update roster');
}

async function testRoleChangeNotification() {
  jest
    .spyOn(service, 'getRosterWithAssignments')
    .mockResolvedValueOnce(emptyRoster);
  const oldAssignment = {
    id: 10,
    signupId: 1,
    role: 'healer',
    position: 1,
    eventId: 1,
    isOverride: 0,
  };
  setupRosterUpdateMocks('Raid Night', [oldAssignment]);
  await service.updateRoster(1, 1, true, {
    assignments: [
      { userId: 1, signupId: 1, slot: 'dps', position: 3, isOverride: false },
    ],
  });
  await new Promise((r) => setTimeout(r, 50));
  expect(mockNotificationService.create).toHaveBeenCalledWith(
    expect.objectContaining({
      userId: 1,
      type: 'roster_reassigned',
      title: 'Role Changed',
      payload: expect.objectContaining({ oldRole: 'healer', newRole: 'dps' }),
    }),
  );
}

async function testBenchPromotedType() {
  jest
    .spyOn(service, 'getRosterWithAssignments')
    .mockResolvedValueOnce(emptyRoster);
  const oldAssignment = {
    id: 10,
    signupId: 1,
    role: 'bench',
    position: 1,
    eventId: 1,
    isOverride: 0,
  };
  setupRosterUpdateMocks('Raid Night', [oldAssignment]);
  await service.updateRoster(1, 1, true, {
    assignments: [
      { userId: 1, signupId: 1, slot: 'tank', position: 1, isOverride: false },
    ],
  });
  await new Promise((r) => setTimeout(r, 50));
  expect(mockNotificationService.create).toHaveBeenCalledWith(
    expect.objectContaining({
      type: 'bench_promoted',
      title: 'Promoted from Bench',
    }),
  );
}

async function testNoNotifyOnSameRole() {
  jest
    .spyOn(service, 'getRosterWithAssignments')
    .mockResolvedValueOnce(emptyRoster);
  const oldAssignment = {
    id: 10,
    signupId: 1,
    role: 'dps',
    position: 1,
    eventId: 1,
    isOverride: 0,
  };
  setupRosterUpdateMocks('Raid', [oldAssignment]);
  await service.updateRoster(1, 1, true, {
    assignments: [
      { userId: 1, signupId: 1, slot: 'dps', position: 5, isOverride: false },
    ],
  });
  await new Promise((r) => setTimeout(r, 50));
  expect(mockNotificationService.create).not.toHaveBeenCalled();
}

async function testMovedToBench() {
  jest
    .spyOn(service, 'getRosterWithAssignments')
    .mockResolvedValueOnce(emptyRoster);
  const oldAssignment = {
    id: 10,
    signupId: 1,
    role: 'healer',
    position: 2,
    eventId: 1,
    isOverride: 0,
  };
  setupRosterUpdateMocks('Raid Night', [oldAssignment]);
  await service.updateRoster(1, 1, true, {
    assignments: [
      { userId: 1, signupId: 1, slot: 'bench', position: 1, isOverride: false },
    ],
  });
  await new Promise((r) => setTimeout(r, 50));
  expect(mockNotificationService.create).toHaveBeenCalledWith(
    expect.objectContaining({
      type: 'roster_reassigned',
      title: 'Moved to Bench',
    }),
  );
}

// ─── notifyNewAssignments tests ─────────────────────────────────────────────

function setupNewAssignment(eventTitle: string, newSlot: string) {
  jest
    .spyOn(service, 'getRosterWithAssignments')
    .mockResolvedValueOnce(emptyRoster);
  setupRosterUpdateMocks(eventTitle, []);
  return service.updateRoster(1, 1, true, {
    assignments: [
      {
        userId: 1,
        signupId: 1,
        slot: newSlot as never,
        position: 1,
        isOverride: false,
      },
    ],
  });
}

async function testGenericPlayerMessage() {
  await setupNewAssignment('Phasmophobia Night', 'player');
  await new Promise((r) => setTimeout(r, 50));
  expect(mockNotificationService.create).toHaveBeenCalledWith(
    expect.objectContaining({
      type: 'roster_reassigned',
      message: "You've been assigned to the roster for Phasmophobia Night",
    }),
  );
}

async function testNoPlayerRoleWording() {
  await setupNewAssignment('Phasmophobia Night', 'player');
  await new Promise((r) => setTimeout(r, 50));
  const call = (
    mockNotificationService.create.mock.calls[0] as [{ message: string }]
  )[0];
  expect(call.message).not.toContain('Player role');
  expect(call.message).not.toContain('the Player');
}

async function testTankRoleLanguage() {
  await setupNewAssignment('Mythic Raid', 'tank');
  await new Promise((r) => setTimeout(r, 50));
  expect(mockNotificationService.create).toHaveBeenCalledWith(
    expect.objectContaining({
      message: "You've been assigned to the Tank role for Mythic Raid",
    }),
  );
}

async function testHealerRoleLanguage() {
  await setupNewAssignment('Mythic Raid', 'healer');
  await new Promise((r) => setTimeout(r, 50));
  expect(mockNotificationService.create).toHaveBeenCalledWith(
    expect.objectContaining({
      message: "You've been assigned to the Healer role for Mythic Raid",
    }),
  );
}

async function testDpsRoleLanguage() {
  await setupNewAssignment('Mythic Raid', 'dps');
  await new Promise((r) => setTimeout(r, 50));
  expect(mockNotificationService.create).toHaveBeenCalledWith(
    expect.objectContaining({
      message: "You've been assigned to the Dps role for Mythic Raid",
    }),
  );
}

async function testNewRoleInPayload() {
  await setupNewAssignment('Game Night', 'player');
  await new Promise((r) => setTimeout(r, 50));
  expect(mockNotificationService.create).toHaveBeenCalledWith(
    expect.objectContaining({
      payload: expect.objectContaining({ newRole: 'player' }),
    }),
  );
}

async function testNoNotifyWhenOldRoleSet() {
  jest
    .spyOn(service, 'getRosterWithAssignments')
    .mockResolvedValueOnce(emptyRoster);
  const oldAssignment = {
    id: 10,
    signupId: 1,
    role: 'healer',
    position: 1,
    eventId: 1,
    isOverride: 0,
  };
  setupRosterUpdateMocks('Raid', [oldAssignment]);
  await service.updateRoster(1, 1, true, {
    assignments: [
      {
        userId: 1,
        signupId: 1,
        slot: 'player' as never,
        position: 1,
        isOverride: false,
      },
    ],
  });
  await new Promise((r) => setTimeout(r, 50));
  const calls = mockNotificationService.create.mock.calls as Array<
    [{ message?: string }]
  >;
  const genericCall = calls.find(
    (c) =>
      typeof c[0].message === 'string' &&
      c[0].message.includes('assigned to the roster for'),
  );
  expect(genericCall).toBeUndefined();
}

beforeEach(() => setupEach());

describe('SignupsService — updateRoster role changes', () => {
  it('should include "operator" in permission error', () =>
    testPermissionError());
  it('should notify on role change', () => testRoleChangeNotification());
  it('should use bench_promoted type', () => testBenchPromotedType());
  it('should NOT notify on same-role change', () => testNoNotifyOnSameRole());
  it('should send reassigned when moved to bench', () => testMovedToBench());
});

describe('SignupsService — notifyNewAssignments', () => {
  it('uses generic message for player', () => testGenericPlayerMessage());
  it('does NOT include Player role wording', () => testNoPlayerRoleWording());
  it('uses role-specific language for tank', () => testTankRoleLanguage());
  it('uses role-specific language for healer', () => testHealerRoleLanguage());
  it('uses role-specific language for dps', () => testDpsRoleLanguage());
  it('passes newRole in payload', () => testNewRoleInPayload());
  it('does not notify when oldRole is set', () => testNoNotifyWhenOldRoleSet());
});
