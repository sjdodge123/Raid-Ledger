import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { HubClaimError } from '../../../guilds/claim/hub-claim.errors';
import type { GuildAccessService } from '../../../guilds/guild-access.service';
import {
  EXTENSION_POINTS,
  type HubClaimContext,
} from '../../plugin-host/extension-points';
import type { PluginRegistryService } from '../../plugin-host/plugin-registry.service';
import type { Bg3CampaignsRepository } from '../campaigns/bg3-campaigns.repository';
import type { Bg3ReadRepository } from '../read/bg3-read.repository';
import type { Bg3ClaimsRepository } from './bg3-claims.repository';
import type { Bg3ClaimsService } from './bg3-claims.service';
import { Bg3HubClaimProvider } from './bg3-hub-claim.provider';

const HUB = 3;
const ctx: HubClaimContext = {
  actor: { id: 42, role: 'member' },
  hub: {
    id: HUB,
    kind: 'game_community',
    gameSlug: 'baldurs-gate-3',
    gameIgdbId: null,
  },
  viewerIsMember: true,
};

function member(origin: string, race: string, isSummon = false) {
  return {
    origin,
    race,
    level: 5,
    xpLevel: 0,
    xpTotal: 10,
    classes: isSummon ? [] : [{ main: 'Barbarian', sub: null }],
    isSummon,
  };
}

const PARTY = [
  member('Generic', 'Elf_WoodElf'),
  member('ShadowHeart', 'Human'),
  member('DogFamiliar_Scratch_Summon', 'Dog', true),
];

function save(party: unknown) {
  return {
    id: 1,
    uploaderUserId: 9,
    campaignKey: 'k',
    savedAt: new Date(1000),
    party,
  };
}

function setup(
  opts: { active?: number | null; party?: unknown; member?: boolean } = {},
) {
  const active = opts.active === undefined ? 12 : opts.active;
  const registerAdapter = jest.fn();
  const campaigns = {
    findHub: jest.fn().mockResolvedValue({
      id: HUB,
      kind: 'game_community',
      gameSlug: 'baldurs-gate-3',
      gameIgdbId: null,
      hidden: false,
    }),
    findCampaign: jest.fn((id: number) =>
      Promise.resolve({ id, guildId: HUB, hostUserId: 9, archivedAt: null }),
    ),
  };
  const access = { isMember: jest.fn().mockResolvedValue(opts.member ?? true) };
  const reads = {
    settings: jest.fn().mockResolvedValue({
      hideLocationAndScreenshots: false,
      activeCampaignId: active,
    }),
    claims: jest.fn().mockResolvedValue([]),
  };
  const claimsRepo = {
    newestSaves: jest.fn().mockResolvedValue([save(opts.party ?? PARTY)]),
  };
  const claims = { claim: jest.fn().mockResolvedValue(undefined) };
  const provider = new Bg3HubClaimProvider(
    { registerAdapter } as unknown as PluginRegistryService,
    access as unknown as GuildAccessService,
    campaigns as unknown as Bg3CampaignsRepository,
    reads as unknown as Bg3ReadRepository,
    claimsRepo as unknown as Bg3ClaimsRepository,
    claims as unknown as Bg3ClaimsService,
  );
  return { provider, registerAdapter, reads, claims };
}

describe('Bg3HubClaimProvider registration + supports', () => {
  it('registers under the bg3 slug, owned by the plugin', () => {
    const { provider, registerAdapter } = setup();
    provider.onModuleInit();
    expect(registerAdapter).toHaveBeenCalledWith(
      EXTENSION_POINTS.HUB_CLAIM_PROVIDER,
      'bg3',
      provider,
      { ownerPluginId: 'bg3' },
    );
  });

  it('serves only BG3 game_community hubs', () => {
    const { provider } = setup();
    expect(provider.supports(ctx.hub)).toBe(true);
    expect(
      provider.supports({ ...ctx.hub, gameSlug: null, gameIgdbId: 119171 }),
    ).toBe(true);
    expect(provider.supports({ ...ctx.hub, kind: 'game_server' })).toBe(false);
    expect(provider.supports({ ...ctx.hub, gameSlug: 'valheim' })).toBe(false);
  });
});

