import { BadRequestException, ConflictException } from '@nestjs/common';
import type { CreateCharacterDto } from '@raid-ledger/contract';
import { EXTENSION_POINTS } from '../plugin-host/extension-points';
import { WowCommonModule } from './wow-common.module';
import { WowForeverIdentityProvider } from './wow-forever-identity.provider';

const FOREVER = { slug: 'world-of-warcraft-forever' };

/** select().from().where().limit() chain resolving to `rows`; counts selects. */
function countingDb(rows: Array<{ userId: number; name: string }>) {
  const calls = { select: 0 };
  const chain = {
    select: () => (calls.select++, chain),
    from: () => chain,
    where: () => chain,
    limit: () => Promise.resolve(rows),
  };
  return { db: chain as never, calls };
}

function createDto(over: Partial<CreateCharacterDto> = {}): CreateCharacterDto {
  return { gameId: 7, name: ' Ana Forever ', isMain: false, ...over };
}

describe('WowForeverIdentityProvider', () => {
  const provider = new WowForeverIdentityProvider();

  it('claims the Forever slug only', () => {
    expect(provider.gameSlugs).toEqual(['world-of-warcraft-forever']);
  });

  it('prepareCreate normalizes a Forever create and enforces region+ruleset', () => {
    const out = provider.prepareCreate(
      FOREVER,
      createDto({ region: 'us', ruleset: 'pvp', realm: 'area-52' }),
    );
    expect(out).toMatchObject({ name: 'Ana Forever', realm: undefined });
    expect(() => provider.prepareCreate(FOREVER, createDto())).toThrow(
      BadRequestException,
    );
  });

  it('prepareUpdate applies Forever rules from the given slug; its only SELECT is the claim', async () => {
    const { db, calls } = countingDb([]);
    const character = { id: 'c1', gameId: 7, region: 'us' };
    await expect(
      provider.prepareUpdate(db, 1, FOREVER, character, {
        name: ' Ana Forever ',
      }),
    ).resolves.toEqual({ name: 'Ana Forever' });
    expect(calls.select).toBe(1);
  });

  it('checkClaim 409s when another player holds the name', async () => {
    const { db } = countingDb([{ userId: 2, name: 'Ana Forever' }]);
    await expect(
      provider.checkClaim(db, {
        gameId: 7,
        userId: 1,
        name: 'Ana Forever',
        region: 'us',
      }),
    ).rejects.toThrow('Ana Forever (US) is already claimed by another player');
  });

  it('rethrowIdentityViolation maps the ruleset-identity index race to the 409', () => {
    const race = new Error('violates "idx_characters_ruleset_identity"');
    expect(() =>
      provider.rethrowIdentityViolation(race, 'ana forever', 'eu'),
    ).toThrow(
      new ConflictException(
        'Ana Forever (EU) is already claimed by another player',
      ),
    );
    expect(() =>
      provider.rethrowIdentityViolation(new Error('boom'), 'Ana', 'eu'),
    ).not.toThrow();
  });
});

describe('WowCommonModule character-identity registration', () => {
  it('registers the identity provider for each of its slugs, nothing else', () => {
    const registerAdapter = jest.fn();
    const identity = new WowForeverIdentityProvider();
    const noSlugs = { gameSlugs: [] as string[] };
    const mod = new WowCommonModule(
      { registerAdapter } as never,
      {} as never,
      noSlugs as never,
      noSlugs as never,
      {} as never,
      {} as never,
      {} as never,
      identity,
    );
    (mod as unknown as { registerAdapters(): void }).registerAdapters();
    const identityCalls = registerAdapter.mock.calls.filter(
      ([point]) => point === EXTENSION_POINTS.CHARACTER_IDENTITY,
    );
    expect(identityCalls).toEqual([
      [
        EXTENSION_POINTS.CHARACTER_IDENTITY,
        'world-of-warcraft-forever',
        identity,
      ],
    ]);
  });
});
