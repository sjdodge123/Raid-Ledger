/**
 * Common Ground `cohort` row integration tests (ROK-1538, real DB).
 *
 * The fourth themed row: games this lineup's ROSTER has already resolved
 * together in a PRIOR lineup, served by `GET /lineups/common-ground` as tiles
 * with `theme: 'cohort'`.
 *
 * Pins the four behaviours that a second SQL copy or a naive concat would
 * each break:
 *   1. a remembered game that is NOT in the filtered pool still appears, fully
 *      enriched (score breakdown, owner count, genres) and themed `cohort`;
 *   2. a remembered game that IS in the pool is RE-THEMED, not duplicated;
 *   3. an already-nominated game is excluded, exactly as the pool excludes it;
 *   4. a brand-new lineup with ZERO nominations already gets the row — which
 *      the pre-ROK-1538 engaged-set signature made impossible.
 */
import { eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import type { CommonGroundResponseDto } from '@raid-ledger/contract';
import { loadCohortSignature } from './cohort-memory-signature.helpers';

function describeCohortRow() {
  let testApp: TestApp;
  let adminToken: string;
  let adminId: number;
  let priorLineup: number;
  let currentLineup: number;
  let rememberedGame: number;
  let poolGame: number;

  /** A game nobody owns — it can only reach the response via cohort memory. */
  async function insertGame(name: string, slug: string): Promise<number> {
    const [game] = await testApp.db
      .insert(schema.games)
      .values({ name, slug, steamAppId: Math.floor(Math.random() * 9e5) + 1e5 })
      .returning();
    return game.id;
  }

  async function makeLineup(
    title: string,
    slug: string,
    status: 'building' | 'decided',
  ): Promise<number> {
    const [row] = await testApp.db
      .insert(schema.communityLineups)
      .values({
        title,
        status,
        visibility: 'public',
        createdBy: adminId,
        publicSlug: slug,
      })
      .returning();
    return row.id;
  }

  /** Write one cohort-memory row against `lineupId`'s roster signature. */
  async function remember(
    sourceLineupId: number,
    forLineupId: number,
    gameId: number,
    resolution: 'decided' | 'match' | 'veto_won',
    createdAt: Date,
  ): Promise<void> {
    const sig = await loadCohortSignature(testApp.db, forLineupId);
    if (!sig) throw new Error('expected a roster signature');
    await testApp.db.insert(schema.communityLineupCohortMemory).values({
      participantIds: sig.participantIds,
      participantHash: sig.participantHash,
      cohortSize: sig.cohortSize,
      gameId,
      sourceLineupId,
      resolution,
      createdAt,
    });
  }

  const fetchCommonGround = async (
    lineupId: number,
  ): Promise<CommonGroundResponseDto> => {
    const res = await testApp.request
      .get(`/lineups/common-ground?lineupId=${lineupId}&minOwners=1`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    return res.body as CommonGroundResponseDto;
  };

  beforeAll(async () => {
    testApp = await getTestApp();
  });

  beforeEach(async () => {
    const seed = await truncateAllTables(testApp.db);
    adminId = seed.adminUser.id;
    adminToken = await loginAsAdmin(testApp.request, seed);

    rememberedGame = await insertGame('Remembered Game', 'cg-remembered');
    poolGame = await insertGame('Pool Game', 'cg-pool');
    // Only `poolGame` is owned, so `minOwners=1` returns it and NOT the
    // remembered one — the cohort row is the only way the latter can appear.
    await testApp.db.insert(schema.gameInterests).values({
      userId: adminId,
      gameId: poolGame,
      source: 'steam_library',
    });

    priorLineup = await makeLineup('Prior', 'cgslug01', 'decided');
    currentLineup = await makeLineup('Current', 'cgslug02', 'building');
    // Both lineups share a roster of exactly {admin}, so the memory matches.
    await remember(
      priorLineup,
      currentLineup,
      rememberedGame,
      'decided',
      new Date('2026-09-13T12:00:00.000Z'),
    );
  });

  it('surfaces a remembered game the pool filters out, fully enriched', async () => {
    const body = await fetchCommonGround(currentLineup);

    const tile = body.data.find((g) => g.gameId === rememberedGame);
    expect(tile).toBeDefined();
    expect(tile?.theme).toBe('cohort');
    expect(tile?.whyReason).toBe('Decided together · Sep 13');
    // Same enrichment path as every other tile — not a thinner shape.
    expect(tile?.scoreBreakdown).toBeDefined();
    expect(tile?.slug).toBe('cg-remembered');
    expect(tile?.ownerCount).toBe(0);
    expect(tile?.itadTags).toEqual([]);
    expect(tile?.currentUserOwns).toBe(false);
    // And it leads the payload — the cohort row renders FIRST.
    expect(body.data[0].gameId).toBe(rememberedGame);
  });

  it('re-themes a remembered game that IS in the pool instead of duplicating it', async () => {
    await remember(
      priorLineup,
      currentLineup,
      poolGame,
      'match',
      new Date('2026-09-14T12:00:00.000Z'),
    );

    const body = await fetchCommonGround(currentLineup);

    const hits = body.data.filter((g) => g.gameId === poolGame);
    expect(hits).toHaveLength(1);
    expect(hits[0].theme).toBe('cohort');
    expect(hits[0].whyReason).toBe('Matched together · Sep 14');
    // The pool enrichment survives the re-theme.
    expect(hits[0].ownerCount).toBe(1);
    expect(body.meta.total).toBe(body.data.length);
  });

  it('uses the veto lead-in for a veto_won resolution', async () => {
    await testApp.db.delete(schema.communityLineupCohortMemory);
    await remember(
      priorLineup,
      currentLineup,
      rememberedGame,
      'veto_won',
      new Date('2026-01-05T12:00:00.000Z'),
    );

    const body = await fetchCommonGround(currentLineup);
    const tile = body.data.find((g) => g.gameId === rememberedGame);
    expect(tile?.whyReason).toBe('Won the veto · Jan 5');
  });

  it('excludes a remembered game that is already nominated', async () => {
    await testApp.db.insert(schema.communityLineupEntries).values({
      lineupId: currentLineup,
      gameId: rememberedGame,
      nominatedBy: adminId,
    });

    const body = await fetchCommonGround(currentLineup);

    expect(body.data.some((g) => g.gameId === rememberedGame)).toBe(false);
  });

  it('serves the row on a lineup with ZERO nominations and ZERO votes', async () => {
    // The ROK-1538 point: under the engaged-set signature `currentLineup` had
    // no cohort at all until somebody nominated, so the memory could never
    // show on the screen it exists for. The roster gives it one at creation.
    const entries = await testApp.db
      .select()
      .from(schema.communityLineupEntries);
    expect(entries).toHaveLength(0);

    const body = await fetchCommonGround(currentLineup);

    expect(body.data.some((g) => g.theme === 'cohort')).toBe(true);
  });

  it('never hands a lineup back its OWN remembered games', async () => {
    await remember(
      currentLineup,
      currentLineup,
      rememberedGame,
      'decided',
      new Date('2026-09-15T12:00:00.000Z'),
    );
    // Drop the prior lineup so the ONLY memory row left is self-sourced.
    await testApp.db
      .delete(schema.communityLineups)
      .where(eq(schema.communityLineups.id, priorLineup));

    const body = await fetchCommonGround(currentLineup);

    expect(body.data.some((g) => g.theme === 'cohort')).toBe(false);
  });
}

describe('Common Ground cohort row (integration)', describeCohortRow);
