/**
 * ROK-2259 — DB glue of the WoW-plugin attribution adapter: it resolves the
 * two Classic-family game ids by slug, reads the player's characters only for
 * Anniversary-resolved play, and registers itself under the WoW plugin.
 */
import {
  createDrizzleMock,
  type MockDb,
} from '../../common/testing/drizzle-mock';
import { EXTENSION_POINTS } from '../plugin-host/extension-points';
import type { PluginRegistryService } from '../plugin-host/plugin-registry.service';
import { ClassicActivityAttributionService } from './classic-activity-attribution.service';
import {
  WOW_ANNIVERSARY_SLUG,
  WOW_FOREVER_SLUG,
} from './classic-activity-attribution.helpers';
import { WOW_COMMON_MANIFEST } from './manifest';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../../drizzle/schema';

const FOREVER = 11;
const ANNIVERSARY = 22;
const GAME_ROWS = [
  { id: FOREVER, slug: WOW_FOREVER_SLUG },
  { id: ANNIVERSARY, slug: WOW_ANNIVERSARY_SLUG },
];

let db: MockDb;
let registerAdapter: jest.Mock;
let service: ClassicActivityAttributionService;

beforeEach(() => {
  db = createDrizzleMock();
  registerAdapter = jest.fn();
  const registry = { registerAdapter } as unknown as PluginRegistryService;
  service = new ClassicActivityAttributionService(
    db as unknown as PostgresJsDatabase<typeof schema>,
    registry,
  );
});

describe('ClassicActivityAttributionService.onModuleInit (ROK-2259)', () => {
  it('registers under the WoW plugin so it suspends with it', () => {
    service.onModuleInit();
    expect(registerAdapter).toHaveBeenCalledWith(
      EXTENSION_POINTS.GAME_ACTIVITY_ATTRIBUTION,
      WOW_COMMON_MANIFEST.id,
      service,
      { ownerPluginId: WOW_COMMON_MANIFEST.id },
    );
  });
});

describe('ClassicActivityAttributionService.attribute (ROK-2259)', () => {
  it('passes any other game through without reading characters', async () => {
    db.where.mockResolvedValueOnce(GAME_ROWS);
    expect(await service.attribute(1, 999)).toBe(999);
    expect(db.where).toHaveBeenCalledTimes(1);
  });

  it('credits Forever when the player has a Forever character', async () => {
    db.where.mockResolvedValueOnce(GAME_ROWS).mockResolvedValueOnce([
      { gameId: ANNIVERSARY, gameVariant: null, ruleset: null },
      { gameId: 5, gameVariant: 'wow_forever', ruleset: null },
    ]);
    expect(await service.attribute(1, ANNIVERSARY)).toBe(FOREVER);
  });

  it('keeps Anniversary for an Anniversary-only player', async () => {
    db.where
      .mockResolvedValueOnce(GAME_ROWS)
      .mockResolvedValueOnce([
        { gameId: ANNIVERSARY, gameVariant: null, ruleset: null },
      ]);
    expect(await service.attribute(1, ANNIVERSARY)).toBe(ANNIVERSARY);
  });

  it('credits Forever when the player has no WoW characters', async () => {
    db.where.mockResolvedValueOnce(GAME_ROWS).mockResolvedValueOnce([]);
    expect(await service.attribute(1, ANNIVERSARY)).toBe(FOREVER);
  });

  it('caches the game ids after the first lookup', async () => {
    db.where
      .mockResolvedValueOnce(GAME_ROWS)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    await service.attribute(1, ANNIVERSARY);
    expect(await service.attribute(2, ANNIVERSARY)).toBe(FOREVER);
    expect(db.where).toHaveBeenCalledTimes(3);
  });

  it('passes through and retries later while a game row is missing', async () => {
    db.where
      .mockResolvedValueOnce([{ id: FOREVER, slug: WOW_FOREVER_SLUG }])
      .mockResolvedValueOnce(GAME_ROWS)
      .mockResolvedValueOnce([]);
    expect(await service.attribute(1, ANNIVERSARY)).toBe(ANNIVERSARY);
    expect(await service.attribute(1, ANNIVERSARY)).toBe(FOREVER);
  });
});

describe('ClassicActivityAttributionService.attributeUnresolved (ROK-2259)', () => {
  it('credits Forever for an unmapped Classic name and a Forever character', async () => {
    db.where
      .mockResolvedValueOnce(GAME_ROWS)
      .mockResolvedValueOnce([
        { gameId: 5, gameVariant: 'wow_forever', ruleset: null },
      ]);
    expect(
      await service.attributeUnresolved(1, 'World of Warcraft Classic'),
    ).toBe(FOREVER);
  });

  it('keeps Anniversary for an Anniversary-only player, case-insensitively', async () => {
    db.where
      .mockResolvedValueOnce(GAME_ROWS)
      .mockResolvedValueOnce([
        { gameId: ANNIVERSARY, gameVariant: null, ruleset: null },
      ]);
    expect(
      await service.attributeUnresolved(1, 'world of warcraft CLASSIC'),
    ).toBe(ANNIVERSARY);
  });

  it('credits Forever when the player has no WoW characters', async () => {
    db.where.mockResolvedValueOnce(GAME_ROWS).mockResolvedValueOnce([]);
    expect(
      await service.attributeUnresolved(1, 'World of Warcraft Classic'),
    ).toBe(FOREVER);
  });

  it('ignores any other unmapped name without reading the database', async () => {
    expect(await service.attributeUnresolved(1, 'Unknown Game')).toBeNull();
    expect(await service.attributeUnresolved(1, 'World of Warcraft')).toBeNull();
    expect(db.where).not.toHaveBeenCalled();
  });

  it('leaves the session uncredited while a game row is missing', async () => {
    db.where.mockResolvedValueOnce([{ id: FOREVER, slug: WOW_FOREVER_SLUG }]);
    expect(
      await service.attributeUnresolved(1, 'World of Warcraft Classic'),
    ).toBeNull();
  });
});
