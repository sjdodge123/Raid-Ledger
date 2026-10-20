/** ROK-1870 review — Join / leader-leave run under the hub row lock. */
import { Test } from '@nestjs/testing';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import type * as schema from '../../drizzle/schema';
import type { GuildActor } from '../guild-access.service';
import { CommunityHubKindAdapter } from './community-hub-kind.adapter';
import * as lookup from './community-hub.lookup';
import * as reads from './community-hub.reads';
import * as mq from './community-membership.queries';
import { CommunityMembershipService } from './community-membership.service';

jest.mock('./community-hub.lookup', () => ({
  ...jest.requireActual('./community-hub.lookup'),
  requireCommunityHub: jest.fn(),
  countLiveMembers: jest.fn(),
  archiveHub: jest.fn(),
  assertInDiscord: jest.fn(),
}));
jest.mock('./community-membership.queries');
jest.mock('./community-hub.reads', () => ({
  ...jest.requireActual('./community-hub.reads'),
  liveCommunityRole: jest.fn(),
}));

const AT = new Date('2026-10-01T00:00:00Z');
const actor: GuildActor = { id: 1, role: 'member' };
const row = (
  over: Partial<schema.HubCommunityMemberSelect>,
): schema.HubCommunityMemberSelect => ({
  id: 50,
  guildId: 7,
  userId: 1,
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
});
const order: string[] = [];
const adapter = { resolveLadder: jest.fn() };
/** The handle the mocked transaction hands its callback. */
const TX = { tx: true };
const db = {
  transaction: async (fn: (tx: object) => Promise<unknown>) => {
    order.push('begin');
    const out = await fn(TX);
    order.push('commit');
    return out;
  },
};
let svc: CommunityMembershipService;

beforeEach(async () => {
  jest.clearAllMocks();
  order.length = 0;
  const mod = await Test.createTestingModule({
    providers: [
      CommunityMembershipService,
      { provide: DrizzleAsyncProvider, useValue: db },
      { provide: CommunityHubKindAdapter, useValue: adapter },
    ],
  }).compile();
  svc = mod.get(CommunityMembershipService);
  jest.mocked(mq.lockHubRow).mockImplementation(() => {
    order.push('lock');
    return Promise.resolve({ status: 'active' });
  });
});

describe('leave as leader (D13)', () => {
  it('counts under the hub lock and refuses with company — nothing written', async () => {
    jest.mocked(mq.findMembership).mockResolvedValue(row({ role: 'leader' }));
    jest.mocked(lookup.countLiveMembers).mockImplementation(() => {
      order.push('count');
      return Promise.resolve(2);
    });
    await expect(svc.leave(actor, 7)).rejects.toThrow(ConflictException);
    expect(order).toEqual(['begin', 'lock', 'count']);
    expect(mq.markLeft).not.toHaveBeenCalled();
  });

  it('the last member leaving archives the hub in the same transaction', async () => {
    jest.mocked(mq.findMembership).mockResolvedValue(row({ role: 'leader' }));
    jest.mocked(lookup.countLiveMembers).mockResolvedValue(1);
    await svc.leave(actor, 7);
    expect(lookup.archiveHub).toHaveBeenCalledWith(TX, 7, 'empty');
  });
});

describe('join', () => {
  it('re-checks the hub is active under the lock (404 when archived meanwhile)', async () => {
    jest.mocked(mq.findMembership).mockResolvedValue(null);
    jest.mocked(mq.lockHubRow).mockResolvedValue({ status: 'archived' });
    await expect(svc.join(actor, 7)).rejects.toThrow(NotFoundException);
    expect(mq.upsertJoin).not.toHaveBeenCalled();
  });

  it('upserts inside the locked transaction', async () => {
    jest.mocked(mq.findMembership).mockResolvedValue(null);
    jest.mocked(mq.upsertJoin).mockImplementation(() => {
      order.push('upsert');
      return Promise.resolve(row({}));
    });
    jest.mocked(mq.refreshMemberCount).mockResolvedValue(3);
    await expect(svc.join(actor, 7)).resolves.toEqual({
      joined: true,
      memberCount: 3,
    });
    expect(order).toEqual(['begin', 'lock', 'upsert', 'commit']);
  });
});

