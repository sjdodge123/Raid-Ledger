import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type {
  RosterClaimCandidateDto,
  RosterClaimListResponseDto,
} from '@raid-ledger/contract';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../../../../drizzle/schema';
import { HubClaimError } from '../../../../guilds/claim/hub-claim.errors';
import { pickSuggested } from '../../../../guilds/claim/hub-claim.helpers';
import {
  EXTENSION_POINTS,
  type HubClaimContext,
} from '../../../plugin-host/extension-points';
import type { PluginRegistryService } from '../../../plugin-host/plugin-registry.service';
import type { WowHubKindAdapter } from '../wow-hub-kind.adapter';
import type { RosterClaimService } from './roster-claim.service';
import { readMember, type ClaimMember } from './roster-claim.tx';
import { WowHubClaimProvider } from './wow-hub-claim.provider';
import { findClaimableGuildGameId } from './wow-hub-claim.queries';

jest.mock('./wow-hub-claim.queries');
jest.mock('./roster-claim.tx');
const gameIdMock = jest.mocked(findClaimableGuildGameId);
const readMemberMock = jest.mocked(readMember);

const GUILD = 3;
const GAME = 11;
const RULESET = { ruleset: 'normal' };

const ctx: HubClaimContext = {
  actor: { id: 42, role: 'member' },
  hub: { id: GUILD, kind: 'wow_guild', gameSlug: 'x', gameIgdbId: null },
  viewerIsMember: false,
};

function cand(memberId: number, name: string): RosterClaimCandidateDto {
  return { memberId, name, class: 'Warrior', level: 60, source: 'blizzard' };
}

function member(memberId: number, guildId = GUILD): ClaimMember {
  return {
    memberId,
    guildId,
    gameId: GAME,
    region: 'us',
    name: 'Brannok',
    guid: null,
    blizzardCharacterId: null,
    class: 'Warrior',
    level: 60,
  };
}

function list(
  candidates: RosterClaimCandidateDto[],
  truncated = false,
): RosterClaimListResponseDto {
  const guilds = candidates.length
    ? [{ guildId: GUILD, guildName: 'G', region: 'us', candidates }]
    : [];
  return { guilds, truncated };
}

function setup() {
  const registerAdapter = jest.fn();
  const roster = { listCandidates: jest.fn(), claim: jest.fn() };
  const hubKind = { isMember: jest.fn().mockResolvedValue(false) };
  const provider = new WowHubClaimProvider(
    { registerAdapter } as unknown as PluginRegistryService,
    {} as PostgresJsDatabase<typeof schema>,
    roster as unknown as RosterClaimService,
    hubKind as unknown as WowHubKindAdapter,
  );
  return { provider, roster, hubKind, registerAdapter };
}

beforeEach(() => {
  jest.clearAllMocks();
  gameIdMock.mockResolvedValue(GAME);
  readMemberMock.mockResolvedValue(member(5));
});

describe('WowHubClaimProvider registration + supports', () => {
  it('registers under the blizzard slug, owned by the blizzard plugin', () => {
    const { provider, registerAdapter } = setup();
    provider.onModuleInit();
    expect(registerAdapter).toHaveBeenCalledWith(
      EXTENSION_POINTS.HUB_CLAIM_PROVIDER,
      'blizzard',
      provider,
      { ownerPluginId: 'blizzard' },
    );
    expect(provider.pluginSlug).toBe('blizzard');
  });

  it.each([
    ['wow_guild', true],
    ['game_server', false],
    ['game_community', false],
  ] as const)('supports(%s) is %s', (kind, expected) => {
    const { provider } = setup();
    expect(provider.supports({ ...ctx.hub, kind })).toBe(expected);
  });
});

describe('WowHubClaimProvider.status', () => {
  it('no unclaimed rows → empty list, still the wow_ruleset options', async () => {
    const { provider, roster } = setup();
    roster.listCandidates.mockResolvedValue(list([]));
    const s = await provider.status(ctx);
    expect(roster.listCandidates).toHaveBeenCalledWith({
      gameId: GAME,
      guildId: GUILD,
    });
    expect(s).toEqual({
      viewerHasClaim: false,
      unclaimedCount: 0,
      candidates: [],
      claimOptions: 'wow_ruleset',
    });
  });

  it('maps roster rows to candidates with the member page path', async () => {
    const { provider, roster } = setup();
    roster.listCandidates.mockResolvedValue(
      list([{ ...cand(5, 'Sigrid'), itemLevel: 412 }, cand(6, 'Orm')]),
    );
    const s = await provider.status(ctx);
    expect(s.unclaimedCount).toBe(2);
    expect(s.candidates[0]).toEqual({
      id: '5',
      name: 'Sigrid',
      subtitle: 'Lv 60 Warrior · 412 ilvl',
      avatarUrl: null,
      detailPath: '/hubs/3/members/5',
      match: null,
      matchReason: null,
    });
    expect(s.candidates[1]?.id).toBe('6');
  });

  it('a truncated roster list reports one more unclaimed than it lists', async () => {
    const { provider, roster } = setup();
    roster.listCandidates.mockResolvedValue(list([cand(5, 'Sigrid')], true));
    const s = await provider.status(ctx);
    expect(s.unclaimedCount).toBe(2);
  });

  it('Q7: an exact name match between viewer and row still yields match null', async () => {
    const { provider, roster } = setup();
    // The viewer (actor 42) goes by "Brannok"; a name alone is never a WoW match.
    roster.listCandidates.mockResolvedValue(list([cand(5, 'Brannok')]));
    const s = await provider.status(ctx);
    expect(s.candidates.map((c) => [c.match, c.matchReason])).toEqual([
      [null, null],
    ]);
    expect(pickSuggested(s.candidates)).toBeNull();
  });

  it.each([true, false])(
    'viewerHasClaim = the hub kind membership fact (%s)',
    async (linked) => {
      const { provider, roster, hubKind } = setup();
      hubKind.isMember.mockResolvedValue(linked);
      roster.listCandidates.mockResolvedValue(list([]));
      const s = await provider.status(ctx);
      expect(hubKind.isMember).toHaveBeenCalledWith(42, GUILD);
      expect(s.viewerHasClaim).toBe(linked);
    },
  );

  it('a guild the roster claim does not serve is UNAVAILABLE', async () => {
    gameIdMock.mockResolvedValue(null);
    const { provider, roster } = setup();
    await expect(provider.status(ctx)).rejects.toMatchObject({
      code: 'HUB_CLAIM_UNAVAILABLE',
    });
    expect(roster.listCandidates).not.toHaveBeenCalled();
  });
});

