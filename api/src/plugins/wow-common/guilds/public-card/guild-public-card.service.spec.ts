/**
 * ROK-1813 — `toPublicCard` (D5/D6/D7) and the `read` miss paths that need
 * no database (malformed slug, plugin inactive → the one 404, D2).
 */
import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  createDrizzleMock,
  type MockDb,
} from '../../../../common/testing/drizzle-mock';
import { DrizzleAsyncProvider } from '../../../../drizzle/drizzle.module';
import { PluginRegistryService } from '../../../plugin-host/plugin-registry.service';
import {
  GuildPublicCardService,
  toPublicCard,
} from './guild-public-card.service';
import type { PublicCardRow } from './guild-public-card.queries';

const ROW: PublicCardRow = {
  name: 'Iron Tide',
  region: 'us',
  realmSlug: null,
  rawRealm: null,
  memberCount: 143,
  gameName: 'World of Warcraft: Forever',
  recruitment: {
    recruiting: false,
    wanted: [
      { className: 'Priest', role: 'healer', state: 'open', note: 'Aldren' },
    ],
    applyUrl: 'http://example.com/apply',
  },
};

describe('toPublicCard', () => {
  it('maps only the D5 fields: rounded count, closed headline, no note, http apply nulled', () => {
    expect(toPublicCard(ROW)).toEqual({
      name: 'Iron Tide',
      region: 'us',
      realmName: null,
      gameName: 'World of Warcraft: Forever',
      approxMemberCount: 140,
      recruitment: {
        state: 'closed',
        wanted: [{ className: 'Priest', role: 'healer', state: 'open' }],
        applyUrl: null,
      },
    });
  });

  it('a realmed guild shows the reported realm; < 10 members → null; unset recruitment → null', () => {
    const card = toPublicCard({
      ...ROW,
      realmSlug: 'area-52',
      rawRealm: 'Area 52',
      memberCount: 7,
      recruitment: null,
    });
    expect(card.realmName).toBe('Area 52');
    expect(card.approxMemberCount).toBeNull();
    expect(card.recruitment).toBeNull();
  });
});

describe('GuildPublicCardService.read misses (D2)', () => {
  let db: MockDb;

  async function service(active: string[]): Promise<GuildPublicCardService> {
    db = createDrizzleMock();
    const moduleRef = await Test.createTestingModule({
      providers: [
        GuildPublicCardService,
        { provide: DrizzleAsyncProvider, useValue: db },
        {
          provide: PluginRegistryService,
          useValue: { getActiveSlugsSync: () => new Set(active) },
        },
      ],
    }).compile();
    return moduleRef.get(GuildPublicCardService);
  }

  it('a malformed slug is the same 404 Not found, before any query', async () => {
    const svc = await service(['blizzard']);
    await expect(svc.read('short')).rejects.toThrow(
      new NotFoundException('Not found'),
    );
    expect(db.select).not.toHaveBeenCalled();
  });

  it('wow-common (blizzard) inactive is the same 404 Not found, before any query', async () => {
    const svc = await service([]);
    await expect(svc.read('ABCDEFGHijklmnop')).rejects.toThrow(
      new NotFoundException('Not found'),
    );
    expect(db.select).not.toHaveBeenCalled();
  });
});
