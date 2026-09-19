/**
 * `GET /games/configured` byte-stability regression suite (ROK-1407).
 *
 * The endpoint is the heaviest recurring transfer in prod (~122.5KB gzipped)
 * and never revalidated to 304, because its body changed between requests
 * even when no game data did: `ORDER BY name` alone is not a stable sort
 * under duplicate names, and `genres` is persisted in IGDB's response order,
 * so a reorder of the same set rewrote the body with no length change.
 *
 * Express emits a weak ETag (md5 of the body) for every JSON response by
 * default and answers `If-None-Match` with a 304 — neither `main.ts` nor the
 * test app configures `etag`, so that default is identical in both. These
 * tests therefore assert the real production revalidation path.
 *
 * The shape test for this endpoint lives in `igdb.integration.spec.ts`
 * (`GET /games/configured`) and is intentionally left there.
 */
import { GameRegistryListResponseSchema } from '@raid-ledger/contract';
import { eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';

const CACHE_CONTROL = 'private, max-age=300, stale-while-revalidate=3600';

describe('GET /games/configured — byte stability (ROK-1407)', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await getTestApp();
  });

  afterEach(async () => {
    testApp.seed = await truncateAllTables(testApp.db);
  });

  /** Insert a registry game directly; returns the persisted row. */
  async function insertGame(
    name: string,
    overrides: Partial<typeof schema.games.$inferInsert> = {},
  ): Promise<typeof schema.games.$inferSelect> {
    const [game] = await testApp.db
      .insert(schema.games)
      .values({
        name,
        slug: `${name.toLowerCase().replace(/\s+/g, '-')}-${Math.random()
          .toString(36)
          .slice(2, 8)}`,
        coverUrl: null,
        igdbId: null,
        hidden: false,
        banned: false,
        ...overrides,
      })
      .returning();
    return game;
  }

  /** GET the registry, asserting a 200 and returning the response. */
  async function getRegistry(): Promise<{
    etag: string;
    text: string;
    body: unknown;
    headers: Record<string, string>;
  }> {
    const res = await testApp.request.get('/games/configured');
    expect(res.status).toBe(200);
    expect(res.headers.etag).toBeDefined();
    return {
      etag: res.headers.etag,
      text: res.text,
      body: res.body,
      headers: res.headers,
    };
  }

  // ===================================================================
  // 1. Warm repeat revalidates to 304
  // ===================================================================

  it('revalidates a warm repeat to 304 with an empty body', async () => {
    await insertGame('Stable Game', { igdbId: 7001, genres: [12, 31] });

    const first = await getRegistry();
    const second = await testApp.request
      .get('/games/configured')
      .set('If-None-Match', first.etag);

    expect(second.status).toBe(304);
    expect(second.text).toBeFalsy();
  });

  // ===================================================================
  // 2. THE regression: a no-op re-upsert that reorders `genres`
  // ===================================================================

  it('still revalidates to 304 after a re-upsert that only reorders genres', async () => {
    const game = await insertGame('Reordered Genres', {
      igdbId: 7002,
      genres: [31, 12, 5],
    });

    const first = await getRegistry();

    // Exactly what an IGDB search/sync upsert does: same set, new order,
    // every other projected column byte-identical.
    await testApp.db
      .update(schema.games)
      .set({ genres: [5, 31, 12] })
      .where(eq(schema.games.id, game.id));

    const second = await testApp.request
      .get('/games/configured')
      .set('If-None-Match', first.etag);

    expect(second.status).toBe(304);
  });

  // ===================================================================
  // 3. Duplicate names are order-stable
  // ===================================================================

  it('serves byte-identical bodies when two enabled games share a name', async () => {
    await insertGame('Twin Title', { igdbId: 7003 });
    await insertGame('Twin Title', { igdbId: 7004 });

    const first = await getRegistry();
    const second = await getRegistry();

    expect(second.text).toBe(first.text);
    expect(second.etag).toBe(first.etag);
  });

  // ===================================================================
  // 4. A real config change breaks the ETag
  // ===================================================================

  it('returns 200 with a new ETag when a config column actually changes', async () => {
    const game = await insertGame('Recolored Game', {
      igdbId: 7005,
      colorHex: '#111111',
    });

    const first = await getRegistry();

    await testApp.db
      .update(schema.games)
      .set({ colorHex: '#222222' })
      .where(eq(schema.games.id, game.id));

    const second = await testApp.request
      .get('/games/configured')
      .set('If-None-Match', first.etag);

    expect(second.status).toBe(200);
    expect(second.headers.etag).not.toBe(first.etag);
  });

  it('returns 200 with a new ETag when a game is disabled', async () => {
    const game = await insertGame('Soon Disabled', { igdbId: 7006 });

    const first = await getRegistry();

    await testApp.db
      .update(schema.games)
      .set({ enabled: false })
      .where(eq(schema.games.id, game.id));

    const second = await testApp.request
      .get('/games/configured')
      .set('If-None-Match', first.etag);

    expect(second.status).toBe(200);
    expect(second.headers.etag).not.toBe(first.etag);
  });

  // ===================================================================
  // 5. Moderation exclusion — banned games are absent
  // ===================================================================

  it('omits banned games even though they are still enabled', async () => {
    await insertGame('Tombstoned Game', { igdbId: 7007, banned: true });
    await insertGame('Visible Game', { igdbId: 7008 });

    const { body } = await getRegistry();
    const names = (body as { data: { name: string }[] }).data.map(
      (g) => g.name,
    );

    expect(names).toContain('Visible Game');
    expect(names).not.toContain('Tombstoned Game');
  });

  // ===================================================================
  // 6. Cache-Control is private, never public
  // ===================================================================

  it('sends a private Cache-Control and never a shared-cacheable one', async () => {
    const { headers } = await getRegistry();

    expect(headers['cache-control']).toBe(CACHE_CONTROL);
    expect(headers['cache-control']).not.toContain('public');
  });

  // ===================================================================
  // 7. Contract parity
  // ===================================================================

  it('returns a payload the contract schema accepts', async () => {
    await insertGame('Contract Game', {
      igdbId: 7009,
      genres: [31, 12],
      playerCount: { min: 1, max: 40 },
      shortName: 'CG',
      colorHex: '#ABCDEF',
      maxCharactersPerUser: 3,
    });

    const { body } = await getRegistry();

    expect(() => GameRegistryListResponseSchema.parse(body)).not.toThrow();

    const parsed = GameRegistryListResponseSchema.parse(body);
    const entry = parsed.data.find((g) => g.name === 'Contract Game');
    // The projection sorts genres ascending (the fix); the contract allows it.
    expect(entry?.genres).toEqual([12, 31]);
  });

  // ===================================================================
  // 8. AC3 — plain IGDB-cached games are still looked up here
  // ===================================================================

  it('still serves a plain IGDB-cached game by id and by slug', async () => {
    const cached = await insertGame('Never Seeded Game', { igdbId: 7010 });

    const { body } = await getRegistry();
    const data = (body as { data: { id: number; slug: string }[] }).data;

    expect(data.some((g) => g.id === cached.id)).toBe(true);
    expect(data.some((g) => g.slug === cached.slug)).toBe(true);
  });
});
