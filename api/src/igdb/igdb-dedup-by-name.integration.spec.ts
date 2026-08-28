/**
 * Game-variant dedup integration tests (ROK-1113).
 *
 * Covers two halves of the fix:
 * 1. Ingest regression: repeated upserts with Roman/Arabic numeral variants of
 *    the same canonical game must end up as a single row.
 * 2. Admin merge endpoint: dry-run vs commit, FK reassignment, idempotency,
 *    and the mixed-igdbId skip rule.
 */
import { eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import { upsertSingleGameRow } from './igdb-upsert.helpers';
import { upsertItadGame } from './igdb-itad-upsert.helpers';
import { mapApiGameToDbRow } from './igdb.mappers';
import type { IgdbApiGame } from './igdb.constants';
import type { GameDetailDto } from '@raid-ledger/contract';

let testApp: TestApp;
let adminToken: string;

beforeAll(async () => {
  testApp = await getTestApp();
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
});

afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
});

// ── Helpers ──────────────────────────────────────────────────────────────

async function countGamesByName(name: string): Promise<number> {
  const rows = await testApp.db
    .select({ id: schema.games.id })
    .from(schema.games)
    .where(eq(schema.games.name, name));
  return rows.length;
}

async function insertGame(
  overrides: Partial<typeof schema.games.$inferInsert> = {},
): Promise<typeof schema.games.$inferSelect> {
  const slug =
    overrides.slug ??
    `dedup-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const [game] = await testApp.db
    .insert(schema.games)
    .values({ name: 'Test Game', slug, ...overrides })
    .returning();
  return game;
}

function buildApiGame(igdbId: number, name: string, slug: string): IgdbApiGame {
  return { id: igdbId, name, slug };
}

function buildItadDto(
  name: string,
  slug: string,
  overrides: Partial<GameDetailDto> = {},
): GameDetailDto {
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
    ...overrides,
  };
}

// ── Regression: ingest dedup by normalized name ──────────────────────────

describe('Regression: ROK-1113 — ingest dedup by normalized name', () => {
  it('two ingests with Roman vs Arabic variants end up as one row', async () => {
    // First ingest writes "Slay the Spire II" via ITAD-style flow
    await upsertItadGame(
      testApp.db,
      buildItadDto('Slay the Spire II', 'slay-the-spire-ii'),
    );
    // Second ingest sees the Arabic-numeral form via IGDB sync
    await upsertSingleGameRow(
      testApp.db,
      mapApiGameToDbRow(
        buildApiGame(900111, 'Slay the Spire 2', 'slay-the-spire-2'),
      ),
    );

    const all = await testApp.db
      .select()
      .from(schema.games)
      .where(eq(schema.games.itadGameId, 'itad-slay-the-spire-ii'));
    expect(all).toHaveLength(1);
    expect(all[0].igdbId).toBe(900111);
    // Same row enriched (not duplicated): the original ITAD-derived itadGameId
    // is still attached to a single row that now also carries the IGDB id.
    const allRows = await testApp.db
      .select()
      .from(schema.games)
      .where(eq(schema.games.id, all[0].id));
    expect(allRows).toHaveLength(1);
  });

  it('second ingest of identical surface name with different igdbId enriches the first row', async () => {
    // First IGDB ingest (no igdbId on existing row → still a fresh insert)
    await upsertSingleGameRow(
      testApp.db,
      mapApiGameToDbRow(
        buildApiGame(900222, 'Halo Infinite', 'halo-infinite-a'),
      ),
    );
    // Second ingest with the SAME igdbId but a different slug must NOT insert.
    // (The igdbId conflict target already covers this; the test guards that
    // our normalized-name path doesn't break it either.)
    await upsertSingleGameRow(
      testApp.db,
      mapApiGameToDbRow(
        buildApiGame(900222, 'Halo Infinite', 'halo-infinite-b'),
      ),
    );

    expect(await countGamesByName('Halo Infinite')).toBe(1);
  });

  it('nominate same-canonical-game under two surface names → both resolve to the same id', async () => {
    // Pre-existing row uses Roman numerals
    const existing = await insertGame({
      name: 'Slay the Spire II',
      slug: 'slay-the-spire-ii',
      itadGameId: 'itad-slay-rom',
    });
    // ITAD nominates the Arabic variant — must resolve to the same row
    const nominated = await upsertItadGame(
      testApp.db,
      buildItadDto('Slay the Spire 2', 'slay-the-spire-2', {
        itadGameId: 'itad-slay-arab',
      }),
    );
    expect(nominated.id).toBe(existing.id);

    // And IGDB ingest of the same canonical game also resolves to the same id
    await upsertSingleGameRow(
      testApp.db,
      mapApiGameToDbRow(
        buildApiGame(900333, 'Slay the Spire 2', 'slay-the-spire-arabic'),
      ),
    );
    const rows = await testApp.db
      .select()
      .from(schema.games)
      .where(eq(schema.games.id, existing.id));
    expect(rows[0].igdbId).toBe(900333);
    // Total rows for this canonical game stayed at 1
    const allRows = await testApp.db.select().from(schema.games);
    const slaySpireRows = allRows.filter((r) => /slay the spire/i.test(r.name));
    expect(slaySpireRows).toHaveLength(1);
  });
});

// ── Admin endpoint: POST /admin/games/dedup-cleanup-by-name ──────────────

describe('POST /admin/games/dedup-cleanup-by-name (integration)', () => {
  it('dry-run reports groups without mutating the DB', async () => {
    await insertGame({ name: 'Slay the Spire II', slug: 'sts-2-rom' });
    await insertGame({ name: 'Slay the Spire 2', slug: 'sts-2-arab' });

    const before = await testApp.db.select().from(schema.games);

    const res = await testApp.request
      .post('/admin/games/dedup-cleanup-by-name')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.totalGroups).toBe(1);
    expect(res.body.totalLosers).toBe(1);

    const after = await testApp.db.select().from(schema.games);
    expect(after).toHaveLength(before.length);
  });

  it('commit merges groups + reassigns lineup-entry FKs', async () => {
    // Two duplicate games
    const winner = await insertGame({
      name: 'Slay the Spire II',
      slug: 'sts-2-w',
      igdbId: 901,
      itadGameId: 'itad-sts-w',
    });
    const loser = await insertGame({
      name: 'Slay the Spire 2',
      slug: 'sts-2-l',
    });

    // Build a lineup + entry pointing at the loser to verify FK reassignment
    const [lineup] = await testApp.db
      .insert(schema.communityLineups)
      .values({
        title: 'Test Lineup',
        createdBy: testApp.seed.adminUser.id,
        publicSlug: 'rok1113-test',
      })
      .returning();
    await testApp.db.insert(schema.communityLineupEntries).values({
      lineupId: lineup.id,
      gameId: loser.id,
      nominatedBy: testApp.seed.adminUser.id,
    });

    const res = await testApp.request
      .post('/admin/games/dedup-cleanup-by-name?dryRun=false')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.merged).toBe(1);
    expect(res.body.errors).toEqual([]);
    expect(res.body.report[0]).toMatchObject({
      winnerId: winner.id,
      loserIds: [loser.id],
    });

    // Loser row deleted
    const loserRows = await testApp.db
      .select()
      .from(schema.games)
      .where(eq(schema.games.id, loser.id));
    expect(loserRows).toHaveLength(0);

    // Lineup entry now points at the winner
    const entries = await testApp.db
      .select()
      .from(schema.communityLineupEntries)
      .where(eq(schema.communityLineupEntries.lineupId, lineup.id));
    expect(entries[0].gameId).toBe(winner.id);
  });

  it('is idempotent — second commit reports zero merges', async () => {
    await insertGame({
      name: 'Slay the Spire II',
      slug: 'sts-idem-w',
      igdbId: 902,
    });
    await insertGame({ name: 'Slay the Spire 2', slug: 'sts-idem-l' });

    await testApp.request
      .post('/admin/games/dedup-cleanup-by-name?dryRun=false')
      .set('Authorization', `Bearer ${adminToken}`);

    const second = await testApp.request
      .post('/admin/games/dedup-cleanup-by-name?dryRun=false')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(second.status).toBe(200);
    expect(second.body.merged).toBe(0);
    expect(second.body.report).toEqual([]);
  });

  it('skips groups with mixed igdbIds (sequel/variant case)', async () => {
    // Same canonical name BUT with two distinct non-null igdbIds — should NOT merge.
    await insertGame({
      name: 'Grand Theft Auto V',
      slug: 'gta-v-orig',
      igdbId: 1001,
    });
    await insertGame({
      name: 'Grand Theft Auto 5',
      slug: 'gta-v-remake',
      igdbId: 1002,
    });

    const res = await testApp.request
      .post('/admin/games/dedup-cleanup-by-name')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.totalGroups).toBe(0);
    expect(res.body.skippedGroups).toHaveLength(1);
    // Both rows still present
    const rows = await testApp.db.select().from(schema.games);
    const gtaRows = rows.filter((r) => /grand theft auto/i.test(r.name));
    expect(gtaRows).toHaveLength(2);
  });

  it('requires admin auth', async () => {
    const res = await testApp.request.post(
      '/admin/games/dedup-cleanup-by-name',
    );
    expect(res.status).toBe(401);
  });
});

/**
 * Regression: the admin name-merge silently failed on exactly the rows with the
 * most history, because `games_dedup_audit.canonical_game_id` is a notNull FK to
 * `games.id` with no `onDelete` (therefore RESTRICT). When the audit had pinned
 * the merge's LOSER as canonical, deleting that loser aborted the group.
 *
 * Reproduced from prod 2026-08-28: Baldur's Gate 3 survived as two rows through
 * four consecutive cleanup runs. `pickCanonicalId` ranks itadGameId tier-1 while
 * `pickNameGroupWinner` ranks it tier-3, so the two functions disagreed on which
 * row was the good one — the audit pinned the itad-keyed row, the merge tried to
 * delete it.
 */
describe('Regression: dedup merge vs games_dedup_audit FK', () => {
  /** Insert an audit row pinning `canonicalId`, mirroring a boot-time refresh. */
  async function pinAuditCanonical(
    canonicalId: number,
    dupIds: number[],
  ): Promise<void> {
    await testApp.db.insert(schema.gamesDedupAudit).values({
      matchType: 'name',
      matchKey: "baldur's gate 3",
      canonicalGameId: canonicalId,
      dupGameIds: dupIds,
      groupSize: dupIds.length + 1,
      downstreamCounts: {} as never,
      uniqueConflicts: {} as never,
      snapshotAt: new Date(),
    });
  }

  it('merges a group whose loser is pinned as an audit canonical', async () => {
    const winner = await insertGame({
      name: "Baldur's Gate 3",
      slug: 'bg3-igdb',
      igdbId: 119171,
    });
    const loser = await insertGame({
      name: "Baldur's Gate 3",
      slug: 'bg3-steam',
      itadGameId: 'itad-bg3',
      steamAppId: 1086940,
    });
    // The audit pins the ITAD-keyed row — which is the merge's loser.
    await pinAuditCanonical(loser.id, [winner.id]);

    const res = await testApp.request
      .post('/admin/games/dedup-cleanup-by-name?dryRun=false')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.errors).toEqual([]);
    expect(res.body.merged).toBe(1);

    const survivors = await testApp.db
      .select()
      .from(schema.games)
      .where(eq(schema.games.name, "Baldur's Gate 3"));
    expect(survivors).toHaveLength(1);
    expect(survivors[0].id).toBe(winner.id);
  });

  it('carries the loser steam/itad/cover identity onto the winner', async () => {
    const winner = await insertGame({
      name: 'Metro Exodus',
      slug: 'metro-igdb',
      igdbId: 119172,
    });
    const loser = await insertGame({
      name: 'Metro Exodus',
      slug: 'metro-steam',
      itadGameId: 'itad-metro',
      steamAppId: 412020,
      coverUrl: 'https://example.test/metro.jpg',
    });
    await pinAuditCanonical(loser.id, [winner.id]);

    const res = await testApp.request
      .post('/admin/games/dedup-cleanup-by-name?dryRun=false')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.body.errors).toEqual([]);

    const [survivor] = await testApp.db
      .select()
      .from(schema.games)
      .where(eq(schema.games.id, winner.id));
    expect(survivor.steamAppId).toBe(412020);
    expect(survivor.itadGameId).toBe('itad-metro');
    expect(survivor.coverUrl).toBe('https://example.test/metro.jpg');
    expect(survivor.igdbId).toBe(119172); // winner's own value not clobbered
  });

  it('does not overwrite a value the winner already has', async () => {
    const winner = await insertGame({
      name: 'Wasteland 2',
      slug: 'wl2-w',
      igdbId: 119173,
      steamAppId: 240760,
      coverUrl: 'https://example.test/keep-me.jpg',
    });
    await insertGame({
      name: 'Wasteland 2',
      slug: 'wl2-l',
      steamAppId: 999999,
      coverUrl: 'https://example.test/clobber.jpg',
    });

    await testApp.request
      .post('/admin/games/dedup-cleanup-by-name?dryRun=false')
      .set('Authorization', `Bearer ${adminToken}`);

    const [survivor] = await testApp.db
      .select()
      .from(schema.games)
      .where(eq(schema.games.id, winner.id));
    expect(survivor.steamAppId).toBe(240760);
    expect(survivor.coverUrl).toBe('https://example.test/keep-me.jpg');
  });
});

/**
 * Regression: composite-UNIQUE collisions during FK reassignment.
 *
 * `game_activity_rollups` is UNIQUE on (user_id, game_id, period, period_start)
 * and is moved with a plain `safeReassign`, which has no collision handling. If
 * the same user has a rollup for the SAME period on both the winner and the
 * loser, the UPDATE violates the constraint.
 *
 * Migration 0140 handled this table explicitly with an ADDITIVE merge of
 * total_seconds; the admin merge path never got the same treatment. Prod
 * 2026-08-28: after ROK-1437 cleared the audit-FK block, BG3 immediately failed
 * again on `game_activity_rollups_user_game_period_unique` — the same row pair
 * that had accumulated playtime under both ids.
 */
describe('Regression: rollup collision during merge', () => {
  it('additively merges colliding activity rollups instead of failing', async () => {
    const winner = await insertGame({
      name: 'Deep Rock Galactic',
      slug: 'drg-igdb',
      igdbId: 119174,
    });
    const loser = await insertGame({
      name: 'Deep Rock Galactic',
      slug: 'drg-steam',
      itadGameId: 'itad-drg',
      steamAppId: 548430,
    });

    const userId = testApp.seed.adminUser.id;
    const period = 'day';
    const periodStart = '2026-08-01';
    await testApp.db.insert(schema.gameActivityRollups).values([
      { userId, gameId: winner.id, period, periodStart, totalSeconds: 100 },
      { userId, gameId: loser.id, period, periodStart, totalSeconds: 50 },
    ]);

    const res = await testApp.request
      .post('/admin/games/dedup-cleanup-by-name?dryRun=false')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.errors).toEqual([]);
    expect(res.body.merged).toBe(1);

    const rollups = await testApp.db
      .select()
      .from(schema.gameActivityRollups)
      .where(eq(schema.gameActivityRollups.gameId, winner.id));
    expect(rollups).toHaveLength(1);
    // Additive, matching migration 0140's semantics — playtime is not lost.
    expect(rollups[0].totalSeconds).toBe(150);
  });

  it('moves a non-colliding rollup across untouched', async () => {
    const winner = await insertGame({
      name: 'Factorio',
      slug: 'factorio-igdb',
      igdbId: 119175,
    });
    const loser = await insertGame({
      name: 'Factorio',
      slug: 'factorio-steam',
      steamAppId: 427520,
    });
    const userId = testApp.seed.adminUser.id;
    await testApp.db.insert(schema.gameActivityRollups).values({
      userId,
      gameId: loser.id,
      period: 'day',
      periodStart: '2026-08-02',
      totalSeconds: 77,
    });

    const res = await testApp.request
      .post('/admin/games/dedup-cleanup-by-name?dryRun=false')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.body.errors).toEqual([]);

    const rollups = await testApp.db
      .select()
      .from(schema.gameActivityRollups)
      .where(eq(schema.gameActivityRollups.gameId, winner.id));
    expect(rollups).toHaveLength(1);
    expect(rollups[0].totalSeconds).toBe(77);
  });
});
