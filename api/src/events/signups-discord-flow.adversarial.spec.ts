/**
 * Adversarial tests for ROK-626: discordSignupTxBody bench fallback.
 * Tests that anonymous Discord signups are benched when roster is full.
 */
import * as signupH from './signups-signup.helpers';
import * as discordH from './signups-discord.helpers';
import * as rosterQH from './signups-roster-query.helpers';
import { discordSignupTxBody } from './signups-flow.helpers';
import type { FlowDeps } from './signups-flow.helpers';

jest.mock('./signups-signup.helpers');
jest.mock('./signups-discord.helpers');
jest.mock('./signups-roster-query.helpers');

const mockSignupH = signupH as jest.Mocked<typeof signupH>;
const mockDiscordH = discordH as jest.Mocked<typeof discordH>;
const mockRosterQH = rosterQH as jest.Mocked<typeof rosterQH>;

function createMockDeps(): FlowDeps {
  return {
    db: {} as FlowDeps['db'],
    logger: { log: jest.fn(), warn: jest.fn() },
    cancelPromotion: jest.fn().mockResolvedValue(undefined),
    autoAllocateSignup: jest.fn().mockResolvedValue(undefined),
  };
}

function createMockTx() {
  return {
    select: jest.fn().mockReturnValue({
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue({
          limit: jest.fn().mockResolvedValue([]),
        }),
      }),
    }),
    insert: jest.fn().mockReturnValue({
      values: jest.fn().mockResolvedValue(undefined),
    }),
  } as unknown as Parameters<typeof discordSignupTxBody>[1];
}

const mockEvent = {
  id: 1,
  title: 'Test Event',
  creatorId: 99,
  slotConfig: null,
  maxAttendees: 5,
} as Parameters<typeof discordSignupTxBody>[2];

const mockDto = {
  discordUserId: 'disc-123',
  discordUsername: 'TestUser',
  discordAvatarHash: null,
  role: 'dps' as const,
};

const insertedSignup = {
  id: 42,
  eventId: 1,
  userId: null,
  discordUserId: 'disc-123',
  discordUsername: 'TestUser',
  discordAvatarHash: null,
  signedUpAt: new Date(),
  confirmationStatus: 'confirmed',
  status: 'signed_up',
  note: null,
  characterId: null,
  preferredRoles: null,
  attendanceStatus: null,
  attendanceRecordedAt: null,
  roachedOutAt: null,
};

describe('discordSignupTxBody — bench fallback (ROK-626)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDiscordH.insertDiscordSignupRow.mockResolvedValue([insertedSignup]);
    mockDiscordH.allocateDiscordSlot.mockResolvedValue(undefined);
    mockSignupH.checkAutoBench.mockResolvedValue(false);
    mockRosterQH.findNextPosition.mockResolvedValue(1);
    mockRosterQH.getAssignedSlotRole.mockResolvedValue(null);
  });

  it('calls allocateDiscordSlot when roster is not full', async () => {
    const deps = createMockDeps();
    const tx = createMockTx();

    await discordSignupTxBody(deps, tx, mockEvent, 1, mockDto);

    expect(mockSignupH.checkAutoBench).toHaveBeenCalledWith(tx, mockEvent, 1);
    expect(mockDiscordH.allocateDiscordSlot).toHaveBeenCalled();
  });

  it('assigns bench fallback when roster is full', async () => {
    mockSignupH.checkAutoBench.mockResolvedValue(true);
    const deps = createMockDeps();
    const tx = createMockTx();

    await discordSignupTxBody(deps, tx, mockEvent, 1, mockDto);

    // allocateDiscordSlot should NOT have been called
    expect(mockDiscordH.allocateDiscordSlot).not.toHaveBeenCalled();
    // bench fallback inserts a roster assignment
    expect(tx.insert).toHaveBeenCalled();
    expect(deps.logger.log).toHaveBeenCalledWith(
      expect.stringContaining('Auto-benched'),
    );
  });

  it('returns existing signup on duplicate insert', async () => {
    const existingSignup = { ...insertedSignup, id: 99 };
    mockDiscordH.insertDiscordSignupRow.mockResolvedValue([]);
    mockDiscordH.fetchExistingDiscordSignup.mockResolvedValue(existingSignup);

    const deps = createMockDeps();
    const tx = createMockTx();

    const result = await discordSignupTxBody(deps, tx, mockEvent, 1, mockDto);

    expect(result).toEqual({ signup: existingSignup, assignedSlot: null });
    // checkAutoBench should NOT have been called for duplicates
    expect(mockSignupH.checkAutoBench).not.toHaveBeenCalled();
  });

  it('logs anonymous user info after signup', async () => {
    const deps = createMockDeps();
    const tx = createMockTx();

    await discordSignupTxBody(deps, tx, mockEvent, 1, mockDto);

    expect(deps.logger.log).toHaveBeenCalledWith(
      expect.stringContaining('TestUser'),
    );
    expect(deps.logger.log).toHaveBeenCalledWith(
      expect.stringContaining('disc-123'),
    );
  });
});
