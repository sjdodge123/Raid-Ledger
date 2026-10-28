import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { BG3_GAME_SLUG, type Bg3HubSettings } from '@raid-ledger/contract';
import type { CompanionBlobStore } from '../../../companion/blobs/companion-blob.store';
import type { GuildAccessService } from '../../../guilds/guild-access.service';
import type { Bg3CampaignsRepository } from '../campaigns/bg3-campaigns.repository';
import type { Bg3HubRow } from './bg3-hub-access.helpers';
import type { Bg3ReadRepository, Bg3SnapshotRow } from './bg3-read.repository';
import { Bg3ReadService } from './bg3-read.service';
import type { Bg3SavesReadRepository } from './bg3-saves.read.repository';

const me = { id: 7, role: 'member' } as const;
const HUB: Bg3HubRow = {
  id: 5,
  kind: 'game_community',
  gameSlug: BG3_GAME_SLUG,
  gameIgdbId: null,
  hidden: false,
};
const at = (h: number) => new Date(Date.UTC(2026, 9, 1, h));
const MEMBER = {
  origin: 'Generic',
  race: 'Human',
  level: 3,
  xpLevel: 0,
  xpTotal: 100,
  classes: [{ main: 'Fighter', sub: null }],
  isSummon: false,
};

function snapRow(id: number, uploader: number, h = 1): Bg3SnapshotRow {
  return {
    id,
    uploaderUserId: uploader,
    campaignKey: 'k',
    savedAt: at(h),
    sessionFirstSavedAt: null,
    sessionSaveCount: null,
    currentLevel: 'WLD_Main_A',
    partyMaxLevel: 3,
    thumbnailSha256: 'a'.repeat(64),
    saveName: 'Quick',
    receivedAt: at(h),
    difficulty: 'Normal',
    ruleset: null,
    gameVersion: '4.1',
    platform: 'steam',
    party: [MEMBER],
    uploaderDisplayName: `user${uploader}`,
  };
}

function setup(
  o: {
    member?: boolean;
    canEdit?: boolean;
    settings?: Partial<Bg3HubSettings>;
    inHub?: boolean;
    archived?: boolean;
    rows?: Bg3SnapshotRow[];
  } = {},
) {
  const settings = {
    hideLocationAndScreenshots: false,
    activeCampaignId: 11,
    ...o.settings,
  };
  const repo = {
    hubCampaigns: jest.fn().mockResolvedValue([]),
    settings: jest.fn().mockResolvedValue(settings),
    upsertSettings: jest
      .fn()
      .mockResolvedValue(
        o.inHub === false
          ? 'campaign_not_in_hub'
          : o.archived
            ? 'campaign_archived'
            : 'ok',
      ),
    campaignInHub: jest.fn().mockResolvedValue(
      o.inHub === false
        ? null
        : {
            id: 11,
            hostUserId: 2,
            archivedAt: o.archived ? new Date() : null,
          },
    ),
    sessionRows: jest.fn().mockResolvedValue(o.rows ?? []),
    snapshotRows: jest.fn().mockResolvedValue(o.rows ?? [snapRow(1, 7)]),
    claims: jest.fn().mockResolvedValue([
      {
        slotKey: 'Generic:Human:1',
        userId: 9,
        displayName: 'Ann',
        avatarUrl: null,
      },
    ]),
  };
  const save = {
    id: 1,
    uploaderUserId: 7,
    campaignKey: 'k',
    savedAt: at(1),
    campaignId: 11,
    guildId: 5,
    hostUserId: 2,
    thumbnailSha256: 'a'.repeat(64),
  };
  const saves = {
    saveInCampaign: jest.fn().mockResolvedValue(save),
    twins: jest.fn().mockResolvedValue([save]),
  };
  const hubs = { findHub: jest.fn().mockResolvedValue(HUB) };
  const access = {
    isMember: jest.fn().mockResolvedValue(o.member ?? true),
    canEdit: jest.fn().mockResolvedValue(o.canEdit ?? false),
  };
  const blobs = { open: jest.fn().mockResolvedValue(null) };
  const svc = new Bg3ReadService(
    repo as unknown as Bg3ReadRepository,
    saves as unknown as Bg3SavesReadRepository,
    hubs as unknown as Bg3CampaignsRepository,
    access as unknown as GuildAccessService,
    blobs as unknown as CompanionBlobStore,
  );
  return { svc, repo, saves, blobs };
}