describe('WowHubClaimProvider.claim', () => {
  const character = { id: 'c0ffee00-0000-4000-8000-000000000001' };

  it.each([
    [false, true],
    [true, false],
  ])(
    'delegates to RosterClaimService (had a claim: %s → becameMember %s)',
    async (hadClaim, becameMember) => {
      const { provider, roster, hubKind } = setup();
      hubKind.isMember.mockResolvedValue(hadClaim);
      roster.claim.mockResolvedValue(character);
      const res = await provider.claim(ctx, '5', RULESET);
      expect(roster.claim).toHaveBeenCalledWith(42, 5, {
        ...RULESET,
        isMain: false,
      });
      expect(res).toEqual({
        claimed: expect.objectContaining({ id: '5', name: 'Brannok' }),
        becameMember,
        characterId: character.id,
      });
      expect(res.claimed.match).toBeNull();
    },
  );

  it.each([
    ['a non-numeric id', 'abc'],
    ['a zero id', '0'],
  ])('%s is CANDIDATE_GONE', async (_l, id) => {
    const { provider, roster } = setup();
    await expect(provider.claim(ctx, id, RULESET)).rejects.toMatchObject({
      code: 'HUB_CLAIM_CANDIDATE_GONE',
    });
    expect(roster.claim).not.toHaveBeenCalled();
  });

  it('an unknown roster row is CANDIDATE_GONE', async () => {
    readMemberMock.mockRejectedValue(new NotFoundException('gone'));
    const { provider, roster } = setup();
    await expect(provider.claim(ctx, '9', RULESET)).rejects.toMatchObject({
      code: 'HUB_CLAIM_CANDIDATE_GONE',
    });
    expect(roster.claim).not.toHaveBeenCalled();
  });

  it("another guild's roster row is CANDIDATE_GONE and never claimed", async () => {
    readMemberMock.mockResolvedValue(member(5, 99));
    const { provider, roster } = setup();
    await expect(provider.claim(ctx, '5', RULESET)).rejects.toMatchObject({
      code: 'HUB_CLAIM_CANDIDATE_GONE',
    });
    expect(roster.claim).not.toHaveBeenCalled();
  });

  it.each([
    ['missing options', undefined],
    ['an unknown ruleset', { ruleset: 'nope' }],
    ['the non-selectable hardcore ruleset', { ruleset: 'hardcore' }],
  ])('%s is BAD_OPTIONS', async (_l, options) => {
    const { provider, roster } = setup();
    await expect(provider.claim(ctx, '5', options)).rejects.toMatchObject({
      code: 'HUB_CLAIM_BAD_OPTIONS',
    });
    expect(roster.claim).not.toHaveBeenCalled();
  });

  it('a guild the roster claim does not serve is UNAVAILABLE', async () => {
    gameIdMock.mockResolvedValue(null);
    const { provider, roster } = setup();
    await expect(provider.claim(ctx, '5', RULESET)).rejects.toMatchObject({
      code: 'HUB_CLAIM_UNAVAILABLE',
    });
    expect(roster.claim).not.toHaveBeenCalled();
  });

  it.each([
    [new ConflictException('claimed first'), 'HUB_CLAIM_CANDIDATE_TAKEN'],
    [new NotFoundException('gone'), 'HUB_CLAIM_CANDIDATE_GONE'],
    [new BadRequestException('ruleset'), 'HUB_CLAIM_BAD_OPTIONS'],
  ])('maps the service %s to %s', async (thrown, code) => {
    const { provider, roster } = setup();
    roster.claim.mockRejectedValue(thrown);
    const err: unknown = await provider
      .claim(ctx, '5', RULESET)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HubClaimError);
    expect(err).toMatchObject({ code });
  });

  it('rethrows anything else unchanged', async () => {
    const { provider, roster } = setup();
    const boom = new Error('db down');
    roster.claim.mockRejectedValue(boom);
    await expect(provider.claim(ctx, '5', RULESET)).rejects.toBe(boom);
  });
});
