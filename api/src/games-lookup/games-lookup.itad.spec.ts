/**
 * The ITAD branch of `GamesLookupService.lookupByName` runs inside the user's
 * request: the Steam app id lookup must fail fast on a long ITAD 429 pause
 * like the search before it, instead of waiting the pause out.
 */
import { Test } from '@nestjs/testing';
import type { GameDetailDto } from '@raid-ledger/contract';
import { createDrizzleMock } from '../common/testing/drizzle-mock';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { IgdbService } from '../igdb/igdb.service';
import { ITAD_INTERACTIVE_FETCH, type ItadGame } from '../itad/itad.constants';
import { ItadService } from '../itad/itad.service';
import { GamesLookupService } from './games-lookup.service';

const ITAD_GAME: ItadGame = {
  id: 'uuid-1',
  slug: 'elden-ring',
  title: 'Elden Ring',
  type: 'game',
  mature: false,
};

interface Internals {
  findExistingByName: (q: string) => Promise<GameDetailDto | null>;
  findOrInsertItadRow: (g: ItadGame, appId: number | null) => Promise<number>;
  fetchDetailById: (id: number) => Promise<GameDetailDto>;
}

async function buildService(itad: Record<string, jest.Mock>) {
  const module = await Test.createTestingModule({
    providers: [
      GamesLookupService,
      { provide: DrizzleAsyncProvider, useValue: createDrizzleMock() },
      { provide: ItadService, useValue: itad },
      { provide: IgdbService, useValue: { searchGames: jest.fn() } },
    ],
  }).compile();
  const service = module.get(GamesLookupService);
  const internals = service as unknown as Internals;
  jest.spyOn(internals, 'findExistingByName').mockResolvedValue(null);
  jest
    .spyOn(internals, 'fetchDetailById')
    .mockResolvedValue({ id: 7 } as GameDetailDto);
  const insert = jest
    .spyOn(internals, 'findOrInsertItadRow')
    .mockResolvedValue(7);
  return { service, insert };
}

describe('GamesLookupService.lookupByName — ITAD fail-fast', () => {
  it('passes the interactive limit to the Steam app id lookup', async () => {
    const itad = {
      searchGames: jest.fn().mockResolvedValue([ITAD_GAME]),
      lookupSteamAppIds: jest
        .fn()
        .mockResolvedValue(new Map([['uuid-1', 1245620]])),
    };
    const { service, insert } = await buildService(itad);

    await service.lookupByName('elden ring');

    expect(itad.lookupSteamAppIds).toHaveBeenCalledWith(
      [{ id: 'uuid-1', slug: 'elden-ring' }],
      ITAD_INTERACTIVE_FETCH,
    );
    expect(insert).toHaveBeenCalledWith(ITAD_GAME, 1245620);
  });
});
