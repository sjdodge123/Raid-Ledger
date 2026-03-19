/**
 * Integration test for ITAD discovery game insertion (ROK-855).
 * Validates collision handling against a real PostgreSQL database.
 *
 * The bug: upsertGame() only checked for existing games by slug.
 * When a game existed with the same itadGameId but a different slug,
 * the insert failed on the itad_game_id unique constraint, and the
 * retry also failed because it only changed the slug.
 */
import { eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import {
  discoverGameViaItad,
  type DiscoveryDeps,
} from './steam-itad-discovery.helpers';
import type { ItadGame } from '../itad/itad.constants';

jest.mock('./steam-igdb-enrichment.helpers', () => ({
  enrichFromIgdb: jest.fn().mockResolvedValue(null),
}));

jest.mock('./steam-content-filter.helpers', () => ({
  checkAdultContent: jest.fn().mockReturnValue({ isAdult: false }),
}));

const ITAD_GAME_A: ItadGame = {
  id: 'itad-uuid-aaa',
  slug: 'alpha-game',
  title: 'Alpha Game',
  type: 'game',
  mature: false,
};

function buildDeps(testApp: TestApp, itadGame: ItadGame | null): DiscoveryDeps {
  return {
    db: testApp.db,
    lookupBySteamAppId: jest.fn().mockResolvedValue(itadGame),
    adultFilterEnabled: false,
  };
}

function describeItadDiscoveryIntegration() {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await getTestApp();
  });

  beforeEach(async () => {
    testApp.seed = await truncateAllTables(testApp.db);
  });

  it('inserts a new game when no collision exists', async () => {
    const deps = buildDeps(testApp, ITAD_GAME_A);

    const result = await discoverGameViaItad(11111, deps);

    expect(result).not.toBeNull();
    const game = await testApp.db.query.games.findFirst({
      where: eq(schema.games.itadGameId, 'itad-uuid-aaa'),
    });
    expect(game).toBeDefined();
    expect(game!.slug).toBe('alpha-game');
    expect(game!.steamAppId).toBe(11111);
  });

  it('merges when itadGameId matches but slug differs (ROK-855 bug)', async () => {
    // Pre-insert a game with the same itadGameId but a DIFFERENT slug
    const [existing] = await testApp.db
      .insert(schema.games)
      .values({
        name: 'Alpha Game (IGDB)',
        slug: 'alpha-game-igdb', // different slug
        itadGameId: 'itad-uuid-aaa', // same itadGameId
        steamAppId: null,
      })
      .returning({ id: schema.games.id });

    const deps = buildDeps(testApp, ITAD_GAME_A);
    const result = await discoverGameViaItad(22222, deps);

    // Should merge into existing, not create a new row
    expect(result).not.toBeNull();
    expect(result!.gameId).toBe(existing.id);

    // Verify steamAppId was merged
    const game = await testApp.db.query.games.findFirst({
      where: eq(schema.games.id, existing.id),
    });
    expect(game!.steamAppId).toBe(22222);

    // Verify no duplicate was created
    const allGames = await testApp.db
      .select({ id: schema.games.id })
      .from(schema.games)
      .where(eq(schema.games.itadGameId, 'itad-uuid-aaa'));
    expect(allGames).toHaveLength(1);
  });

  it('retries with suffixed slug on slug collision', async () => {
    // Pre-insert a game with the same slug but different steamAppId
    await testApp.db.insert(schema.games).values({
      name: 'Alpha Game (other)',
      slug: 'alpha-game', // same slug
      steamAppId: 99999, // different steamAppId blocks merge
    });

    const deps = buildDeps(testApp, ITAD_GAME_A);
    const result = await discoverGameViaItad(33333, deps);

    expect(result).not.toBeNull();

    // Should have created with suffixed slug
    const game = await testApp.db.query.games.findFirst({
      where: eq(schema.games.id, result!.gameId),
    });
    expect(game!.slug).toBe('alpha-game-33333');
  });

  it('handles slug + itadGameId both colliding with different games', async () => {
    // Game A: owns the slug
    await testApp.db.insert(schema.games).values({
      name: 'Slug Owner',
      slug: 'alpha-game',
      steamAppId: 88888,
      itadGameId: 'different-itad-id',
    });

    // Game B: owns the itadGameId (different slug)
    await testApp.db.insert(schema.games).values({
      name: 'ITAD Owner',
      slug: 'alpha-game-old',
      itadGameId: 'itad-uuid-aaa',
      steamAppId: null,
    });

    const deps = buildDeps(testApp, ITAD_GAME_A);

    // Slug match (Game A) has different steamAppId → skips itadGameId merge,
    // goes straight to insertWithSlugRetry. First insert collides on slug,
    // retry uses suffixed slug + nulled itadGameId/igdbId → succeeds.
    const result = await discoverGameViaItad(44444, deps);

    expect(result).not.toBeNull();
    const game = await testApp.db.query.games.findFirst({
      where: eq(schema.games.id, result!.gameId),
    });
    expect(game!.slug).toBe('alpha-game-44444');
    expect(game!.itadGameId).toBeNull(); // cleared on retry
  });
}

describe(
  'ITAD Discovery Collision Handling (integration, ROK-855)',
  describeItadDiscoveryIntegration,
);
