import { Test } from '@nestjs/testing';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import { NotificationService } from '../../notifications/notification.service';
import { CommunityProposalsService } from './community-proposals.service';
import * as schema from '../../drizzle/schema';
import * as q from './community-proposals.queries';
import * as users from './community-proposals.users';
import * as members from './community-membership.queries';

jest.mock('./community-proposals.queries', () => ({
  ...jest.requireActual('./community-proposals.queries'),
  findGameName: jest.fn(),
  hasNameClash: jest.fn(),
  openProposalGameIds: jest.fn(),
  lockProposer: jest.fn(),
  insertCommunityHub: jest.fn(),
  lockProposal: jest.fn(),
  listProposals: jest.fn(),
  activateProposal: jest.fn(),
  deleteProposal: jest.fn(),
}));
jest.mock('./community-proposals.users');
jest.mock('./community-membership.queries');

const SEEN = new Date('2026-10-01T00:00:00Z');
const inGuild = {
  id: 5,
  username: 'alice',
  discordId: 'd5',
  guildMemberSeenAt: SEEN,
  deactivatedAt: null,
};
const member = { id: 5, role: 'member' as const };
const dto = { gameId: 9, name: 'BG3 Crew', blurb: 'Act 3 runs' };
const hubRow: schema.GuildSelect = {
  id: 40,
  gameId: 9,
  kind: 'game_community',
  region: 'community',
  name: 'BG3 Crew',
  nameKey: 'bg3 crew',
  realmSlug: null,
  guildSlug: null,
  faction: null,
  memberCount: 1,
  source: 'community',
  lastSnapshotAt: null,
  rawRealm: null,
  pelicanServerId: null,
  hiddenAt: null,
  status: 'active',
  blurb: 'Act 3 runs',
  proposedBy: 5,
  blizzardGuildId: null,
  reviewedBy: null,
  reviewedAt: null,
  archivedAt: null,
  archivedReason: null,
  createdAt: SEEN,
  updatedAt: SEEN,
};
const proposedRow: schema.GuildSelect = { ...hubRow, status: 'proposed' };
const proposal = {
  id: 40,
  gameId: 9,
  gameName: 'BG3',
  gameIconUrl: null,
  name: 'BG3 Crew',
  blurb: 'b',
  proposedBy: { userId: 5, username: 'alice', avatarUrl: null },
  createdAt: SEEN.toISOString(),
};

const mocked = <T extends (...a: never[]) => unknown>(fn: T) => jest.mocked(fn);
const create = jest.fn();
const tx = {};
let svc: CommunityProposalsService;

beforeEach(async () => {
  jest.clearAllMocks();
  create.mockResolvedValue({ id: 'n' });
  const mod = await Test.createTestingModule({
    providers: [
      CommunityProposalsService,
      {
        provide: DrizzleAsyncProvider,
        useValue: { transaction: (fn: (t: object) => unknown) => fn(tx) },
      },
      { provide: NotificationService, useValue: { create } },
    ],
  }).compile();
  svc = mod.get(CommunityProposalsService);
  mocked(users.findProposalUser).mockResolvedValue(inGuild);
  mocked(users.staffUserIds).mockResolvedValue([1, 2]);
  mocked(q.findGameName).mockResolvedValue('BG3');
  mocked(q.openProposalGameIds).mockResolvedValue([]);
  mocked(q.hasNameClash).mockResolvedValue(false);
  mocked(q.insertCommunityHub).mockResolvedValue(proposedRow);
  mocked(q.listProposals).mockResolvedValue([proposal]);
});

