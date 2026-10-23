/** ROK-1893 × ROK-1873 — an invite redeem nudges the hub game after commit. */
import { Test } from '@nestjs/testing';
import { GoneException } from '@nestjs/common';
import { DrizzleAsyncProvider } from '../../../drizzle/drizzle.module';
import type * as schema from '../../../drizzle/schema';
import { GameActivityNudge } from '../../../discord-bot/channel-lifecycle/channel-lifecycle.nudge';
import * as reads from '../community-hub.reads';
import * as join from '../community-join.helpers';
import * as mq from '../community-membership.queries';
import { HubDiscordInviteService } from './hub-discord-invite.service';
import * as q from './hub-invites.queries';
import { HubInviteLandingService } from './hub-invite-landing.service';

jest.mock('../community-hub.reads');
jest.mock('../community-join.helpers');
jest.mock('../community-membership.queries');
jest.mock('./hub-invites.queries');
jest.mock('./hub-invite-token.helpers', () => ({
  ...jest.requireActual('./hub-invite-token.helpers'),
  isWellFormedHubInviteToken: jest.fn(() => true),
}));

const AT = new Date('2026-10-01T00:00:00Z');
const INVITE: schema.HubInviteSelect = {
  id: 3,
  guildId: 7,
  token: 'tok',
  createdBy: 1,
  createdAt: AT,
  expiresAt: null,
  maxUses: null,
  useCount: 0,
  revokedAt: null,
};
const PREVIEW: q.PreviewHubRow = {
  id: 7,
  name: 'Crew',
  kind: 'game_community',
  status: 'active',
  hiddenAt: null,
  blurb: '',
  memberCount: 2,
  gameName: 'Valheim',
  gameCoverUrl: null,
};
/** The hub `assertMayJoin` hands back (its game feeds the nudge). */
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
  blurb: '',
  proposedBy: 1,
  blizzardGuildId: null,
  reviewedBy: 1,
  reviewedAt: AT,
  archivedAt: null,
  archivedReason: null,
  autoMembership: 'off',
  createdAt: AT,
  updatedAt: AT,
};
const order: string[] = [];
const touch = jest.fn(() => {
  order.push('nudge');
});
const db = {
  transaction: async (fn: (tx: object) => Promise<unknown>) => {
    order.push('begin');
    const out = await fn({ tx: true });
    order.push('commit');
    return out;
  },
};
let svc: HubInviteLandingService;

beforeEach(async () => {
  jest.clearAllMocks();
  order.length = 0;
  const mod = await Test.createTestingModule({
    providers: [
      HubInviteLandingService,
      { provide: DrizzleAsyncProvider, useValue: db },
      { provide: HubDiscordInviteService, useValue: {} },
      { provide: GameActivityNudge, useValue: { touch } },
    ],
  }).compile();
  svc = mod.get(HubInviteLandingService);
  jest.mocked(q.findInviteByToken).mockResolvedValue(INVITE);
  jest.mocked(q.loadPreviewHub).mockResolvedValue(PREVIEW);
  jest.mocked(reads.liveCommunityRole).mockResolvedValue(null);
  jest.mocked(join.assertMayJoin).mockResolvedValue(HUB);
  jest.mocked(join.joinLocked).mockResolvedValue(true);
  jest.mocked(mq.lockHubRow).mockResolvedValue({ status: 'active' });
  jest.mocked(mq.refreshMemberCount).mockResolvedValue(3);
});

describe('invite redeem nudge (ROK-1873 D12)', () => {
  it("an invite join nudges the hub's game once, after the commit", async () => {
    await expect(svc.join('tok', 1)).resolves.toEqual({
      hubId: 7,
      joined: true,
      memberCount: 3,
    });
    expect(touch).toHaveBeenCalledTimes(1);
    expect(touch).toHaveBeenCalledWith(9);
    expect(order).toEqual(['begin', 'commit', 'nudge']);
  });

  it('a refused redeem (link revoked under the lock) never nudges', async () => {
    jest
      .mocked(q.findInviteByToken)
      .mockResolvedValueOnce(INVITE)
      .mockResolvedValueOnce({ ...INVITE, revokedAt: AT });
    await expect(svc.join('tok', 1)).rejects.toThrow(GoneException);
    expect(touch).not.toHaveBeenCalled();
  });

  it('a throwing nudge never fails the redeem', async () => {
    touch.mockImplementationOnce(() => {
      throw new Error('queue down');
    });
    await expect(svc.join('tok', 1)).resolves.toMatchObject({ joined: true });
  });
});
