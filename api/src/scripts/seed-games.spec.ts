/**
 * Unit tests for the boot-time game-registry seeder's games-INSERT guard
 * (`api/scripts/seed-games.ts::upsertRegistryGame`).
 *
 * Postgres UNIQUE treats NULL as never-equal, so ON CONFLICT cannot see an
 * existing same-name row under a different slug or with a NULL igdb_id
 * (ROK-1113 / ROK-1283). The seeder must resolve rows by normalized name
 * FIRST and merge into a match — never re-insert — or each boot silently
 * re-creates rows the dedup migrations collapsed.
 *
 * The name-dedup helper is mocked and the drizzle db is a hand-rolled
 * chainable stub (same style as `run-migrations-with-sentry.spec.ts`), so the
 * seeder's routing between merge / insert / slug-fallback is unit-testable
 * without a live database.
 */
jest.mock('../igdb/igdb-name-dedup.helpers');

import { eq } from 'drizzle-orm';
import * as schema from '../drizzle/schema';
import { findGameByNormalizedName } from '../igdb/igdb-name-dedup.helpers';
import { upsertRegistryGame } from '../../scripts/seed-games';
import { GAMES_SEED } from '../../scripts/seed-games.data';

const mockFind = findGameByNormalizedName as jest.MockedFunction<
  typeof findGameByNormalizedName
>;

type Db = Parameters<typeof upsertRegistryGame>[0];

interface RecordedInsert {
  table: unknown;
  values: unknown;
  conflict: unknown;
}

interface RecordedUpdate {
  table: unknown;
  set: unknown;
  where: unknown;
}

/** Chainable drizzle stub recording insert/update calls per table. */
function createDbStub(opts: { insertedGameId?: number } = {}) {
  const inserts: RecordedInsert[] = [];
  const updates: RecordedUpdate[] = [];

  const db = {
    insert: (table: unknown) => {
      const call: RecordedInsert = {
        table,
        values: undefined,
        conflict: undefined,
      };
      inserts.push(call);
      const chain = {
        values: (v: unknown) => {
          call.values = v;
          return chain;
        },
        onConflictDoNothing: (c?: unknown) => {
          call.conflict = c;
          return chain;
        },
        returning: () =>
          Promise.resolve(
            table === schema.games && opts.insertedGameId != null
              ? [{ id: opts.insertedGameId }]
              : [],
          ),
      };
      return chain;
    },
    update: (table: unknown) => {
      const call: RecordedUpdate = { table, set: undefined, where: undefined };
      updates.push(call);
      return {
        set: (s: unknown) => {
          call.set = s;
          return {
            where: (w: unknown) => {
              call.where = w;
              return Promise.resolve();
            },
          };
        },
      };
    },
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve([]),
        }),
      }),
    }),
  };

  return { db: db as unknown as Db, inserts, updates };
}

describe('upsertRegistryGame — games-INSERT name-dedup guard', () => {
  const wow = GAMES_SEED.find((g) => g.slug === 'world-of-warcraft');
  if (!wow) throw new Error('world-of-warcraft seed entry missing');

  beforeEach(() => {
    mockFind.mockReset();
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('merges into a name-matched row (NULL igdb_id) and never INSERTs into games', async () => {
    mockFind.mockResolvedValue({
      id: 42,
      name: 'World of Warcraft',
      igdbId: null,
      steamAppId: null,
      itadGameId: null,
    });
    const { db, inserts, updates } = createDbStub();

    await upsertRegistryGame(db, wow);

    // The NULL-as-distinct trap: an INSERT here would duplicate row 42.
    const gamesInserts = inserts.filter((c) => c.table === schema.games);
    expect(gamesInserts).toHaveLength(0);

    // Instead, igdbId + config columns merge into the matched row.
    expect(updates).toHaveLength(1);
    expect(updates[0].table).toBe(schema.games);
    expect(updates[0].where).toEqual(eq(schema.games.id, 42));
    expect(updates[0].set).toMatchObject({ igdbId: 123 });

    // Event types still seed, keyed to the merged row's id.
    const eventTypeInserts = inserts.filter(
      (c) => c.table === schema.eventTypes,
    );
    expect(eventTypeInserts).toHaveLength(wow.eventTypes.length);
    expect(eventTypeInserts[0].values).toMatchObject({ gameId: 42 });
  });

  it('no name match → INSERT ... ON CONFLICT (slug) DO NOTHING path executes', async () => {
    mockFind.mockResolvedValue(null);
    const { db, inserts, updates } = createDbStub({ insertedGameId: 7 });

    await upsertRegistryGame(db, wow);

    const gamesInserts = inserts.filter((c) => c.table === schema.games);
    expect(gamesInserts).toHaveLength(1);
    expect(gamesInserts[0].conflict).toEqual({ target: schema.games.slug });
    expect(gamesInserts[0].values).toMatchObject({
      slug: 'world-of-warcraft',
    });

    // Freshly inserted row needs no config UPDATE.
    expect(updates).toHaveLength(0);
    const eventTypeInserts = inserts.filter(
      (c) => c.table === schema.eventTypes,
    );
    expect(eventTypeInserts).toHaveLength(wow.eventTypes.length);
    expect(eventTypeInserts[0].values).toMatchObject({ gameId: 7 });
  });
});
