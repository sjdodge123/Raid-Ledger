import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { BG3_GAME_SLUG } from '@raid-ledger/contract';
import type { GuildAccessService } from '../../../guilds/guild-access.service';
import type { Bg3CampaignsRepository } from '../campaigns/bg3-campaigns.repository';
import type { Bg3CampaignsService } from '../campaigns/bg3-campaigns.service';
import type { Bg3ClaimsRepository } from './bg3-claims.repository';
import { Bg3ClaimsService, mapClaimRace } from './bg3-claims.service';

const me = { id: 7, role: 'member' } as const;
const staff = { id: 1, role: 'admin' } as const;
const HOST = 9;
const CAMPAIGN = { id: 11, guildId: 5, hostUserId: HOST };
const HUB = {
  id: 5,
  kind: 'game_community',
  gameSlug: BG3_GAME_SLUG,
  hidden: false,
};
const at = new Date('2026-10-01T00:00:00Z');
const m = (origin: string, race: string, isSummon = false) => ({
  origin,
  race,
  isSummon,
});
const PARTY = [
  m('Generic', 'Human'),
  m('Generic', 'Human'),
  m('Generic', 'Elf', true),
];

function setup(
  o: {
    claim?: { slotKey: string; userId: number } | null;
    conflicts?: { slotKey: string; userId: number }[];
    canEdit?: boolean;
    member?: boolean;
    party?: unknown;
  } = {},
) {
  const repo = {
    newestSaves: jest.fn().mockResolvedValue([
      {
        id: 1,
        uploaderUserId: HOST,
        campaignKey: 'k',
        savedAt: at,
        party: o.party ?? PARTY,
      },
    ]),
    conflicts: jest.fn().mockResolvedValue(o.conflicts ?? []),
    insert: jest.fn().mockResolvedValue(undefined),
    find: jest
      .fn()
      .mockResolvedValue(
        o.claim === undefined
          ? { slotKey: 'Generic:Human:1', userId: 8 }
          : o.claim,
      ),
    delete: jest.fn().mockResolvedValue(undefined),
  };
  const campaigns = { memberCampaign: jest.fn().mockResolvedValue(CAMPAIGN) };
  const campaignRepo = {
    findCampaign: jest.fn().mockResolvedValue(CAMPAIGN),
    findHub: jest.fn().mockResolvedValue(HUB),
  };
  const access = {
    canEdit: jest.fn().mockResolvedValue(o.canEdit ?? false),
    isMember: jest.fn().mockResolvedValue(o.member ?? true),
  };
  const svc = new Bg3ClaimsService(
    repo as unknown as Bg3ClaimsRepository,
    campaigns as unknown as Bg3CampaignsService,
    campaignRepo as unknown as Bg3CampaignsRepository,
    access as unknown as GuildAccessService,
  );
  return { repo, campaigns, campaignRepo, access, svc };
}

describe('Bg3ClaimsService.claim', () => {
  it('claims a slot of the newest save for the caller only', async () => {
    const { repo, svc } = setup();
    await svc.claim(11, me, 'Generic:Human:2');
    expect(repo.insert).toHaveBeenCalledWith(11, 'Generic:Human:2', 7);
  });

  it('propagates the hub-member refusal (403) and writes nothing', async () => {
    const { repo, campaigns, svc } = setup();
    campaigns.memberCampaign.mockRejectedValue(new ForbiddenException());
    await expect(svc.claim(11, me, 'Generic:Human:1')).rejects.toThrow(
      ForbiddenException,
    );
    expect(repo.insert).not.toHaveBeenCalled();
  });

  it.each(['Generic:Human:3', 'Generic:Elf:1'])(
    '400s unknown_slot for %s (absent / summon)',
    async (key) => {
      const { repo, svc } = setup();
      await expect(svc.claim(11, me, key)).rejects.toThrow(
        new BadRequestException('unknown_slot'),
      );
      expect(repo.insert).not.toHaveBeenCalled();
    },
  );

  it('400s unknown_slot when the stored party fails re-parse', async () => {
    const { svc } = setup({ party: [{ origin: 1 }] });
    await expect(svc.claim(11, me, 'Generic:Human:1')).rejects.toThrow(
      new BadRequestException('unknown_slot'),
    );
  });

  it('409s slot_taken when someone holds the slot', async () => {
    const { repo, svc } = setup({
      conflicts: [{ slotKey: 'Generic:Human:1', userId: 8 }],
    });
    await expect(svc.claim(11, me, 'Generic:Human:1')).rejects.toThrow(
      new ConflictException('slot_taken'),
    );
    expect(repo.insert).not.toHaveBeenCalled();
  });

  it('409s already_claimed when the caller holds another slot', async () => {
    const { svc } = setup({
      conflicts: [{ slotKey: 'Generic:Human:2', userId: 7 }],
    });
    await expect(svc.claim(11, me, 'Generic:Human:1')).rejects.toThrow(
      new ConflictException('already_claimed'),
    );
  });

  it('maps a lost race on either unique index to its 409', () => {
    const err = (c: string) =>
      new Error(`duplicate key value violates unique constraint "${c}"`);
    expect(mapClaimRace(err('bg3_party_claims_campaign_slot_uq'))).toEqual(
      new ConflictException('slot_taken'),
    );
    expect(mapClaimRace(err('bg3_party_claims_campaign_user_uq'))).toEqual(
      new ConflictException('already_claimed'),
    );
    const other = new Error('boom');
    expect(mapClaimRace(other)).toBe(other);
  });
});

describe('Bg3ClaimsService.clear (U-6)', () => {
  it.each<[string, { id: number; role: 'member' | 'admin' }, boolean]>([
    ['the claimant', { id: 8, role: 'member' }, false],
    ['the campaign host', { id: HOST, role: 'member' }, false],
    ['a hub editor', me, true],
    ['staff', staff, true],
  ])('lets %s clear', async (_label, actor, canEdit) => {
    const { repo, svc } = setup({ canEdit });
    await svc.clear(11, actor, 'Generic:Human:1');
    expect(repo.delete).toHaveBeenCalledWith(11, 'Generic:Human:1');
  });

  it('403s any other member and deletes nothing', async () => {
    const { repo, svc } = setup();
    await expect(svc.clear(11, me, 'Generic:Human:1')).rejects.toThrow(
      ForbiddenException,
    );
    expect(repo.delete).not.toHaveBeenCalled();
  });

  it('403s a campaign host who is no longer a hub member (kicked)', async () => {
    const { repo, access, svc } = setup({ member: false });
    await expect(
      svc.clear(11, { id: HOST, role: 'member' }, 'Generic:Human:1'),
    ).rejects.toThrow(ForbiddenException);
    expect(access.isMember).toHaveBeenCalledWith(HOST, 5);
    expect(repo.delete).not.toHaveBeenCalled();
  });

  it('404s when the slot has no claim', async () => {
    const { svc } = setup({ claim: null });
    await expect(svc.clear(11, me, 'Generic:Human:1')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('404s a campaign in a hidden hub for a non-staff caller', async () => {
    const { repo, campaignRepo, svc } = setup();
    campaignRepo.findHub.mockResolvedValue({ ...HUB, hidden: true });
    await expect(
      svc.clear(11, { id: 8, role: 'member' }, 'Generic:Human:1'),
    ).rejects.toThrow(NotFoundException);
    expect(repo.delete).not.toHaveBeenCalled();
  });
});
