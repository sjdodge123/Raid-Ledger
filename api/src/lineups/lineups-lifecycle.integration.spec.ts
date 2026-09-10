/**
 * Conditional status UPDATE in applyStatusUpdate (ROK-1150 item 1).
 *
 * ROK-1118 made the status UPDATE conditional on the row's current status so
 * two auto-advance callers racing to close a quorum cannot both transition.
 * Until now that guard was only covered by a spec that mocks the throw
 * (`lineups-abort.helpers.spec.ts`), so nothing proved the `WHERE status = ?`
 * clause actually matches zero rows against a real database.
 *
 * The race is simulated deterministically rather than with two live
 * transactions: the "winner" commits its transition, and the "loser" then
 * calls with the snapshot it loaded before that write — which is exactly the
 * state a real loser holds, without the nondeterminism of parallel commits.
 */
import { ConflictException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import { applyStatusUpdate } from './lineups-lifecycle.helpers';
import { LineupPhaseQueueService } from './queue/lineup-phase.queue';

type LineupRow = typeof schema.communityLineups.$inferSelect;

describe('applyStatusUpdate — conditional UPDATE race guard (ROK-1150)', () => {
  let testApp: TestApp;
  let phaseQueue: LineupPhaseQueueService;
  let creatorId: number;

  beforeAll(async () => {
    testApp = await getTestApp();
    phaseQueue = testApp.app.get(LineupPhaseQueueService);
  });

  afterEach(async () => {
    testApp.seed = await truncateAllTables(testApp.db);
  });

  beforeEach(async () => {
    const [user] = await testApp.db
      .insert(schema.users)
      .values({
        discordId: `local:race-${Date.now()}@lifecycle.local`,
        username: 'race-creator',
        role: 'member',
      })
      .returning();
    creatorId = user.id;
  });

  async function seedLineup(status: 'building' | 'voting'): Promise<LineupRow> {
    const [lineup] = await testApp.db
      .insert(schema.communityLineups)
      .values({
        title: 'Race Guard Test',
        createdBy: creatorId,
        status,
        visibility: 'public',
        publicSlug: Math.random().toString(36).slice(2, 12),
      })
      .returning();
    return lineup;
  }

  async function readStatus(id: number): Promise<string> {
    const [row] = await testApp.db
      .select({ status: schema.communityLineups.status })
      .from(schema.communityLineups)
      .where(eq(schema.communityLineups.id, id));
    return row.status;
  }

  it('applies the transition when the caller snapshot is current', async () => {
    const lineup = await seedLineup('voting');

    await applyStatusUpdate(
      testApp.db,
      phaseQueue,
      lineup.id,
      { status: 'decided' },
      lineup,
    );

    expect(await readStatus(lineup.id)).toBe('decided');
  });

  it('throws ConflictException when another writer already transitioned', async () => {
    const lineup = await seedLineup('voting');

    // The winner commits first; `lineup` is now a pre-race snapshot.
    await testApp.db
      .update(schema.communityLineups)
      .set({ status: 'decided' })
      .where(eq(schema.communityLineups.id, lineup.id));

    await expect(
      applyStatusUpdate(
        testApp.db,
        phaseQueue,
        lineup.id,
        { status: 'decided' },
        lineup,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('names the status it expected so the 409 is diagnosable', async () => {
    const lineup = await seedLineup('voting');
    await testApp.db
      .update(schema.communityLineups)
      .set({ status: 'decided' })
      .where(eq(schema.communityLineups.id, lineup.id));

    let err: Error | null = null;
    try {
      await applyStatusUpdate(
        testApp.db,
        phaseQueue,
        lineup.id,
        { status: 'decided' },
        lineup,
      );
    } catch (e) {
      err = e as Error;
    }

    // instrument.ts drops these from Sentry by matching this exact phrasing,
    // so the message is load-bearing, not decoration.
    expect(err).toBeInstanceOf(ConflictException);
    expect(err?.message).toContain('status changed concurrently');
    expect(err?.message).toContain("expected 'voting'");
  });

  it('leaves the winner’s row untouched when the loser is rejected', async () => {
    const lineup = await seedLineup('voting');
    await testApp.db
      .update(schema.communityLineups)
      .set({ status: 'decided' })
      .where(eq(schema.communityLineups.id, lineup.id));

    await applyStatusUpdate(
      testApp.db,
      phaseQueue,
      lineup.id,
      { status: 'building' },
      lineup,
    ).catch(() => undefined);

    // The loser asked for 'building'. If the WHERE clause were dropped it
    // would have clobbered the winner's 'decided'.
    expect(await readStatus(lineup.id)).toBe('decided');
  });
});
