import { ConflictException, NotFoundException } from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../../../../drizzle/schema';
import { HubClaimError } from '../../../../guilds/claim/hub-claim.errors';
import { pickSuggested } from '../../../../guilds/claim/hub-claim.helpers';
import {
  EXTENSION_POINTS,
  type HubClaimContext,
} from '../../../plugin-host/extension-points';
import type { PluginRegistryService } from '../../../plugin-host/plugin-registry.service';
import type { ValheimArmoryReadRepository } from '../read/valheim-armory-read.repository';
import type { ValheimArmoryClaimsService } from './valheim-armory-claims.service';
import { ValheimHubClaimProvider } from './valheim-hub-claim.provider';
import { findHubServerId, findViewerFacts } from './valheim-hub-claim.queries';

jest.mock('./valheim-hub-claim.queries');
const serverIdMock = jest.mocked(findHubServerId);
const viewerMock = jest.mocked(findViewerFacts);

const SERVER = 7;
const ctx: HubClaimContext = {
  actor: { id: 42, role: 'member' },
  hub: { id: 3, kind: 'game_server', gameSlug: 'valheim', gameIgdbId: null },
  viewerIsMember: true,
};

function row(id: number, name: string, steamId = `7656119000000000${id}`) {
  return { id, name, worldName: 'Midgard', steamId, pelicanServerId: SERVER };
}

function setup() {
  const registerAdapter = jest.fn();
  const reads = {
    claimStatus: jest.fn(),
    listProfiles: jest.fn(),
    findProfile: jest.fn(),
  };
  const claims = { claim: jest.fn() };
  const provider = new ValheimHubClaimProvider(
    { registerAdapter } as unknown as PluginRegistryService,
    {} as PostgresJsDatabase<typeof schema>,
    reads as unknown as ValheimArmoryReadRepository,
    claims as unknown as ValheimArmoryClaimsService,
  );
  return { provider, reads, claims, registerAdapter };
}

beforeEach(() => {
  serverIdMock.mockResolvedValue(SERVER);
  viewerMock.mockResolvedValue({ names: ['Brannok'], steamId: null });
});

describe('ValheimHubClaimProvider registration + supports', () => {
  it('registers under the valheim slug, owned by the plugin', () => {
    const { provider, registerAdapter } = setup();
    provider.onModuleInit();
    expect(registerAdapter).toHaveBeenCalledWith(
      EXTENSION_POINTS.HUB_CLAIM_PROVIDER,
      'valheim',
      provider,
      { ownerPluginId: 'valheim' },
    );
  });

  it('serves only Valheim game_server hubs', () => {
    const { provider } = setup();
    expect(provider.supports(ctx.hub)).toBe(true);
    expect(provider.supports({ ...ctx.hub, gameSlug: 'enshrouded' })).toBe(false);
    expect(provider.supports({ ...ctx.hub, kind: 'game_community' })).toBe(false);
  });
});

