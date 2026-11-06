/**
 * ROK-1722 — refresh + auto-sync of Armory-linked, realmless WoW: Forever rows.
 * The SQL filter itself is asserted against a real DB in
 * characters-forever-import.integration.spec.ts.
 */
import { NotFoundException } from '@nestjs/common';
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
    );
    expect(out).toEqual({ region: 'us', gameVariant: 'wow_forever', adapter });
    expect(findAdapter).toHaveBeenCalledWith('wow_forever');
  });

  it('a manual row (variant null) takes the request variant', () => {
    const manual = mapCharacterToDto(row({ gameVariant: null }));
    expect(prepareRefresh(manual, refreshDto, findAdapter).gameVariant).toBe(
      'wow_forever',
    );
  });

  it('still 404s a row with neither realm nor ruleset', () => {
    const bare = mapCharacterToDto(row({ ruleset: null }));
    expect(() => prepareRefresh(bare, refreshDto, findAdapter)).toThrow(
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
      fetchSpecialization: jest.fn().mockResolvedValue(null),
      fetchEquipment: jest.fn().mockResolvedValue(null),
      fetchProfessions: jest.fn().mockResolvedValue(null),
    };
    const logger = { log: jest.fn(), warn: jest.fn(), debug: jest.fn() };
    const pending = syncAllCharacters(
      db as never,
      () => adapter as never,
      logger,
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