describe('Bg3ReadService', () => {
  it('403s a signed-in non-member on every hub read', async () => {
    const { svc } = setup({ member: false });
    await expect(svc.campaigns(5, me)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(svc.snapshot(5, me, undefined)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('404s a campaign that is not in the hub (no cross-hub read)', async () => {
    const { svc } = setup({ inHub: false });
    await expect(svc.snapshot(5, me, 99)).rejects.toThrow('Campaign not found');
    await expect(
      svc.sessions(5, 99, me, { cursor: null, limit: 20 }),
    ).rejects.toThrow('Campaign not found');
  });

  it('404s no_campaign when no id is given and the hub has no active one', async () => {
    const { svc } = setup({ settings: { activeCampaignId: null } });
    await expect(svc.snapshot(5, me, undefined)).rejects.toThrow('no_campaign');
  });

  it('returns the newest canonical save with party slots + claims', async () => {
    const { svc } = setup();
    const snap = await svc.snapshot(5, me, undefined);
    expect(snap).toMatchObject({
      empty: false,
      saveId: 1,
      area: 'WLD_Main_A',
      spoilersHidden: false,
      thumbnailUrl: '/plugins/bg3/hubs/5/saves/1/thumbnail',
    });
    expect(snap.empty === false && snap.party[0]).toMatchObject({
      slotKey: 'Generic:Human:1',
      claim: { userId: 9 },
    });
  });

  it('prefers the host twin of the same save (D-7)', async () => {
    const { svc } = setup({ rows: [snapRow(1, 7), snapRow(2, 2)] });
    expect(await svc.snapshot(5, me, undefined)).toMatchObject({ saveId: 2 });
  });

  it('nulls area + thumbnail for everyone when spoilers are hidden (D-14)', async () => {
    const { svc } = setup({ settings: { hideLocationAndScreenshots: true } });
    expect(await svc.snapshot(5, me, undefined)).toMatchObject({
      area: null,
      thumbnailUrl: null,
      spoilersHidden: true,
    });
  });

  it('skips a row whose stored party fails re-parse, else answers empty', async () => {
    const bad = { ...snapRow(1, 7), party: [{ nope: 1 }] };
    const { svc } = setup({ rows: [bad] });
    expect(await svc.snapshot(5, me, undefined)).toEqual({
      empty: true,
      campaignId: 11,
    });
  });

  it('pages sessions newest first and hides areas under the toggle', async () => {
    const rows = [snapRow(1, 2, 1), snapRow(2, 2, 6), snapRow(3, 2, 12)];
    const { svc } = setup({
      rows,
      settings: { hideLocationAndScreenshots: true },
    });
    const first = await svc.sessions(5, 11, me, { cursor: null, limit: 2 });
    expect(first.sessions.map((x) => x.lastSaveId)).toEqual([3, 2]);
    expect(first.sessions[0]).toMatchObject({
      areas: null,
      thumbnailUrl: null,
    });
    expect(first.nextCursor).not.toBeNull();
  });

  it('404s the thumbnail while the toggle is on', async () => {
    const { svc, saves } = setup({
      settings: { hideLocationAndScreenshots: true },
    });
    await expect(svc.thumbnail(5, 1, me, 'full')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(saves.saveInCampaign).not.toHaveBeenCalled();
  });

  it('404s a thumbnail of a save that is not canonical or in another hub', async () => {
    const { svc, saves, blobs } = setup();
    saves.twins.mockResolvedValue([
      { id: 1, uploaderUserId: 7, campaignKey: 'k', savedAt: at(1) },
      { id: 2, uploaderUserId: 2, campaignKey: 'k', savedAt: at(1) },
    ]);
    await expect(svc.thumbnail(5, 1, me, 'full')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(svc.thumbnail(6, 1, me, 'full')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(blobs.open).not.toHaveBeenCalled();
  });

  it('404s a canonical thumbnail whose file is gone (D-13)', async () => {
    const { svc, blobs } = setup();
    await expect(svc.thumbnail(5, 1, me, 'thumb')).rejects.toThrow(
      'Thumbnail not found',
    );
    expect(blobs.open).toHaveBeenCalledWith(7, 'a'.repeat(64));
  });

  it('403s a settings write by a non-editor', async () => {
    const { svc, repo } = setup({ canEdit: false });
    await expect(
      svc.updateSettings(5, me, { hideLocationAndScreenshots: true }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(repo.upsertSettings).not.toHaveBeenCalled();
  });

  it('400s an active campaign from another hub (atomic repo check)', async () => {
    const { svc, repo } = setup({ canEdit: true, inHub: false });
    const err = await svc
      .updateSettings(5, me, { activeCampaignId: 99 })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as BadRequestException).message).toBe('campaign_not_in_hub');
    expect(repo.settings).not.toHaveBeenCalled();
  });

  it('400s an archived campaign as the active one (D-11, atomic repo check)', async () => {
    const { svc, repo } = setup({ canEdit: true, archived: true });
    await expect(
      svc.updateSettings(5, me, { activeCampaignId: 11 }),
    ).rejects.toThrow('campaign_archived');
    expect(repo.upsertSettings).toHaveBeenCalledWith(
      5,
      { activeCampaignId: 11 },
      7,
    );
    expect(repo.settings).not.toHaveBeenCalled();
  });

  it('lets an editor set the toggle', async () => {
    const { svc, repo } = setup({ canEdit: true });
    await svc.updateSettings(5, me, {
      hideLocationAndScreenshots: true,
      activeCampaignId: null,
    });
    expect(repo.upsertSettings).toHaveBeenCalledWith(
      5,
      { hideLocationAndScreenshots: true, activeCampaignId: null },
      7,
    );
  });
});
