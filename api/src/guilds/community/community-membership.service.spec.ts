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
import * as invites from './invites/hub-invites.queries';
import { GameActivityNudge } from '../../discord-bot/channel-lifecycle/channel-lifecycle.nudge';

jest.mock('./community-hub.lookup', () => ({
  ...jest.requireActual('./community-hub.lookup'),
  requireCommunityHub: jest.fn(),
  countLiveMembers: jest.fn(),
  archiveHub: jest.fn(),
  assertInDiscord: jest.fn(),
}));
jest.mock('./community-membership.queries');
jest.mock('./invites/hub-invites.queries');
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
  joinSource: null,
  inviteId: null,
  createdAt: AT,
  updatedAt: AT,
  ...over,
});
/** The hub `requireCommunityHub` hands `join` (its game feeds the nudge). */
const HUB: schema.GuildSelect = {
  id: 7,
  gameId: 9,
  kind: 'game_community',
  region: 'community',
  name: 'Crew',
  nameKey: 'crew',
  nameOverridden: false,
  sourceName: null,
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
  blurb: '',
  proposedBy: 1,
  blizzardGuildId: null,
  reviewedBy: 1,
  reviewedAt: AT,
  archivedAt: null,
  archivedReason: null,
  crestActive: null,
  crestUploadKey: null,
  crestPreset: null,
  crestSetBy: null,
  crestSetAt: null,
  crestRemovedBy: null,
  crestRemovedAt: null,
  autoMembership: 'off',
  createdAt: AT,
  updatedAt: AT,
};
const order: string[] = [];
const adapter = { resolveLadder: jest.fn() };
/** ROK-1873 (D8/D12): the channel-lifecycle nudge a join fires. */
const touch = jest.fn();
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
      { provide: GameActivityNudge, useValue: { touch } },
    ],
  }).compile();
  svc = mod.get(CommunityMembershipService);
  jest.mocked(lookup.requireCommunityHub).mockResolvedValue(HUB);
  jest.mocked(mq.lockHubRow).mockImplementation(() => {
    order.push('lock');
    return Promise.resolve({ status: 'active' });
  });
  jest.mocked(invites.revokeUserInvites).mockImplementation(() => {
    order.push('revoke');
    return Promise.resolve();
  });
});

/** ROK-1893: the member's links into the hub are revoked inside the same tx. */
function expectInvitesRevokedOnTx(userId: number): void {
  expect(invites.revokeUserInvites).toHaveBeenCalledWith(TX, userId, 7);
  expect(order.slice(-2)).toEqual(['revoke', 'commit']);
}

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
    expectInvitesRevokedOnTx(actor.id);
  });

  it("a plain member leaving revokes their links on the leave's tx", async () => {
    jest.mocked(mq.findMembership).mockResolvedValue(row({}));
    await svc.leave(actor, 7);
    expect(mq.markLeft).toHaveBeenCalledWith(TX, 7, actor.id, null);
    expectInvitesRevokedOnTx(actor.id);
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

  it("ROK-1873: a join nudges the hub game's channel lifecycle", async () => {
    jest.mocked(mq.findMembership).mockResolvedValue(null);
    jest.mocked(mq.upsertJoin).mockResolvedValue(row({}));
    jest.mocked(mq.refreshMemberCount).mockResolvedValue(3);
    await svc.join(actor, 7);
    expect(touch).toHaveBeenCalledWith(9);
  });

  it('ROK-1873: a banned join (403) never nudges', async () => {
    jest.mocked(mq.findMembership).mockResolvedValue(null);
    jest.mocked(mq.upsertJoin).mockResolvedValue(row({ bannedAt: AT }));
    await expect(svc.join(actor, 7)).rejects.toThrow(ForbiddenException);
    expect(touch).not.toHaveBeenCalled();
  });

  it('ROK-1873: a throwing nudge never fails the join', async () => {
    jest.mocked(mq.findMembership).mockResolvedValue(null);
    jest.mocked(mq.upsertJoin).mockResolvedValue(row({}));
    jest.mocked(mq.refreshMemberCount).mockResolvedValue(3);
    touch.mockImplementationOnce(() => {
      throw new Error('queue down');
    });
    await expect(svc.join(actor, 7)).resolves.toMatchObject({ joined: true });
  });
});