describe('ValheimHubClaimProvider.status', () => {
  it('marks the exact-name character strong so core suggests it', async () => {
    const { provider, reads } = setup();
    reads.claimStatus.mockResolvedValue({ viewerHasClaim: false, unclaimedCount: 2 });
    reads.listProfiles.mockResolvedValue([row(1, 'Brannök'), row(2, 'Sigrid')]);
    const s = await provider.status(ctx);
    expect(reads.listProfiles).toHaveBeenCalledWith(
      expect.objectContaining({ serverId: SERVER, unclaimed: true, offset: 0 }),
    );
    expect(s.candidates.map((c) => [c.id, c.match, c.matchReason])).toEqual([
      ['1', 'strong', 'same_name'],
      ['2', null, null],
    ]);
    expect(pickSuggested(s.candidates)?.id).toBe('1');
    expect(s.candidates[0]?.detailPath).toBe('/valheim/characters/1');
    expect(s).toMatchObject({ viewerHasClaim: false, unclaimedCount: 2, claimOptions: 'none' });
  });

  it('has no suggestion when nothing matches the viewer', async () => {
    const { provider, reads } = setup();
    reads.claimStatus.mockResolvedValue({ viewerHasClaim: false, unclaimedCount: 1 });
    reads.listProfiles.mockResolvedValue([row(2, 'Sigrid')]);
    const s = await provider.status(ctx);
    expect(pickSuggested(s.candidates)).toBeNull();
  });

  it('a verified Steam match is strong; a different Steam is never a match', async () => {
    viewerMock.mockResolvedValue({ names: ['Brannok'], steamId: '76561190000000002' });
    const { provider, reads } = setup();
    reads.claimStatus.mockResolvedValue({ viewerHasClaim: false, unclaimedCount: 2 });
    reads.listProfiles.mockResolvedValue([row(1, 'Brannok'), row(2, 'Sigrid')]);
    const s = await provider.status(ctx);
    expect(s.candidates.map((c) => c.matchReason)).toEqual([null, 'steam_link']);
    expect(pickSuggested(s.candidates)?.id).toBe('2');
  });

  it('passes through an already-claimed viewer', async () => {
    const { provider, reads } = setup();
    reads.claimStatus.mockResolvedValue({ viewerHasClaim: true, unclaimedCount: 0 });
    reads.listProfiles.mockResolvedValue([]);
    const s = await provider.status(ctx);
    expect(s).toEqual({
      viewerHasClaim: true,
      unclaimedCount: 0,
      candidates: [],
      claimOptions: 'none',
    });
  });

  it('a hub without a server is UNAVAILABLE', async () => {
    serverIdMock.mockResolvedValue(null);
    const { provider } = setup();
    await expect(provider.status(ctx)).rejects.toMatchObject({
      code: 'HUB_CLAIM_UNAVAILABLE',
    });
  });
});

describe('ValheimHubClaimProvider.claim', () => {
  it('delegates to the armory claims service for the viewer', async () => {
    const { provider, reads, claims } = setup();
    reads.findProfile.mockResolvedValue(row(1, 'Brannok'));
    claims.claim.mockResolvedValue({});
    const res = await provider.claim(ctx, '1');
    expect(claims.claim).toHaveBeenCalledWith(1, 42);
    expect(res).toMatchObject({
      claimed: { id: '1', name: 'Brannok', match: null },
      becameMember: false,
      characterId: null,
    });
  });

  it.each([
    ['a non-numeric id', 'abc', null],
    ['an unknown character', '9', null],
    ['a character on another server', '1', { ...row(1, 'B'), pelicanServerId: 99 }],
  ])('%s is CANDIDATE_GONE', async (_l, id, found) => {
    const { provider, reads, claims } = setup();
    reads.findProfile.mockResolvedValue(found);
    await expect(provider.claim(ctx, id)).rejects.toMatchObject({
      code: 'HUB_CLAIM_CANDIDATE_GONE',
    });
    expect(claims.claim).not.toHaveBeenCalled();
  });

  it.each([
    [new ConflictException('already_claimed'), 'HUB_CLAIM_CANDIDATE_TAKEN'],
    [new NotFoundException('character_not_found'), 'HUB_CLAIM_CANDIDATE_GONE'],
  ])('maps %s to %s', async (thrown, code) => {
    const { provider, reads, claims } = setup();
    reads.findProfile.mockResolvedValue(row(1, 'Brannok'));
    claims.claim.mockRejectedValue(thrown);
    const err: unknown = await provider.claim(ctx, '1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HubClaimError);
    expect(err).toMatchObject({ code });
  });

  it('rethrows anything else unchanged', async () => {
    const { provider, reads, claims } = setup();
    reads.findProfile.mockResolvedValue(row(1, 'Brannok'));
    const boom = new Error('db down');
    claims.claim.mockRejectedValue(boom);
    await expect(provider.claim(ctx, '1')).rejects.toBe(boom);
  });
});
