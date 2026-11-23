/**
 * ROK-2212 (review N3) — a roster claim drops the roster-insights cache of
 * the claimed character's guilds (and with it the suggested-groups cache,
 * an `onGuildInvalidated` listener). Real-DB claim cases are the
 * integration specs'.
 */
import { Test } from '@nestjs/testing';
import { CharactersService } from '../../../../characters/characters.service';
import { DrizzleAsyncProvider } from '../../../../drizzle/drizzle.module';
import { WOW_FOREVER_GAME_SLUG } from '../../wow-forever-identity.helpers';
import { RosterInsightsCache } from '../roster-insights/roster-insights.cache';
import { RosterClaimService } from './roster-claim.service';

jest.mock('./roster-claim.tx', () => ({
  ...jest.requireActual<object>('./roster-claim.tx'),
  readMember: jest.fn(() =>
    Promise.resolve({
      memberId: 11,
      guildId: 5,
      gameId: 1,
      region: 'us',
      name: 'Tank',
    }),
  ),
  claimWithin: jest.fn(() =>
    Promise.resolve({ id: 'c1', userId: 7, region: 'us' }),
  ),
}));
jest.mock('./roster-claim.armory-copy', () => ({
  copyMemberArmory: jest.fn((_db: unknown, _member: unknown, row: unknown) =>
    Promise.resolve(row),
  ),
}));

const invalidateForCharacter = jest.fn<Promise<void>, [string]>();
const refreshExternal = jest.fn();

const db = {
  select: () => ({
    from: () => ({
      where: () => ({
        limit: () => Promise.resolve([{ slug: WOW_FOREVER_GAME_SLUG }]),
      }),
    }),
  }),
  transaction: (fn: (tx: object) => unknown) => Promise.resolve(fn({})),
};

async function makeService(): Promise<RosterClaimService> {
  const mod = await Test.createTestingModule({
    providers: [
      RosterClaimService,
      { provide: DrizzleAsyncProvider, useValue: db },
      { provide: CharactersService, useValue: { refreshExternal } },
      {
        provide: RosterInsightsCache,
        useValue: { invalidateForCharacter, invalidateForPullScope: jest.fn() },
      },
    ],
  }).compile();
  return mod.get(RosterClaimService);
}

describe('RosterClaimService.claim — cache invalidation', () => {
  beforeEach(() => {
    invalidateForCharacter.mockReset().mockResolvedValue(undefined);
    refreshExternal.mockReset().mockResolvedValue({ id: 'c1' });
  });

  it('drops the claimed character’s roster caches after the claim', async () => {
    const svc = await makeService();
    const got = await svc.claim(7, 11, { ruleset: 'normal' });
    expect(got).toEqual({ id: 'c1', rosterClaimed: true });
    expect(invalidateForCharacter).toHaveBeenCalledWith('c1');
  });

  it('a failed invalidation never fails the claim', async () => {
    invalidateForCharacter.mockRejectedValue(new Error('db down'));
    const svc = await makeService();
    await expect(svc.claim(7, 11, { ruleset: 'normal' })).resolves.toEqual({
      id: 'c1',
      rosterClaimed: true,
    });
  });
});
