/**
 * `resetLineupsForTest` tiebreaker cleanup (ROK-1151 item 11).
 *
 * Archiving a lineup used to leave its tiebreaker at `pending`/`active`.
 * The FK on `community_lineup_tiebreakers` cascades on DELETE only, and this
 * helper never deletes — so a live tiebreaker outlived the lineup that owned
 * it and leaked into whichever smoke run came next.
 */
import { eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import { resetLineupsForTest } from './demo-test-lineup.helpers';

describe('resetLineupsForTest — tiebreaker cleanup (ROK-1151)', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await getTestApp();
  });

  afterEach(async () => {
    testApp.seed = await truncateAllTables(testApp.db);
  });

  /** Seed a lineup at `status` with one tiebreaker at `tbStatus`. */
  async function seedLineupWithTiebreaker(
    title: string,
    status: 'building' | 'voting',
    tbStatus: 'pending' | 'active' | 'resolved',
  ): Promise<{ lineupId: number; tiebreakerId: number }> {
    const [lineup] = await testApp.db
      .insert(schema.communityLineups)
      .values({
        title,
        status,
        createdBy: testApp.seed.adminUser.id,
        publicSlug: `tb-${Math.random().toString(36).slice(2, 10)}`,
      })
      .returning({ id: schema.communityLineups.id });
    const [tb] = await testApp.db
      .insert(schema.communityLineupTiebreakers)
      .values({
        lineupId: lineup.id,
        mode: 'bracket',
        status: tbStatus,
        tiedGameIds: [testApp.seed.game.id],
        originalVoteCount: 2,
      })
      .returning({ id: schema.communityLineupTiebreakers.id });
    return { lineupId: lineup.id, tiebreakerId: tb.id };
  }

  async function tiebreakerStatus(id: number): Promise<string> {
    const [row] = await testApp.db
      .select({ status: schema.communityLineupTiebreakers.status })
      .from(schema.communityLineupTiebreakers)
      .where(eq(schema.communityLineupTiebreakers.id, id));
    return row.status;
  }

  it('dismisses an active tiebreaker when its lineup is archived', async () => {
    const { lineupId, tiebreakerId } = await seedLineupWithTiebreaker(
      'smoke-prefix-active',
      'voting',
      'active',
    );

    const result = await resetLineupsForTest(testApp.db, 'smoke-prefix-');

    expect(result.archivedCount).toBe(1);
    expect(result.dismissedTiebreakerCount).toBe(1);
    expect(await tiebreakerStatus(tiebreakerId)).toBe('dismissed');

    const [lineup] = await testApp.db
      .select({ status: schema.communityLineups.status })
      .from(schema.communityLineups)
      .where(eq(schema.communityLineups.id, lineupId));
    expect(lineup.status).toBe('archived');
  });

  it('dismisses a pending tiebreaker too', async () => {
    const { tiebreakerId } = await seedLineupWithTiebreaker(
      'smoke-prefix-pending',
      'building',
      'pending',
    );

    const result = await resetLineupsForTest(testApp.db, 'smoke-prefix-');

    expect(result.dismissedTiebreakerCount).toBe(1);
    expect(await tiebreakerStatus(tiebreakerId)).toBe('dismissed');
  });

  it('leaves a resolved tiebreaker alone — it is history, not a live row', async () => {
    const { tiebreakerId } = await seedLineupWithTiebreaker(
      'smoke-prefix-resolved',
      'voting',
      'resolved',
    );

    const result = await resetLineupsForTest(testApp.db, 'smoke-prefix-');

    expect(result.archivedCount).toBe(1);
    expect(result.dismissedTiebreakerCount).toBe(0);
    expect(await tiebreakerStatus(tiebreakerId)).toBe('resolved');
  });

  it('does not touch tiebreakers of lineups outside the title prefix', async () => {
    const mine = await seedLineupWithTiebreaker(
      'smoke-prefix-mine',
      'voting',
      'active',
    );
    const theirs = await seedLineupWithTiebreaker(
      'other-worker-theirs',
      'voting',
      'active',
    );

    const result = await resetLineupsForTest(testApp.db, 'smoke-prefix-');

    expect(result.archivedCount).toBe(1);
    expect(result.dismissedTiebreakerCount).toBe(1);
    expect(await tiebreakerStatus(mine.tiebreakerId)).toBe('dismissed');
    // The sibling worker's live tiebreaker must survive.
    expect(await tiebreakerStatus(theirs.tiebreakerId)).toBe('active');
  });
});
