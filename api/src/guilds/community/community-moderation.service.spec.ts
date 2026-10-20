/** ROK-1870 review — transfer rollback, unban ladder, status copy. */
import { Test } from '@nestjs/testing';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import type * as schema from '../../drizzle/schema';
import type { GuildActor } from '../guild-access.service';
import * as lookup from './community-hub.lookup';
import * as mq from './community-membership.queries';
import { CommunityMembershipService } from './community-membership.service';
import { CommunityModerationService } from './community-moderation.service';
import * as users from './community-proposals.users';

jest.mock('./community-hub.lookup', () => ({
  ...jest.requireActual('./community-hub.lookup'),
  requireCommunityHub: jest.fn(),
  assertUserExists: jest.fn(),
}));
jest.mock('./community-membership.queries');
jest.mock('./community-proposals.users');

const AT = new Date('2026-10-01T00:00:00Z');
const leader: GuildActor = { id: 1, role: 'member' };
const officer: GuildActor = { id: 2, role: 'member' };

function memberRow(
  over: Partial<schema.HubCommunityMemberSelect>,
): schema.HubCommunityMemberSelect {
  return {
    id: 50,
    guildId: 7,
    userId: 3,
    role: 'member',
    joinedAt: AT,
    leftAt: null,
    removedBy: null,
    bannedAt: null,
    bannedBy: null,
    banReason: null,
    createdAt: AT,
    updatedAt: AT,
    ...over,
  };
}

const HUB: schema.GuildSelect = {
  id: 7,
  gameId: 9,
  kind: 'game_community',
  region: 'community',
  name: 'Crew',
  nameKey: 'crew',
  realmSlug: null,
  guildSlug: null,
  faction: null,
  memberCount: 2,
  source: 'community',
  lastSnapshotAt: null,
  rawRealm: null,
  pelicanServerId: null,
  hiddenAt: null,
  status: 'active',
  blurb: null,
  proposedBy: null,
  blizzardGuildId: null,
  reviewedBy: null,
  reviewedAt: null,
  archivedAt: null,
  archivedReason: null,
  createdAt: AT,
  updatedAt: AT,
};

const members = {
  role: jest.fn(),
  assertLeader: jest.fn(),
  liveTarget: jest.fn(),
};
let rolledBack = false;
const db = {
  select: jest.fn(),
  update: jest.fn(),
  transaction: async (fn: (tx: object) => Promise<unknown>) => {
    try {
      return await fn({});
    } catch (err: unknown) {
      rolledBack = true;
      throw err;
    }
  },
};
let svc: CommunityModerationService;

beforeEach(async () => {
  jest.clearAllMocks();
  rolledBack = false;
  const mod = await Test.createTestingModule({
    providers: [
      CommunityModerationService,
      { provide: DrizzleAsyncProvider, useValue: db },
      { provide: CommunityMembershipService, useValue: members },
    ],
  }).compile();
  svc = mod.get(CommunityModerationService);
  members.liveTarget.mockResolvedValue(memberRow({}));
  jest.mocked(users.findProposalUser).mockResolvedValue({
    id: 3,
    username: 'tgt',
    discordId: 'd3',
    guildMemberSeenAt: AT,
    deactivatedAt: null,
  });
});

describe('transferLeader', () => {
  it('throws INSIDE the transaction when the swap misses, so it rolls back', async () => {
    jest.mocked(mq.swapLeader).mockResolvedValue(false);
    await expect(svc.transferLeader(leader, 7, 3)).rejects.toThrow(
      NotFoundException,
    );
    expect(rolledBack).toBe(true);
  });

  it('maps a one-leader unique clash to 409, not 500', async () => {
    jest
      .mocked(mq.swapLeader)
      .mockRejectedValue(Object.assign(new Error('dup'), { code: '23505' }));
    await expect(svc.transferLeader(leader, 7, 3)).rejects.toThrow(
      ConflictException,
    );
  });

  it('refuses a deactivated target (409)', async () => {
    jest.mocked(users.findProposalUser).mockResolvedValue({
      id: 3,
      username: 'tgt',
      discordId: 'd3',
      guildMemberSeenAt: AT,
      deactivatedAt: AT,
    });
    await expect(svc.transferLeader(leader, 7, 3)).rejects.toThrow(
      ConflictException,
    );
    expect(mq.swapLeader).not.toHaveBeenCalled();
  });

  it('commits a clean swap', async () => {
    jest.mocked(mq.swapLeader).mockResolvedValue(true);
    await expect(svc.transferLeader(leader, 7, 3)).resolves.toEqual({
      leaderUserId: 3,
    });
    expect(rolledBack).toBe(false);
  });
});

