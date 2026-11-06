/**
 * ROK-1722 — refresh + auto-sync of Armory-linked, realmless WoW: Forever rows.
 * The SQL filter itself is asserted against a real DB in
 * characters-forever-import.integration.spec.ts.
 */
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { RefreshCharacterSchema } from '@raid-ledger/contract';
import { createDrizzleMock } from '../common/testing/drizzle-mock';
import type * as schema from '../drizzle/schema';
import { mapCharacterToDto } from './characters-mapping.helpers';
import { prepareRefresh, syncAllCharacters } from './characters-crud.helpers';

type Row = typeof schema.characters.$inferSelect;

function row(over: Partial<Row> = {}): Row {
  const now = new Date('2026-11-01T00:00:00Z');
  return {
    id: 'char-1',
    userId: 7,
    gameId: 3,
    name: 'Ana Forever',
    realm: null,
    class: 'Mage',
    spec: null,
    role: null,
    roleOverride: null,
    isMain: true,
    itemLevel: null,
    externalId: null,
    avatarUrl: null,
    renderUrl: null,
    level: null,
    race: null,
    gender: null,
    faction: null,
    lastSyncedAt: null,
    profileUrl: null,
    region: 'us',
    ruleset: 'pvp',
    addonGuid: null,
    gameVariant: 'wow_forever',
    equipment: null,
    talents: null,
    professions: null,
    displayOrder: 0,
    createdAt: now,
    updatedAt: now,
    ...over,
  };
}

const refreshDto = RefreshCharacterSchema.parse({
  region: 'eu',
  gameVariant: 'wow_forever',
});

describe('prepareRefresh — realmless Forever (ROK-1722)', () => {
  const adapter = { id: 'blizzard-sync' };
  const findAdapter = jest.fn<never, [string?]>(() => adapter as never);

  beforeEach(() => findAdapter.mockClear());

  it('allows realm null when the row has a ruleset; keeps the row region', () => {
    const out = prepareRefresh(
      mapCharacterToDto(row()),
      refreshDto,
      findAdapter,
      true,
    );
    expect(out).toEqual({ region: 'us', gameVariant: 'wow_forever', adapter });
    expect(findAdapter).toHaveBeenCalledWith('wow_forever');
  });

  it('a manual row (variant null) takes the request variant', () => {
    const manual = mapCharacterToDto(row({ gameVariant: null }));
    expect(
      prepareRefresh(manual, refreshDto, findAdapter, true).gameVariant,
    ).toBe('wow_forever');
  });

  it('a realmless manual row refreshed with the retail default stays wow_forever', () => {
    const manual = mapCharacterToDto(row({ gameVariant: null }));
    const retailDefault = RefreshCharacterSchema.parse({ region: 'us' });
    expect(retailDefault.gameVariant).toBe('retail');
    const out = prepareRefresh(manual, retailDefault, findAdapter, true);
    expect(out.gameVariant).toBe('wow_forever');
    expect(findAdapter).toHaveBeenCalledWith('wow_forever');
  });

  it('403s a Forever refresh while the Armory kill switch is off', () => {
    expect(() =>
      prepareRefresh(mapCharacterToDto(row()), refreshDto, findAdapter, false),
    ).toThrow(
      new ForbiddenException('Armory import for WoW: Forever is turned off'),
    );
    expect(findAdapter).not.toHaveBeenCalled();
  });

  it('still 404s a row with neither realm nor ruleset', () => {
    const bare = mapCharacterToDto(row({ ruleset: null }));
    expect(() => prepareRefresh(bare, refreshDto, findAdapter, true)).toThrow(
      new NotFoundException(
        'Character has no realm — cannot refresh from external source',
      ),
    );
    expect(findAdapter).not.toHaveBeenCalled();
  });
});

describe('syncAllCharacters — realmless Forever (ROK-1722)', () => {
  afterEach(() => jest.useRealTimers());

  it('fetches an Armory-linked Forever row by region + name with realm null', async () => {
    jest.useFakeTimers();
    const db = createDrizzleMock();
    db.where.mockReturnValueOnce(Promise.resolve([row()]));
    db.limit.mockResolvedValueOnce([{ apiNamespacePrefix: 'classicforever' }]);
    const fetchProfile = jest
      .fn<Promise<unknown>, [string, string | null, string, string?]>()
      .mockResolvedValue({
        name: 'Ana Forever',
        realm: null,
        class: 'Mage',
        spec: 'Frost',
        role: 'dps',
        level: 25,
        race: 'Human',
        faction: 'alliance',
        itemLevel: 23,
        avatarUrl: null,
        renderUrl: null,
        profileUrl: null,
      });
    const adapter = {
      fetchProfile,
      fetchSpecialization: jest
        .fn()
        .mockResolvedValue({ spec: null, role: null, talents: null }),
      fetchEquipment: jest.fn().mockResolvedValue(null),
      fetchProfessions: jest.fn().mockResolvedValue(null),
    };
    const logger = { log: jest.fn(), warn: jest.fn(), debug: jest.fn() };
    const pending = syncAllCharacters(
      db as never,
      () => adapter as never,
      logger,
      true,
    );
    await jest.runAllTimersAsync();
    await expect(pending).resolves.toEqual({ synced: 1, failed: 0 });
    expect(fetchProfile.mock.calls[0]?.slice(0, 3)).toEqual([
      'Ana Forever',
      null,
      'us',
    ]);
    expect(db.set).toHaveBeenCalledWith(expect.objectContaining({ level: 25 }));
    expect(logger.warn).not.toHaveBeenCalled();
  });
});

describe('syncAllCharacters — Forever kill switch off (ROK-1722)', () => {
  it('leaves Forever rows out: no Blizzard call, counted neither way', async () => {
    const db = createDrizzleMock();
    db.where.mockReturnValueOnce(Promise.resolve([row()]));
    const fetchProfile = jest.fn();
    const findAdapter = jest.fn(() => ({ fetchProfile }) as never);
    const logger = { log: jest.fn(), warn: jest.fn(), debug: jest.fn() };
    await expect(
      syncAllCharacters(db as never, findAdapter, logger, false),
    ).resolves.toEqual({ synced: 0, failed: 0 });
    expect(findAdapter).not.toHaveBeenCalled();
    expect(fetchProfile).not.toHaveBeenCalled();
  });
});