describe('propose', () => {
  it('403 when the user is not in the Discord guild', async () => {
    mocked(users.findProposalUser).mockResolvedValue({
      ...inGuild,
      guildMemberSeenAt: null,
    });
    await expect(svc.propose(member, dto)).rejects.toThrow(ForbiddenException);
  });

  it('staff bypass the Discord check', async () => {
    mocked(users.findProposalUser).mockResolvedValue({
      ...inGuild,
      discordId: null,
    });
    await expect(svc.propose({ id: 5, role: 'admin' }, dto)).resolves.toEqual(
      proposal,
    );
  });

  it('404 for an unknown game', async () => {
    mocked(q.findGameName).mockResolvedValue(null);
    await expect(svc.propose(member, dto)).rejects.toThrow(NotFoundException);
  });

  it('409 with a proposal already pending for the game', async () => {
    mocked(q.openProposalGameIds).mockResolvedValue([9]);
    await expect(svc.propose(member, dto)).rejects.toThrow(
      'You already have a proposal waiting for this game',
    );
  });

  it('P14: limits + insert run in one tx under the proposer lock', async () => {
    const order: string[] = [];
    mocked(q.lockProposer).mockImplementation(() => {
      order.push('lock');
      return Promise.resolve();
    });
    mocked(q.openProposalGameIds).mockImplementation(() => {
      order.push('limits');
      return Promise.resolve([]);
    });
    mocked(q.insertCommunityHub).mockImplementation(() => {
      order.push('insert');
      return Promise.resolve(proposedRow);
    });
    await svc.propose(member, dto);
    expect(order).toEqual(['lock', 'limits', 'insert']);
    expect(q.lockProposer).toHaveBeenCalledWith(tx, 5);
    expect(q.openProposalGameIds).toHaveBeenCalledWith(tx, 5);
    expect(q.hasNameClash).toHaveBeenCalledWith(tx, 9, 'BG3 Crew', null);
  });

  it('409 at two open proposals overall (D12)', async () => {
    mocked(q.openProposalGameIds).mockResolvedValue([3, 4]);
    await expect(svc.propose(member, dto)).rejects.toThrow(ConflictException);
  });

  it('409 when the name clashes on the game', async () => {
    mocked(q.hasNameClash).mockResolvedValue(true);
    await expect(svc.propose(member, dto)).rejects.toThrow(
      'A hub with that name already exists for this game',
    );
  });

  it('inserts a proposed row and notifies every staff user', async () => {
    await svc.propose(member, dto);
    expect(q.insertCommunityHub).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: 'proposed', proposedBy: 5 }),
    );
    expect(create).toHaveBeenCalledTimes(2);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 1, type: 'hub_proposal_submitted' }),
    );
  });
});

describe('approve / reject / withdraw / createDirect', () => {
  it('404 when the row is no longer proposed', async () => {
    mocked(q.lockProposal).mockResolvedValue(null);
    await expect(svc.approve(1, 40, {})).rejects.toThrow(NotFoundException);
  });

  it('409 when the proposer is deactivated (P9)', async () => {
    mocked(q.lockProposal).mockResolvedValue(proposedRow);
    mocked(users.findProposalUser).mockResolvedValue({
      ...inGuild,
      deactivatedAt: SEEN,
    });
    await expect(svc.approve(1, 40, {})).rejects.toThrow(
      'The proposer is no longer active — create the hub directly',
    );
  });

  it('activates, seats the proposer as leader and notifies them', async () => {
    mocked(q.lockProposal).mockResolvedValue(proposedRow);
    mocked(q.activateProposal).mockResolvedValue(hubRow);
    mocked(members.refreshMemberCount).mockResolvedValue(1);
    const out = await svc.approve(1, 40, { name: 'BG3 Crew' });
    expect(members.upsertJoin).toHaveBeenCalledWith(tx, 40, 5, 'leader');
    expect(out).toMatchObject({ id: 40, status: 'active', memberCount: 1 });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 5, type: 'hub_proposal_reviewed' }),
    );
  });

  it('reject deletes the locked row, THEN notifies with the reason', async () => {
    const order: string[] = [];
    mocked(q.lockProposal).mockResolvedValue(proposedRow);
    create.mockImplementation(() => Promise.resolve(order.push('notify')));
    mocked(q.deleteProposal).mockImplementation(() => {
      order.push('delete');
      return Promise.resolve(true);
    });
    await svc.reject(40, 'Duplicate');
    expect(order).toEqual(['delete', 'notify']);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Duplicate' }),
    );
  });

  it('reject 404s when the row is no longer proposed — no notice', async () => {
    mocked(q.lockProposal).mockResolvedValue(null);
    await expect(svc.reject(40, 'x')).rejects.toThrow(NotFoundException);
    expect(create).not.toHaveBeenCalled();
    expect(q.deleteProposal).not.toHaveBeenCalled();
  });

  it('reject removes an orphan (proposer deleted) without a notice', async () => {
    mocked(q.lockProposal).mockResolvedValue({
      ...proposedRow,
      proposedBy: null,
    });
    mocked(q.listProposals).mockResolvedValue([]);
    mocked(q.deleteProposal).mockResolvedValue(true);
    await svc.reject(40, 'x');
    expect(q.deleteProposal).toHaveBeenCalledWith(tx, 40);
    expect(create).not.toHaveBeenCalled();
  });

  it('a concurrent same-name insert (23505) is a 409, not a 500', async () => {
    mocked(q.insertCommunityHub).mockRejectedValue(
      Object.assign(new Error('dup'), { code: '23505' }),
    );
    await expect(svc.propose(member, dto)).rejects.toThrow(ConflictException);
  });

  it('withdraw 404s when nothing of theirs was deleted', async () => {
    mocked(q.deleteProposal).mockResolvedValue(false);
    await expect(svc.withdraw(5, 40)).rejects.toThrow(NotFoundException);
  });

  it('createDirect 409s for a deactivated leader', async () => {
    mocked(users.findProposalUser).mockResolvedValue({
      ...inGuild,
      deactivatedAt: SEEN,
    });
    await expect(
      svc.createDirect(1, { ...dto, leaderUserId: 5 }),
    ).rejects.toThrow(ConflictException);
  });
});
