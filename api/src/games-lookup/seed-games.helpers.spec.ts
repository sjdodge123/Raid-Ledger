import { buildSeedGameUpdateSet, upsertSeedGame } from './seed-games.helpers';
import { findGameByNormalizedName } from '../igdb/igdb-name-dedup.helpers';
import { withGameNameLock } from '../igdb/games-name-lock.helpers';

jest.mock('../igdb/igdb-name-dedup.helpers', () => ({
  findGameByNormalizedName: jest.fn(),
}));
jest.mock('../igdb/games-name-lock.helpers', () => ({
  // The lock is exercised by its own spec; here it just hands the db through.
  withGameNameLock: jest.fn(
    (db: unknown, _names: unknown, fn: (tx: unknown) => unknown) => fn(db),
  ),
}));

describe('buildSeedGameUpdateSet', () => {
  const base = {
    name: 'Some Game',
    shortName: null,
    colorHex: '#112233',
    hasRoles: false,
    hasSpecs: false,
    maxCharactersPerUser: 1,
  };

  it('heals coverUrl for the chao-chao entry (ROK-1410)', () => {
    const set = buildSeedGameUpdateSet({
      ...base,
      slug: 'chao-chao',
      name: 'Chao Chao',
      coverUrl: '/game-covers/chao-chao-cover.jpg',
      websiteUrl: 'https://chaochaogame.com',
      isFreeToPlay: true,
    });
    expect(set.coverUrl).toBe('/game-covers/chao-chao-cover.jpg');
    expect(set.websiteUrl).toBe('https://chaochaogame.com');
    expect(set.isFreeToPlay).toBe(true);
  });

  it('never includes coverUrl for any other slug, even when the seed carries one', () => {
    const set = buildSeedGameUpdateSet({
      ...base,
      slug: 'world-of-warcraft',
      coverUrl: '/game-covers/anything.jpg',
    });
    expect('coverUrl' in set).toBe(false);
  });

  it('omits igdbId when absent and passes config columns through', () => {
    const set = buildSeedGameUpdateSet({ ...base, slug: 'custom' });
    expect('igdbId' in set).toBe(false);
    expect('websiteUrl' in set).toBe(false);
    expect(set.colorHex).toBe('#112233');
    expect(set.maxCharactersPerUser).toBe(1);
  });

  it('includes igdbId when present', () => {
    const set = buildSeedGameUpdateSet({ ...base, slug: 'wow', igdbId: 123 });
    expect(set.igdbId).toBe(123);
  });
});

describe('upsertSeedGame (ROK-1563 — the boot seed goes through the name-dedup guard)', () => {
  const entry = {
    slug: 'world-of-warcraft-forever',
    name: 'World of Warcraft: Forever',
    shortName: 'WoW Forever',
    colorHex: '#C79C6E',
    hasRoles: true,
    hasSpecs: true,
    maxCharactersPerUser: 10,
    apiNamespacePrefix: 'classicforever',
  };

  function fakeDb(opts: { bySlug: { id: number }[]; insertedId?: number }) {
    const set = jest
      .fn()
      .mockReturnValue({ where: jest.fn().mockResolvedValue(undefined) });
    const values = jest.fn().mockReturnValue({
      returning: jest.fn().mockResolvedValue([{ id: opts.insertedId ?? 99 }]),
    });
    const db = {
      select: jest.fn().mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue(opts.bySlug),
          }),
        }),
      }),
      update: jest.fn().mockReturnValue({ set }),
      insert: jest.fn().mockReturnValue({ values }),
    };
    return { db, set, values };
  }

  beforeEach(() => {
    jest.mocked(findGameByNormalizedName).mockReset();
    jest.mocked(withGameNameLock).mockClear();
  });

  it('takes the advisory lock on the seed name for the whole find-then-write', async () => {
    const { db } = fakeDb({ bySlug: [{ id: 7 }] });
    await upsertSeedGame(db as never, entry);
    expect(withGameNameLock).toHaveBeenCalledWith(
      db,
      entry.name,
      expect.any(Function),
    );
  });

  it('updates the config columns and re-asserts the curated name when the slug already exists (ROK-1643)', async () => {
    const { db, set, values } = fakeDb({ bySlug: [{ id: 7 }] });
    await expect(upsertSeedGame(db as never, entry)).resolves.toEqual({
      id: 7,
      action: 'updated',
    });
    expect(set).toHaveBeenCalledWith({
      ...buildSeedGameUpdateSet(entry),
      name: entry.name,
    });
    expect(findGameByNormalizedName).not.toHaveBeenCalled();
    expect(values).not.toHaveBeenCalled();
  });

  it('merges into a row the IGDB sync created under another slug, and gives it the seed slug', async () => {
    const { db, set, values } = fakeDb({ bySlug: [] });
    jest.mocked(findGameByNormalizedName).mockResolvedValue({
      id: 42,
      name: 'World of Warcraft: Forever',
      igdbId: 555,
      steamAppId: null,
      itadGameId: null,
    });
    await expect(upsertSeedGame(db as never, entry)).resolves.toEqual({
      id: 42,
      action: 'merged',
    });
    expect(set).toHaveBeenCalledWith({
      ...buildSeedGameUpdateSet(entry),
      slug: entry.slug,
    });
    expect(values).not.toHaveBeenCalled();
  });

  it('never writes igdbId on a name-merge, even when the seed carries one (2026-07-10 revert hazard)', async () => {
    const { db, set } = fakeDb({ bySlug: [] });
    jest.mocked(findGameByNormalizedName).mockResolvedValue({
      id: 42,
      name: 'Valheim',
      igdbId: null,
      steamAppId: null,
      itadGameId: null,
    });
    await upsertSeedGame(db as never, {
      ...entry,
      slug: 'valheim',
      name: 'Valheim',
      igdbId: 104967,
    });
    const written = set.mock.calls[0][0] as Record<string, unknown>;
    expect('igdbId' in written).toBe(false);
    expect(written.slug).toBe('valheim');
  });

  it('inserts only when neither the slug nor the normalized name exists', async () => {
    const { db, values } = fakeDb({ bySlug: [], insertedId: 101 });
    jest.mocked(findGameByNormalizedName).mockResolvedValue(null);
    await expect(upsertSeedGame(db as never, entry)).resolves.toEqual({
      id: 101,
      action: 'created',
    });
    expect(values).toHaveBeenCalledWith(entry);
  });
});
