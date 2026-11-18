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
import {
  hasOpenVoiceClassicSession,
  uncreditOpenRawClassicSessions,
} from './classic-activity-overlap.helpers';

jest.mock('./classic-activity-overlap.helpers');
const hasOpenVoice = jest.mocked(hasOpenVoiceClassicSession);
const uncreditRaw = jest.mocked(uncreditOpenRawClassicSessions);

/** A voice row's name: the resolved games.name, never the raw Classic name. */
const VOICE = 'World of Warcraft: Burning Crusade Classic - Anniversary Edition';
const RAW = 'World of Warcraft Classic';

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
  hasOpenVoice.mockReset().mockResolvedValue(false);
  uncreditRaw.mockReset().mockResolvedValue(undefined);
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
    expect(await service.attribute(1, 999, VOICE)).toBe(999);
    expect(db.where).toHaveBeenCalledTimes(1);
  });

  it('credits Forever when the player has a Forever character', async () => {
    db.where.mockResolvedValueOnce(GAME_ROWS).mockResolvedValueOnce([
      { gameId: ANNIVERSARY, gameVariant: null, ruleset: null },
      { gameId: 5, gameVariant: 'wow_forever', ruleset: null },
    ]);
    expect(await service.attribute(1, ANNIVERSARY, VOICE)).toBe(FOREVER);
  });

  it('keeps Anniversary for an Anniversary-only player', async () => {
    db.where
      .mockResolvedValueOnce(GAME_ROWS)
      .mockResolvedValueOnce([
        { gameId: ANNIVERSARY, gameVariant: null, ruleset: null },
      ]);
    expect(await service.attribute(1, ANNIVERSARY, VOICE)).toBe(ANNIVERSARY);
  });

  it('credits Forever when the player has no WoW characters', async () => {
    db.where.mockResolvedValueOnce(GAME_ROWS).mockResolvedValueOnce([]);
    expect(await service.attribute(1, ANNIVERSARY, VOICE)).toBe(FOREVER);
  });

  it('caches the game ids after the first lookup', async () => {
    db.where
      .mockResolvedValueOnce(GAME_ROWS)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    await service.attribute(1, ANNIVERSARY, VOICE);
    expect(await service.attribute(2, ANNIVERSARY, VOICE)).toBe(FOREVER);
    expect(db.where).toHaveBeenCalledTimes(3);
  });

  it('passes through and retries later while a game row is missing', async () => {
    db.where
      .mockResolvedValueOnce([{ id: FOREVER, slug: WOW_FOREVER_SLUG }])
      .mockResolvedValueOnce(GAME_ROWS)
      .mockResolvedValueOnce([]);
    expect(await service.attribute(1, ANNIVERSARY, VOICE)).toBe(ANNIVERSARY);
    expect(await service.attribute(1, ANNIVERSARY, VOICE)).toBe(FOREVER);
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
    expect(
      await service.attributeUnresolved(1, 'World of Warcraft'),
    ).toBeNull();
    expect(db.where).not.toHaveBeenCalled();
  });

  it('leaves the session uncredited while a game row is missing', async () => {
    db.where.mockResolvedValueOnce([{ id: FOREVER, slug: WOW_FOREVER_SLUG }]);
    expect(
      await service.attributeUnresolved(1, 'World of Warcraft Classic'),
    ).toBeNull();
  });
});

describe('ClassicActivityAttributionService — no double credit (ROK-2259)', () => {
  const ids = { foreverId: FOREVER, anniversaryId: ANNIVERSARY };

  it('leaves a raw Classic presence uncredited while a WoW voice row is open', async () => {
    hasOpenVoice.mockResolvedValue(true);
    db.where.mockResolvedValueOnce(GAME_ROWS);
    expect(await service.attributeUnresolved(1, RAW)).toBeNull();
    expect(hasOpenVoice).toHaveBeenCalledWith(db, 1, ids);
    expect(db.where).toHaveBeenCalledTimes(1);
  });

  it('leaves a mapped raw Classic presence uncredited while a WoW voice row is open', async () => {
    hasOpenVoice.mockResolvedValue(true);
    db.where.mockResolvedValueOnce(GAME_ROWS);
    expect(await service.attribute(1, ANNIVERSARY, RAW)).toBeNull();
    expect(uncreditRaw).not.toHaveBeenCalled();
  });

  it('a voice row uncredits the open raw presence row and keeps the credit', async () => {
    db.where.mockResolvedValueOnce(GAME_ROWS).mockResolvedValueOnce([]);
    expect(await service.attribute(1, ANNIVERSARY, VOICE)).toBe(FOREVER);
    expect(uncreditRaw).toHaveBeenCalledWith(db, 1, ids);
    expect(hasOpenVoice).not.toHaveBeenCalled();
  });
});

describe('ClassicActivityAttributionService — game id cache (ROK-2259)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('re-reads the game ids once the cache is older than its TTL', async () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(0);
    db.where
      .mockResolvedValueOnce(GAME_ROWS)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 77, slug: WOW_FOREVER_SLUG }, GAME_ROWS[1]])
      .mockResolvedValueOnce([]);
    await service.attribute(1, ANNIVERSARY, VOICE);
    now.mockReturnValue(10 * 60_000 + 1);
    expect(await service.attribute(1, ANNIVERSARY, VOICE)).toBe(77);
  });

  it('resetCache() forces the next call to re-read the game ids', async () => {
    db.where
      .mockResolvedValueOnce(GAME_ROWS)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 78, slug: WOW_FOREVER_SLUG }, GAME_ROWS[1]])
      .mockResolvedValueOnce([]);
    await service.attribute(1, ANNIVERSARY, VOICE);
    service.resetCache();
    expect(await service.attribute(1, ANNIVERSARY, VOICE)).toBe(78);
  });
});