describe('Bg3HubClaimProvider.status', () => {
  it('no active campaign: nothing to claim and no dismissal scope', async () => {
    const { provider } = setup({ active: null });
    const status = await provider.status(ctx);
    expect(status).toEqual({
      viewerHasClaim: false,
      unclaimedCount: 0,
      candidates: [],
      claimOptions: 'none',
    });
    expect(status).not.toHaveProperty('dismissScope');
  });

  it('lists unclaimed non-summon slots of the active campaign, list only', async () => {
    const { provider, reads } = setup();
    reads.claims.mockResolvedValue([
      { slotKey: 'ShadowHeart:Human:1', userId: 7 },
    ]);
    const status = await provider.status(ctx);
    expect(status.viewerHasClaim).toBe(false);
    expect(status.unclaimedCount).toBe(1);
    expect(status.candidates).toEqual([
      {
        id: '12:Generic:Elf_WoodElf:1',
        name: 'Wood Elf Barbarian',
        subtitle: 'Level 5 · Barbarian · Custom character',
        avatarUrl: null,
        detailPath: null,
        match: null,
        matchReason: null,
      },
    ]);
    expect(status.dismissScope).toBe('campaign-12');
  });

  it('viewerHasClaim reflects a claim in the active campaign', async () => {
    const { provider, reads } = setup();
    reads.claims.mockResolvedValue([
      { slotKey: 'Generic:Elf_WoodElf:1', userId: 42 },
    ]);
    const status = await provider.status(ctx);
    expect(status.viewerHasClaim).toBe(true);
    expect(status.candidates.map((c) => c.id)).toEqual([
      '12:ShadowHeart:Human:1',
    ]);
  });

  it('the dismissal scope follows the active campaign id', async () => {
    expect(
      (await setup({ active: 12 }).provider.status(ctx)).dismissScope,
    ).toBe('campaign-12');
    expect(
      (await setup({ active: 13 }).provider.status(ctx)).dismissScope,
    ).toBe('campaign-13');
  });
});

describe('Bg3HubClaimProvider.status edge cases', () => {
  it('a stored party that fails re-parse offers nothing, and says so', async () => {
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    try {
      const status = await setup({
        party: [{ origin: 'SecretName' }],
      }).provider.status(ctx);
      expect(status.unclaimedCount).toBe(0);
      expect(status.candidates).toEqual([]);
      expect(warn).toHaveBeenCalledTimes(1);
      const message = String(warn.mock.calls[0]?.[0]);
      expect(message).toContain(`hub ${HUB} campaign 12`);
      // No save contents in the log.
      expect(message).not.toContain('SecretName');
    } finally {
      warn.mockRestore();
    }
  });

  it('a party that parses logs no warning', async () => {
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    try {
      await setup().provider.status(ctx);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('a signed-in non-member gets HUB_CLAIM_FORBIDDEN', async () => {
    await expect(
      setup({ member: false }).provider.status(ctx),
    ).rejects.toMatchObject({
      code: 'HUB_CLAIM_FORBIDDEN',
    });
  });
});

describe('Bg3HubClaimProvider.claim', () => {
  it('claims the slot through Bg3ClaimsService and returns the candidate', async () => {
    const { provider, claims } = setup();
    const result = await provider.claim(ctx, '12:ShadowHeart:Human:1');
    expect(claims.claim).toHaveBeenCalledWith(
      12,
      ctx.actor,
      'ShadowHeart:Human:1',
    );
    expect(result).toEqual({
      claimed: expect.objectContaining({
        id: '12:ShadowHeart:Human:1',
        name: 'Human Barbarian',
      }),
      becameMember: false,
      characterId: null,
    });
  });

  it.each([
    ['malformed id', 'nope'],
    ['an inactive campaign', '13:Generic:Elf_WoodElf:1'],
    ['a summon slot', '12:DogFamiliar_Scratch_Summon:Dog:1'],
  ])('%s is HUB_CLAIM_CANDIDATE_GONE', async (_label, id) => {
    const { provider, claims } = setup();
    await expect(provider.claim(ctx, id)).rejects.toMatchObject({
      code: 'HUB_CLAIM_CANDIDATE_GONE',
    });
    expect(claims.claim).not.toHaveBeenCalled();
  });

  it.each([
    [new ConflictException('slot_taken'), 'HUB_CLAIM_CANDIDATE_TAKEN'],
    [new ConflictException('already_claimed'), 'HUB_CLAIM_VIEWER_HAS_CLAIM'],
    [new BadRequestException('unknown_slot'), 'HUB_CLAIM_CANDIDATE_GONE'],
    [new NotFoundException('Campaign not found'), 'HUB_CLAIM_CANDIDATE_GONE'],
    [new ForbiddenException('Hub members only'), 'HUB_CLAIM_FORBIDDEN'],
  ])('maps %p to %s', async (thrown, code) => {
    const { provider, claims } = setup();
    claims.claim.mockRejectedValue(thrown);
    const err: unknown = await provider
      .claim(ctx, '12:Generic:Elf_WoodElf:1')
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HubClaimError);
    expect(err).toMatchObject({ code });
  });

  it('a non-member is refused before the claim runs', async () => {
    const { provider, claims } = setup({ member: false });
    await expect(
      provider.claim(ctx, '12:Generic:Elf_WoodElf:1'),
    ).rejects.toMatchObject({
      code: 'HUB_CLAIM_FORBIDDEN',
    });
    expect(claims.claim).not.toHaveBeenCalled();
  });
});
