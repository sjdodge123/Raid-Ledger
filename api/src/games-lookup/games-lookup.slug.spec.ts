/**
 * ROK-1464 — unit coverage for `GamesLookupService.findBySlug`, the slug → id
 * primitive behind `GET /games/slug/:slug`.
 *
 * The route exists because every other games/LFG route is `ParseIntPipe`-keyed
 * while the LFG group page is addressed by slug, so a miss MUST 404 rather
 * than fall through to a 400 on the next request the page makes.
 */
import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createDrizzleMock, type MockDb } from '../common/testing/drizzle-mock';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { IgdbService } from '../igdb/igdb.service';
import { ItadService } from '../itad/itad.service';
import { GamesLookupService } from './games-lookup.service';

describe('GamesLookupService.findBySlug', () => {
  let service: GamesLookupService;
  let mockDb: MockDb;

  beforeEach(async () => {
    mockDb = createDrizzleMock();
    const module = await Test.createTestingModule({
      providers: [
        GamesLookupService,
        { provide: DrizzleAsyncProvider, useValue: mockDb },
        { provide: ItadService, useValue: { searchGames: jest.fn() } },
        { provide: IgdbService, useValue: { searchGames: jest.fn() } },
      ],
    }).compile();
    service = module.get(GamesLookupService);
  });

  it('returns the id/slug/name triple for an exact slug match', async () => {
    mockDb.limit.mockResolvedValueOnce([
      { id: 42, slug: 'deep-rock-galactic', name: 'Deep Rock Galactic' },
    ]);

    const result = await service.findBySlug('deep-rock-galactic');

    expect(result).toEqual({
      id: expect.any(Number),
      slug: 'deep-rock-galactic',
      name: expect.any(String),
    });
  });

  it('throws NotFound when no row carries that slug', async () => {
    mockDb.limit.mockResolvedValueOnce([]);

    await expect(service.findBySlug('does-not-exist')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