describe('role-sensitive writes serialise with transfers (M22)', () => {
  beforeEach(() => {
    jest.mocked(mq.findMembership).mockImplementation(() => {
      order.push('read');
      return Promise.resolve(row({ userId: 3, role: 'leader' }));
    });
  });

  it('remove reads the target under the hub lock — a just-promoted leader is refused', async () => {
    jest.mocked(reads.liveCommunityRole).mockResolvedValue('officer');
    await expect(svc.remove(actor, 7, 3)).rejects.toThrow(ForbiddenException);
    expect(order).toEqual(['begin', 'lock', 'read']);
    expect(mq.findMembership).toHaveBeenCalledWith(TX, 7, 3);
    expect(mq.markLeft).not.toHaveBeenCalled();
  });

  it('setRole reads the target under the hub lock — never demotes the new leader', async () => {
    jest.mocked(reads.liveCommunityRole).mockResolvedValue('leader');
    await expect(svc.setRole(actor, 7, 3, { role: 'member' })).rejects.toThrow(
      ConflictException,
    );
    expect(order).toEqual(['begin', 'lock', 'read']);
    expect(mq.setRole).not.toHaveBeenCalled();
  });

  it("leave reads the leaver's role under the hub lock", async () => {
    jest.mocked(lookup.countLiveMembers).mockResolvedValue(2);
    await expect(svc.leave({ id: 3, role: 'member' }, 7)).rejects.toThrow(
      ConflictException,
    );
    expect(order).toEqual(['begin', 'lock', 'read']);
    expect(mq.markLeft).not.toHaveBeenCalled();
  });
});

describe('caller role is read on the lock tx, never the pool (Codex r4)', () => {
  /** Lock, then the caller-role read on TX; the pool adapter is never asked. */
  function expectRoleReadOnTx(): void {
    expect(reads.liveCommunityRole).toHaveBeenCalledWith(TX, 7, actor.id);
    const lockAt = jest.mocked(mq.lockHubRow).mock.invocationCallOrder[0];
    const roleAt = jest.mocked(reads.liveCommunityRole).mock
      .invocationCallOrder[0];
    expect(lockAt).toBeLessThan(roleAt ?? 0);
    expect(adapter.resolveLadder).not.toHaveBeenCalled();
  }

  beforeEach(() => {
    jest.mocked(mq.findMembership).mockResolvedValue(row({ userId: 3 }));
  });

  it('setRole: a caller demoted to officer meanwhile is refused (403)', async () => {
    jest.mocked(reads.liveCommunityRole).mockResolvedValue('officer');
    adapter.resolveLadder.mockResolvedValue('leader');
    await expect(svc.setRole(actor, 7, 3, { role: 'officer' })).rejects.toThrow(
      ForbiddenException,
    );
    expectRoleReadOnTx();
    expect(mq.setRole).not.toHaveBeenCalled();
  });

  it('remove: the ladder uses the role read on the tx', async () => {
    jest.mocked(reads.liveCommunityRole).mockResolvedValue('leader');
    adapter.resolveLadder.mockResolvedValue('member');
    await expect(svc.remove(actor, 7, 3)).resolves.toBeUndefined();
    expectRoleReadOnTx();
    expect(mq.markLeft).toHaveBeenCalledWith(TX, 7, 3, actor.id);
  });

  it('staff need no hub membership (no role read)', async () => {
    jest.mocked(mq.setRole).mockResolvedValue(row({ userId: 3 }));
    await expect(
      svc.setRole({ id: 9, role: 'admin' }, 7, 3, { role: 'officer' }),
    ).resolves.toMatchObject({ userId: 3 });
    expect(reads.liveCommunityRole).not.toHaveBeenCalled();
  });
});