describe('joinVia (ROK-1893 D3)', () => {
  it('writes the join source + invite id and reports a new live row', async () => {
    jest.mocked(mq.findMembership).mockResolvedValue(null);
    jest.mocked(mq.lockHubRow).mockResolvedValue({ status: 'active' });
    jest.mocked(mq.upsertJoin).mockResolvedValue(row({}));
    jest.mocked(mq.refreshMemberCount).mockResolvedValue(4);
    await expect(
      svc.joinVia(1, 7, 'invite', { inviteId: 9, requireDiscord: false }),
    ).resolves.toEqual({ joined: true, memberCount: 4 });
    expect(mq.upsertJoin).toHaveBeenCalledWith(TX, 7, 1, 'member', {
      joinSource: 'invite',
      inviteId: 9,
    });
    expect(lookup.assertInDiscord).not.toHaveBeenCalled();
  });

  it('an already-live member is a no-op join (joined: false)', async () => {
    jest.mocked(mq.findMembership).mockResolvedValue(row({}));
    jest.mocked(mq.lockHubRow).mockResolvedValue({ status: 'active' });
    jest.mocked(mq.upsertJoin).mockResolvedValue(row({}));
    jest.mocked(mq.refreshMemberCount).mockResolvedValue(4);
    const out = await svc.joinVia(1, 7, 'invite', { inviteId: 9 });
    expect(out.joined).toBe(false);
  });

  it.each(['invite', 'auto', 'prompt'] as const)(
    'ROK-1873: a %s join nudges the game once, after the commit',
    async (source) => {
      jest.mocked(mq.findMembership).mockResolvedValue(null);
      jest.mocked(mq.upsertJoin).mockResolvedValue(row({}));
      jest.mocked(mq.refreshMemberCount).mockResolvedValue(4);
      touch.mockImplementationOnce(() => {
        order.push('nudge');
      });
      await svc.joinVia(1, 7, source, { requireDiscord: false });
      expect(touch).toHaveBeenCalledTimes(1);
      expect(touch).toHaveBeenCalledWith(9);
      expect(order).toEqual(['begin', 'lock', 'commit', 'nudge']);
    },
  );

  it('ROK-1873: a join refused under the lock (hub archived) never nudges', async () => {
    jest.mocked(mq.findMembership).mockResolvedValue(null);
    jest.mocked(mq.lockHubRow).mockResolvedValue({ status: 'archived' });
    await expect(
      svc.joinVia(1, 7, 'auto', { requireDiscord: false }),
    ).rejects.toThrow(NotFoundException);
    expect(touch).not.toHaveBeenCalled();
  });

  it('checks Discord by default for a non-member', async () => {
    jest.mocked(mq.findMembership).mockResolvedValue(null);
    jest
      .mocked(lookup.assertInDiscord)
      .mockRejectedValueOnce(new ForbiddenException('discord'));
    await expect(svc.joinVia(1, 7, 'auto')).rejects.toThrow('discord');
    expect(mq.upsertJoin).not.toHaveBeenCalled();
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
    expect(invites.revokeUserInvites).not.toHaveBeenCalled();
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
    expectInvitesRevokedOnTx(3);
  });

  it('staff need no hub membership (no role read)', async () => {
    jest.mocked(mq.setRole).mockResolvedValue(row({ userId: 3 }));
    await expect(
      svc.setRole({ id: 9, role: 'admin' }, 7, 3, { role: 'officer' }),
    ).resolves.toMatchObject({ userId: 3 });
    expect(reads.liveCommunityRole).not.toHaveBeenCalled();
  });
});