describe('unbanUser — the D7 ladder', () => {
  it('an officer cannot lift a ban on an officer (403)', async () => {
    members.role.mockResolvedValue('officer');
    jest
      .mocked(mq.findMembership)
      .mockResolvedValue(memberRow({ role: 'officer', bannedAt: AT }));
    await expect(svc.unbanUser(officer, 7, 3)).rejects.toThrow(
      ForbiddenException,
    );
    expect(mq.unban).not.toHaveBeenCalled();
  });

  it('an officer lifts a ban on a member', async () => {
    members.role.mockResolvedValue('officer');
    jest
      .mocked(mq.findMembership)
      .mockResolvedValue(memberRow({ bannedAt: AT }));
    jest.mocked(mq.unban).mockResolvedValue(true);
    await expect(svc.unbanUser(officer, 7, 3)).resolves.toBeUndefined();
  });

  it('404 when the user is not banned', async () => {
    members.role.mockResolvedValue('leader');
    jest.mocked(mq.findMembership).mockResolvedValue(memberRow({}));
    await expect(svc.unbanUser(leader, 7, 3)).rejects.toThrow(
      NotFoundException,
    );
  });
});

describe('setStatus copy', () => {
  it('a live non-leader archiving gets the leader-only copy', async () => {
    jest.mocked(lookup.requireCommunityHub).mockResolvedValue(HUB);
    jest.mocked(mq.findMembership).mockResolvedValue(memberRow({ userId: 2 }));
    await expect(
      svc.setStatus(officer, 7, { status: 'archived' }),
    ).rejects.toThrow('Guild leader access required');
  });

  it('a non-staff leader of a hidden hub cannot archive it (404)', async () => {
    const hidden = { ...HUB, hiddenAt: AT };
    jest.mocked(lookup.requireCommunityHub).mockResolvedValue(hidden);
    jest
      .mocked(mq.findMembership)
      .mockResolvedValue(memberRow({ role: 'leader' }));
    await expect(
      svc.setStatus(leader, 7, { status: 'archived' }),
    ).rejects.toThrow(NotFoundException);
  });

  it('a staff restore of a hidden hub never clears hidden_at', async () => {
    const hub = { ...HUB, status: 'archived' as const, hiddenAt: AT };
    jest.mocked(lookup.requireCommunityHub).mockResolvedValue(hub);
    jest.mocked(mq.findMembership).mockResolvedValue(null);
    const limit = jest.fn().mockResolvedValue([]);
    db.select.mockReturnValue({ from: () => ({ where: () => ({ limit }) }) });
    const where = jest.fn().mockResolvedValue(undefined);
    const set = jest.fn().mockReturnValue({ where });
    db.update.mockReturnValue({ set });
    await expect(
      svc.setStatus({ id: 9, role: 'admin' }, 7, { status: 'active' }),
    ).resolves.toEqual({ status: 'active' });
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'active' }),
    );
    expect(Object.keys(set.mock.calls[0]?.[0] ?? {})).not.toContain('hiddenAt');
  });
});

describe('banUser (M22)', () => {
  it('reads the target role under the hub lock — the new leader cannot be banned', async () => {
    const order: string[] = [];
    jest.mocked(lookup.requireCommunityHub).mockResolvedValue(HUB);
    jest.mocked(mq.lockHubRow).mockImplementation(() => {
      order.push('lock');
      return Promise.resolve({ status: 'active' });
    });
    jest.mocked(mq.findMembership).mockImplementation(() => {
      order.push('read');
      return Promise.resolve(memberRow({ userId: 3, role: 'leader' }));
    });
    await expect(svc.banUser(leader, 7, 3, {})).rejects.toThrow(
      ConflictException,
    );
    expect(order).toEqual(['lock', 'read']);
    expect(mq.findMembership).toHaveBeenCalledWith({}, 7, 3);
    expect(mq.ban).not.toHaveBeenCalled();
    expect(rolledBack).toBe(true);
  });
});
