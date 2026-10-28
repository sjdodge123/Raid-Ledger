import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { BG3_GAME_SLUG, type Bg3CampaignSummary } from '@raid-ledger/contract';
import type { Bg3HubRow } from '../read/bg3-hub-access.helpers';
import { Bg3CampaignsService } from './bg3-campaigns.service';
import type { Bg3CampaignsRepository } from './bg3-campaigns.repository';
import type { GuildAccessService } from '../../../guilds/guild-access.service';

const KEY = 'a'.repeat(64);
const me = { id: 7, role: 'member' } as const;
const staff = { id: 1, role: 'admin' } as const;
const HUB: Bg3HubRow = {
  id: 5,
  kind: 'game_community',
  gameSlug: BG3_GAME_SLUG,
  hidden: false,
};
const SUMMARY: Bg3CampaignSummary = {
  id: 11,
  name: 'Tav',
  hostUserId: 7,
  isActive: true,
  lastSavedAt: null,
  saveCount: 0,
};

function setup(opts: {
  hub?: Bg3HubRow | null;
  member?: boolean;
  canEdit?: boolean;
  hostUserId?: number | null;
  campaign?: boolean;
}) {
  const repo = {
    findHub: jest
      .fn()
      .mockResolvedValue(opts.hub === undefined ? HUB : opts.hub),
    findCampaign: jest
      .fn()
      .mockResolvedValue(
        opts.campaign === false
          ? null
          : { id: 11, guildId: 5, hostUserId: opts.hostUserId ?? 9 },
      ),
    createCampaign: jest.fn().mockResolvedValue(11),
    updateCampaign: jest.fn().mockResolvedValue(undefined),
    summary: jest.fn().mockResolvedValue(SUMMARY),
    bindKey: jest.fn().mockResolvedValue(undefined),
    unbindKey: jest.fn().mockResolvedValue(undefined),
    setDefault: jest.fn().mockResolvedValue(undefined),
  };
  const access = {
    isMember: jest.fn().mockResolvedValue(opts.member ?? true),
    canEdit: jest.fn().mockResolvedValue(opts.canEdit ?? false),
  };
  const svc = new Bg3CampaignsService(
    repo as unknown as Bg3CampaignsRepository,
    access as unknown as GuildAccessService,
  );
  return { repo, access, svc };
}

describe('Bg3CampaignsService.create', () => {
  it('creates the campaign with the caller as creator + host', async () => {
    const { repo, svc } = setup({});
    await expect(svc.create(5, me, { name: 'Tav' })).resolves.toEqual(SUMMARY);
    expect(repo.createCampaign).toHaveBeenCalledWith(5, 'Tav', 7);
  });

  it('403s a non-member and writes nothing', async () => {
    const { repo, svc } = setup({ member: false });
    await expect(svc.create(5, me, { name: 'Tav' })).rejects.toThrow(
      ForbiddenException,
    );
    expect(repo.createCampaign).not.toHaveBeenCalled();
  });

  it('404s a hub of another game', async () => {
    const { repo, svc } = setup({ hub: { ...HUB, gameSlug: 'valheim' } });
    await expect(svc.create(5, me, { name: 'Tav' })).rejects.toThrow(
      NotFoundException,
    );
    expect(repo.createCampaign).not.toHaveBeenCalled();
  });
});

describe('Bg3CampaignsService.update', () => {
  it('lets the host rename', async () => {
    const { repo, svc } = setup({ hostUserId: 7 });
    await svc.update(11, me, { name: 'New' });
    expect(repo.updateCampaign).toHaveBeenCalledWith(11, { name: 'New' });
  });

  it('403s a host who is no longer a hub member (kicked)', async () => {
    const { repo, access, svc } = setup({ hostUserId: 7, member: false });
    await expect(svc.update(11, me, { name: 'New' })).rejects.toThrow(
      ForbiddenException,
    );
    expect(access.isMember).toHaveBeenCalledWith(7, 5);
    expect(repo.updateCampaign).not.toHaveBeenCalled();
  });

  it('lets a hub editor (or staff, via canEdit) rename', async () => {
    const { repo, svc } = setup({ canEdit: true });
    await svc.update(11, staff, { name: 'New' });
    expect(repo.updateCampaign).toHaveBeenCalledWith(11, { name: 'New' });
  });

  it('403s any other member', async () => {
    const { repo, svc } = setup({});
    await expect(svc.update(11, me, { name: 'New' })).rejects.toThrow(
      ForbiddenException,
    );
    expect(repo.updateCampaign).not.toHaveBeenCalled();
  });

  it('400s a new host who is not a hub member', async () => {
    const { repo, access, svc } = setup({ hostUserId: 7 });
    access.isMember.mockImplementation((userId: number) =>
      Promise.resolve(userId !== 8),
    );
    await expect(svc.update(11, me, { hostUserId: 8 })).rejects.toThrow(
      BadRequestException,
    );
    expect(access.isMember).toHaveBeenCalledWith(8, 5);
    expect(repo.updateCampaign).not.toHaveBeenCalled();
  });

  it('404s a missing campaign', async () => {
    const { svc } = setup({ campaign: false });
    await expect(svc.update(11, me, { name: 'x' })).rejects.toThrow(
      NotFoundException,
    );
  });
});

describe('Bg3CampaignsService binding (D-6)', () => {
  it('binds a key for a member of the campaign hub', async () => {
    const { repo, svc } = setup({});
    await svc.bindKey(me, KEY, 11);
    expect(repo.bindKey).toHaveBeenCalledWith(7, KEY, 11);
  });

  it('403s a bind to a hub the caller is not in', async () => {
    const { repo, svc } = setup({ member: false });
    await expect(svc.bindKey(me, KEY, 11)).rejects.toThrow(ForbiddenException);
    expect(repo.bindKey).not.toHaveBeenCalled();
  });

  it('404s a bind to a campaign in a hidden hub', async () => {
    const { repo, svc } = setup({ hub: { ...HUB, hidden: true } });
    await expect(svc.bindKey(me, KEY, 11)).rejects.toThrow(NotFoundException);
    expect(repo.bindKey).not.toHaveBeenCalled();
  });

  it('unbinds the caller key', async () => {
    const { repo, svc } = setup({});
    await svc.unbindKey(me, KEY);
    expect(repo.unbindKey).toHaveBeenCalledWith(7, KEY);
  });

  it('clears the default without a hub lookup', async () => {
    const { repo, svc } = setup({});
    await svc.setDefault(me, null);
    expect(repo.setDefault).toHaveBeenCalledWith(7, null);
    expect(repo.findCampaign).not.toHaveBeenCalled();
  });

  it('403s a default in a hub the caller is not in', async () => {
    const { repo, svc } = setup({ member: false });
    await expect(svc.setDefault(me, 11)).rejects.toThrow(ForbiddenException);
    expect(repo.setDefault).not.toHaveBeenCalled();
  });
});
