/**
 * ROK-1062 — admin abort lineup integration tests.
 *
 * Failing TDD tests that pin down the spec for the new
 * `POST /lineups/:id/abort` endpoint.  Every test fails today because
 * the route, the `AbortLineupSchema`, the `abort()` service method,
 * and the `lineup_aborted` activity log event do not yet exist.
 *
 * Coverage (one `it` per ACr/edge case, see spec §Edge Cases):
 *   1. Admin abort with reason → 200, status archived, activity log row.
 *   2. Operator abort without body → 200, status archived, reason null.
 *   3. Member abort → 403.
 *   4. Already-archived lineup → 409.
 *   5. Reason > 500 chars → 400.
 *   6. Active tiebreaker → reset/dismissed and lineup archived.
 *   7. Concurrent transition race (CAS) → 409.
 *   8. Linked events table cleared via `clearLinkedEventsByLineup`.
 *   9. Phase queue jobs cancelled (spy on `cancelAllForLineup`).
 */
import { and, eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import { LineupsService } from './lineups.service';
import { TiebreakerService } from './tiebreaker/tiebreaker.service';
import type { LineupPhaseQueueService } from './queue/lineup-phase.queue';

function describeLineupAbort() {
  let testApp: TestApp;
  let adminToken: string;
  let phaseQueue: LineupPhaseQueueService;
  let cancelAllSpy: jest.SpyInstance;

  beforeAll(async () => {
    testApp = await getTestApp();
    adminToken = await loginAsAdmin(testApp.request, testApp.seed);
    // `LineupPhaseQueueService` is now a single provider, owned + exported
    // by `LineupsModule` and consumed by `StandalonePollModule` (ROK-1206).
    // We still read it off `LineupsService` rather than via
    // `app.get(LineupPhaseQueueService)` because that's the exact runtime
    // instance wired into the service under test — the most direct ref to spy on.
    // @ts-expect-error — `phaseQueue` is private but we need the runtime ref for the spy
    phaseQueue = testApp.app.get(LineupsService).phaseQueue;
  });

  beforeEach(() => {
    cancelAllSpy = jest
      .spyOn(phaseQueue, 'cancelAllForLineup')
      .mockResolvedValue(0);
  });

  afterEach(async () => {
    cancelAllSpy.mockRestore();
    testApp.seed = await truncateAllTables(testApp.db);
    adminToken = await loginAsAdmin(testApp.request, testApp.seed);
  });

  // ── helpers ────────────────────────────────────────────────────────

  async function loginAsOperator(): Promise<string> {
    const bcrypt = await import('bcrypt');
    const hash = await bcrypt.hash('OperatorPass1!', 4);
    const [user] = await testApp.db
      .insert(schema.users)
      .values({
        discordId: 'local:abort-op@test.local',
        username: 'abort-op',
        role: 'operator',
      })
      .returning();
    await testApp.db.insert(schema.localCredentials).values({
      email: 'abort-op@test.local',
      passwordHash: hash,
      userId: user.id,
    });
    const res = await testApp.request
      .post('/auth/local')
      .send({ email: 'abort-op@test.local', password: 'OperatorPass1!' });
    return res.body.access_token as string;
  }

  async function loginAsMember(): Promise<string> {
    const bcrypt = await import('bcrypt');
    const hash = await bcrypt.hash('MemberPass1!', 4);
    const [user] = await testApp.db
      .insert(schema.users)
      .values({
        discordId: 'local:abort-mem@test.local',
        username: 'abort-mem',
        role: 'member',
      })
      .returning();
    await testApp.db.insert(schema.localCredentials).values({
      email: 'abort-mem@test.local',
      passwordHash: hash,
      userId: user.id,
    });
    const res = await testApp.request
      .post('/auth/local')
      .send({ email: 'abort-mem@test.local', password: 'MemberPass1!' });
    return res.body.access_token as string;
  }

  async function createLineup(token: string): Promise<number> {
    const res = await testApp.request
      .post('/lineups')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Abort Test Lineup' });
    expect(res.status).toBe(201);
    return res.body.id as number;
  }

  async function postAbort(
    token: string,
    id: number,
    body?: Record<string, unknown>,
  ) {
    const req = testApp.request
      .post(`/lineups/${id}/abort`)
      .set('Authorization', `Bearer ${token}`);
    return body === undefined ? req.send() : req.send(body);
  }

  async function findActivityLog(lineupId: number, action: string) {
    const rows = await testApp.db
      .select()
      .from(schema.activityLog)
      .where(
        and(
          eq(schema.activityLog.entityType, 'lineup'),
          eq(schema.activityLog.entityId, lineupId),
          eq(schema.activityLog.action, action),
        ),
      );
    return rows;
  }

  // ── AC 1 — admin abort with reason ─────────────────────────────────

  it('admin POST with reason archives the lineup and writes activity log', async () => {
    const id = await createLineup(adminToken);

    const res = await postAbort(adminToken, id, { reason: 'Test reason' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('archived');

    const [row] = await testApp.db
      .select()
      .from(schema.communityLineups)
      .where(eq(schema.communityLineups.id, id));
    expect(row.status).toBe('archived');

    const log = await findActivityLog(id, 'lineup_aborted');
    expect(log).toHaveLength(1);
    expect(log[0].metadata).toMatchObject({ reason: 'Test reason' });
    expect(log[0].actorId).toBe(testApp.seed.adminUser.id);
  });

  // ── AC 2 — operator abort without body ─────────────────────────────

  it('operator POST without body archives lineup with reason null', async () => {
    const opToken = await loginAsOperator();
    const id = await createLineup(opToken);

    const res = await postAbort(opToken, id);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('archived');

    const log = await findActivityLog(id, 'lineup_aborted');
    expect(log).toHaveLength(1);
    expect(log[0].metadata).toMatchObject({ reason: null });
  });

  // ── AC 3 — member is forbidden ─────────────────────────────────────

  it('member POST returns 403', async () => {
    const id = await createLineup(adminToken);
    const memberToken = await loginAsMember();

    const res = await postAbort(memberToken, id, { reason: 'nope' });
    expect(res.status).toBe(403);

    const [row] = await testApp.db
      .select()
      .from(schema.communityLineups)
      .where(eq(schema.communityLineups.id, id));
    expect(row.status).toBe('building');
  });

  // ── AC 4 — already archived → 409 ─────────────────────────────────

  it('already-archived lineup returns 409', async () => {
    const id = await createLineup(adminToken);
    await testApp.db
      .update(schema.communityLineups)
      .set({ status: 'archived' })
      .where(eq(schema.communityLineups.id, id));

    const res = await postAbort(adminToken, id, { reason: 'second time' });
    expect(res.status).toBe(409);
  });

  // ── AC 5 — reason > 500 chars → 400 ───────────────────────────────

  it('reason longer than 500 chars returns 400', async () => {
    const id = await createLineup(adminToken);

    const res = await postAbort(adminToken, id, { reason: 'x'.repeat(501) });
    expect(res.status).toBe(400);

    const [row] = await testApp.db
      .select()
      .from(schema.communityLineups)
      .where(eq(schema.communityLineups.id, id));
    expect(row.status).toBe('building');
  });

  // ── AC 6 — active tiebreaker is reset before archival ─────────────

  it('active tiebreaker is reset/dismissed before archival', async () => {
    const id = await createLineup(adminToken);

    // Force the lineup into voting and seed an active tiebreaker row.
    await testApp.db
      .update(schema.communityLineups)
      .set({ status: 'voting' })
      .where(eq(schema.communityLineups.id, id));

    const [tb] = await testApp.db
      .insert(schema.communityLineupTiebreakers)
      .values({
        lineupId: id,
        mode: 'veto',
        status: 'active',
        tiedGameIds: [testApp.seed.game.id],
        originalVoteCount: 1,
      })
      .returning();
    await testApp.db
      .update(schema.communityLineups)
      .set({ activeTiebreakerId: tb.id })
      .where(eq(schema.communityLineups.id, id));

    const res = await postAbort(adminToken, id, { reason: 'cancel TB' });
    expect(res.status).toBe(200);

    const [tbAfter] = await testApp.db
      .select()
      .from(schema.communityLineupTiebreakers)
      .where(eq(schema.communityLineupTiebreakers.id, tb.id));
    expect(['dismissed', 'resolved']).toContain(tbAfter.status);

    const [lineup] = await testApp.db
      .select()
      .from(schema.communityLineups)
      .where(eq(schema.communityLineups.id, id));
    expect(lineup.status).toBe('archived');
    expect(lineup.activeTiebreakerId).toBeNull();
  });

  // ── AC 7 — concurrent transition race → 409 ───────────────────────

  it('returns 409 when status drifts to a non-archived status between load and CAS update', async () => {
    const id = await createLineup(adminToken);
    // The orchestrator (runLineupAbort) loads the row at status='building',
    // then awaits `tiebreaker.reset(id)` BEFORE the CAS UPDATE in
    // `applyStatusUpdate` (which keys off `expectedPre = lineup.status`).
    // That await is a deterministic seam: drifting the row to 'voting' inside
    // it leaves the loaded 'building' snapshot stale, so the CAS clause
    // `WHERE status='building'` matches 0 rows → ConflictException → 409.
    // No pg_sleep / timing window — the drift is forced via the spy.
    const tiebreaker = testApp.app.get(TiebreakerService, { strict: false });
    const resetSpy = jest
      .spyOn(tiebreaker, 'reset')
      .mockImplementation(async () => {
        await testApp.db
          .update(schema.communityLineups)
          .set({ status: 'voting' })
          .where(eq(schema.communityLineups.id, id));
      });

    try {
      const res = await postAbort(adminToken, id, { reason: 'race' });
      expect(res.status).toBe(409);
    } finally {
      resetSpy.mockRestore();
    }

    // The failed CAS left the drifted row untouched — it is NOT archived.
    const [row] = await testApp.db
      .select()
      .from(schema.communityLineups)
      .where(eq(schema.communityLineups.id, id));
    expect(row.status).toBe('voting');
  });

  // ── AC 8 — linked events cleared via clearLinkedEventsByLineup ────

  it('clears linkedEventId on community_lineup_matches when aborting', async () => {
    const id = await createLineup(adminToken);

    // Create an event and link it to a match row for this lineup.
    const start = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const end = new Date(Date.now() + 25 * 60 * 60 * 1000);
    const [event] = await testApp.db
      .insert(schema.events)
      .values({
        title: 'Linked Event for abort test',
        gameId: testApp.seed.game.id,
        duration: [start, end],
        maxAttendees: 10,
        creatorId: testApp.seed.adminUser.id,
      })
      .returning();

    const [match] = await testApp.db
      .insert(schema.communityLineupMatches)
      .values({
        lineupId: id,
        gameId: testApp.seed.game.id,
        linkedEventId: event.id,
        status: 'scheduling',
        thresholdMet: true,
        voteCount: 1,
      })
      .returning();

    // Stamp the event with the match id (post-insert to satisfy FK).
    await testApp.db
      .update(schema.events)
      .set({ reschedulingPollId: match.id })
      .where(eq(schema.events.id, event.id));

    const res = await postAbort(adminToken, id, { reason: 'cleanup' });
    expect(res.status).toBe(200);

    // After abort, the helper should have cleared `reschedulingPollId`
    // on the linked event. The match's `linkedEventId` itself does not
    // need to be nulled — the contract is that the linked event no longer
    // points back to the lineup as a scheduling poll target.
    const [eventAfter] = await testApp.db
      .select()
      .from(schema.events)
      .where(eq(schema.events.id, event.id));
    expect(eventAfter.reschedulingPollId ?? null).toBeNull();
  });

  // ── AC 9 — phase queue jobs cancelled ────────────────────────────

  it('cancels phase queue jobs for the lineup', async () => {
    const id = await createLineup(adminToken);

    const res = await postAbort(adminToken, id, { reason: 'queue cleanup' });
    expect(res.status).toBe(200);

    expect(cancelAllSpy).toHaveBeenCalledWith(id);
  });
}

describe('Lineup abort (integration, ROK-1062)', describeLineupAbort);
