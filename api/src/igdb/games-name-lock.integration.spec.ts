/**
 * ROK-1438 — find-then-insert race on `games.name`.
 *
 * The ROK-1113 dedup guard is a READ followed by a separate WRITE with no
 * database constraint behind it: `games` has UNIQUE on igdb_id, slug,
 * itad_game_id and a partial one on steam_app_id, and NOTHING on name. Two
 * concurrent requests for the same title both read, both miss, both insert.
 * Prod 2026-08-28 found 5 such groups, two with adjacent ids created seconds
 * apart.
 *
 * These tests need a REAL database — `pg_advisory_xact_lock` contention is
 * invisible to a unit mock, and the whole point is that two connections
 * serialize against each other.
 */
import { eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import type { GameDetailDto } from '@raid-ledger/contract';
import { withGameNameLock } from './games-name-lock.helpers';
import * as nameDedup from './igdb-name-dedup.helpers';
import { upsertItadGame } from './igdb-itad-upsert.helpers';

let testApp: TestApp;

beforeAll(async () => {
  testApp = await getTestApp();
});

afterEach(async () => {
  jest.restoreAllMocks();
  testApp.seed = await truncateAllTables(testApp.db);
});

// ── Rendezvous ───────────────────────────────────────────────────────────

/**
 * Two-party rendezvous with a deadline. Returns an `arrive()` that resolves
 * as soon as BOTH parties have arrived, or when `deadlineMs` elapses.
 *
 * This is a synchronization primitive, not a `sleep()`: the deadline is only
 * reached when the other party is genuinely blocked (which is the assertion),
 * and it is what keeps the fixed code from hanging on a strict barrier.
 *
 * Unfixed, both racers arrive and are released instantly, so both proceed to
 * INSERT — the exact interleaving that produced the prod duplicates. Fixed,
 * the second racer is still parked on the advisory lock and never arrives, so
 * the first is released by the deadline, commits, and the second then sees its
 * row. Either way the test terminates; only the outcome differs.
 */
function createRendezvous(parties: number, deadlineMs: number) {
  let arrived = 0;
  let release!: () => void;
  const opened = new Promise<void>((resolve) => {
    release = resolve;
  });
  return async function arrive(): Promise<void> {
    arrived += 1;
    if (arrived >= parties) {
      release();
      return;
    }
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([
      opened,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, deadlineMs);
      }),
    ]);
    if (timer) clearTimeout(timer);
  };
}

// ── The lock primitive ───────────────────────────────────────────────────

describe('withGameNameLock', () => {
  /**
   * Run `fn` twice concurrently, recording the peak number of callbacks that
   * were inside their critical section at the same time.
   */
  async function measurePeakConcurrency(
    names: [string, string],
  ): Promise<number> {
    const arrive = createRendezvous(2, 400);
    let inside = 0;
    let peak = 0;
    const run = (name: string) =>
      withGameNameLock(testApp.db, name, async () => {
        inside += 1;
        peak = Math.max(peak, inside);
        await arrive();
        inside -= 1;
      });
    await Promise.all([run(names[0]), run(names[1])]);
    return peak;
  }

  it('serializes two critical sections that normalize to the same name', async () => {
    const peak = await measurePeakConcurrency([
      'Slay the Spire II',
      'Slay the Spire 2',
    ]);
    expect(peak).toBe(1);
  });

  it('does NOT serialize different names — the gate is per-title, not global', async () => {
    const peak = await measurePeakConcurrency(['Metro Exodus', 'Deep Rock']);
    expect(peak).toBe(2);
  });

  it('releases the lock when the callback throws', async () => {
    await expect(
      withGameNameLock(testApp.db, 'Metro Exodus', () =>
        Promise.reject(new Error('boom')),
      ),
    ).rejects.toThrow('boom');

    // A rolled-back transaction must not leave the advisory lock held.
    await expect(
      withGameNameLock(testApp.db, 'Metro Exodus', () => Promise.resolve('ok')),
    ).resolves.toBe('ok');
  });
});

// ── The regression ───────────────────────────────────────────────────────

function buildItadDto(name: string, slug: string): GameDetailDto {
  return {
    id: 0,
    igdbId: null,
    name,
    slug,
    coverUrl: null,
    genres: [],
    summary: null,
    rating: null,
    aggregatedRating: null,
    popularity: null,
    gameModes: [],
    themes: [],
    platforms: [],
    screenshots: [],
    videos: [],
    firstReleaseDate: null,
    playerCount: null,
    twitchGameId: null,
    crossplay: null,
    itadGameId: `itad-${slug}`,
    itadBoxartUrl: null,
    itadTags: [],
    itadCurrentPrice: null,
    itadCurrentCut: null,
    itadCurrentShop: null,
    itadCurrentUrl: null,
    itadLowestPrice: null,
    itadLowestCut: null,
    itadPriceUpdatedAt: null,
  };
}

/**
 * Force the interleaving: park each racer at the rendezvous immediately after
 * its dedup SELECT resolves, so both have finished reading before either can
 * write — unless the lock stops the second from reading at all.
 */
function forceDedupInterleaving(deadlineMs = 400): void {
  const arrive = createRendezvous(2, deadlineMs);
  const real = nameDedup.findGameByNormalizedName;
  jest
    .spyOn(nameDedup, 'findGameByNormalizedName')
    .mockImplementation(async (db, name) => {
      const result = await real(db, name);
      await arrive();
      return result;
    });
}

async function countByNormalizedName(name: string): Promise<number> {
  const rows = await testApp.db
    .select({ id: schema.games.id })
    .from(schema.games)
    .where(eq(schema.games.name, name));
  return rows.length;
}

describe('Regression: ROK-1438 — concurrent inserts of the same title', () => {
  it('two concurrent ITAD upserts of the same title yield ONE row', async () => {
    forceDedupInterleaving();

    // Same title, different slugs and ITAD ids — nothing else in the schema
    // stops these from becoming two rows. This is the prod fingerprint:
    // "mass effect 2 (2010 edition)" at ids 27414 and 27462.
    await Promise.all([
      upsertItadGame(testApp.db, buildItadDto('Metro Exodus', 'metro-exodus')),
      upsertItadGame(
        testApp.db,
        buildItadDto('Metro Exodus', 'metro-exodus-gold'),
      ),
    ]);

    expect(await countByNormalizedName('Metro Exodus')).toBe(1);
  });

  it('two concurrent upserts of normalization-equivalent titles yield ONE row', async () => {
    forceDedupInterleaving();

    await Promise.all([
      upsertItadGame(
        testApp.db,
        buildItadDto('Slay the Spire II', 'slay-the-spire-ii'),
      ),
      upsertItadGame(
        testApp.db,
        buildItadDto('Slay the Spire 2', 'slay-the-spire-2'),
      ),
    ]);

    const rows = await testApp.db
      .select({ id: schema.games.id })
      .from(schema.games);
    // The baseline seed row ("Test Game") plus exactly one Slay the Spire row.
    expect(rows).toHaveLength(2);
  });

  it('still creates distinct rows for genuinely different titles', async () => {
    forceDedupInterleaving();

    await Promise.all([
      upsertItadGame(testApp.db, buildItadDto('Metro Exodus', 'metro-exodus')),
      upsertItadGame(testApp.db, buildItadDto('Deep Rock', 'deep-rock')),
    ]);

    expect(await countByNormalizedName('Metro Exodus')).toBe(1);
    expect(await countByNormalizedName('Deep Rock')).toBe(1);
  });
});
