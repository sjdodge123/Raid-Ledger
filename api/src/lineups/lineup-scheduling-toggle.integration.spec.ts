/**
 * ROK-1302 — Scheduling-phase toggle integration tests.
 *
 * Verifies `includeSchedulingPhase` gates EVERY path that could promote a match
 * into the scheduling lifecycle:
 *  - the decided-transition matching algorithm (no 'scheduling' match, no slots)
 *  - the bandwagon late-join auto-promotion path
 *  - the operator match-advance path
 *  - the scheduling poll page (404 when disabled)
 * Plus: the field persists + is exposed, default-on preserves existing
 * behavior, and sub-hour phase durations round-trip.
 */
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../common/testing/integration-helpers';
import { eq } from 'drizzle-orm';
import * as schema from '../drizzle/schema';

function describeSchedulingToggle() {
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

  async function loginAsMember(
    tag = 'member',
  ): Promise<{ token: string; userId: number }> {
    const bcrypt = await import('bcrypt');
    const hash = await bcrypt.hash('MemberPass1!', 4);
    const [user] = await testApp.db
      .insert(schema.users)
      .values({
        discordId: `local:${tag}@test.local`,
        username: tag,
        role: 'member',
      })
      .returning();
    const email = `${tag}@test.local`.toLowerCase();
    await testApp.db.insert(schema.localCredentials).values({
      email,
      passwordHash: hash,
      userId: user.id,
    });
    const res = await testApp.request
      .post('/auth/local')
      .send({ email, password: 'MemberPass1!' });
    return { token: res.body.access_token as string, userId: user.id };
  }

  async function createLineup(extra: Record<string, unknown> = {}) {
    return testApp.request
      .post('/lineups')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ title: 'Scheduling Toggle Test', ...extra });
  }

  async function createGame(tag: string) {
    const [game] = await testApp.db
      .insert(schema.games)
      .values({ name: `Game ${tag}`, slug: `game-${tag}-${Date.now()}` })
      .returning();
    return game;
  }

  async function setStatus(lineupId: number, status: string) {
    return testApp.request
      .patch(`/lineups/${lineupId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status });
  }

  /**
   * Build a decided lineup where one game cleared the (default 35%) threshold:
   * a single voter votes for game A, so A = 100% of voters.
   */
  async function buildDecidedLineup(extra: Record<string, unknown> = {}) {
    const createRes = await createLineup(extra);
    const lineupId = createRes.body.id as number;
    const gameA = await createGame('a');
    const gameB = await createGame('b');
    for (const g of [gameA, gameB]) {
      await testApp.db.insert(schema.communityLineupEntries).values({
        lineupId,
        gameId: g.id,
        nominatedBy: testApp.seed.adminUser.id,
      });
    }
    await setStatus(lineupId, 'voting');
    const voter = await loginAsMember('voter1');
    await testApp.request
      .post(`/lineups/${lineupId}/vote`)
      .set('Authorization', `Bearer ${voter.token}`)
      .send({ gameId: gameA.id });
    await setStatus(lineupId, 'decided');
    return { lineupId, gameA, gameB };
  }

  function matchesFor(lineupId: number) {
    return testApp.db
      .select()
      .from(schema.communityLineupMatches)
      .where(eq(schema.communityLineupMatches.lineupId, lineupId));
  }

  // -- Persistence + exposure ------------------------------------------------

  it('persists include_scheduling_phase=false and exposes it on detail', async () => {
    const createRes = await createLineup({ includeSchedulingPhase: false });
    const lineupId = createRes.body.id as number;
    const detail = await testApp.request
      .get(`/lineups/${lineupId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(detail.status).toBe(200);
    expect(detail.body.includeSchedulingPhase).toBe(false);
  });

  it('defaults includeSchedulingPhase to true when omitted', async () => {
    const createRes = await createLineup();
    const lineupId = createRes.body.id as number;
    const detail = await testApp.request
      .get(`/lineups/${lineupId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(detail.body.includeSchedulingPhase).toBe(true);
  });

  // -- Decided transition gate ----------------------------------------------

  it('does NOT promote any match to scheduling when disabled', async () => {
    const { lineupId, gameA } = await buildDecidedLineup({
      includeSchedulingPhase: false,
    });
    const matches = await matchesFor(lineupId);
    const a = matches.find((m) => m.gameId === gameA.id);
    expect(a).toBeDefined();
    expect(a!.status).toBe('suggested');
    // thresholdMet is still tracked even though status stayed suggested.
    expect(a!.thresholdMet).toBe(true);
    expect(matches.some((m) => m.status === 'scheduling')).toBe(false);
  });

  it('creates no schedule slots when disabled', async () => {
    const { lineupId } = await buildDecidedLineup({
      includeSchedulingPhase: false,
    });
    const matches = await matchesFor(lineupId);
    const slots = await testApp.db
      .select()
      .from(schema.communityLineupScheduleSlots);
    const matchIds = new Set(matches.map((m) => m.id));
    expect(slots.filter((s) => matchIds.has(s.matchId))).toHaveLength(0);
  });

  it('DOES promote a threshold-met match to scheduling by default', async () => {
    const { lineupId, gameA } = await buildDecidedLineup();
    const matches = await matchesFor(lineupId);
    const a = matches.find((m) => m.gameId === gameA.id);
    expect(a!.status).toBe('scheduling');
  });

  // -- Bandwagon late-join gate (architect's three-path finding) -------------

  it('bandwagon late-join does NOT auto-promote when disabled', async () => {
    const { lineupId, gameA } = await buildDecidedLineup({
      includeSchedulingPhase: false,
    });
    const [match] = (await matchesFor(lineupId)).filter(
      (m) => m.gameId === gameA.id,
    );
    const latecomer = await loginAsMember('latecomer');
    const res = await testApp.request
      .post(`/lineups/${lineupId}/matches/${match.id}/join`)
      .set('Authorization', `Bearer ${latecomer.token}`)
      .send();
    expect(res.status).toBeLessThan(400);
    expect(res.body.promoted).toBe(false);
    const [after] = (await matchesFor(lineupId)).filter(
      (m) => m.id === match.id,
    );
    expect(after.status).toBe('suggested');
  });

  it('operator match-advance is refused when disabled', async () => {
    const { lineupId, gameA } = await buildDecidedLineup({
      includeSchedulingPhase: false,
    });
    const [match] = (await matchesFor(lineupId)).filter(
      (m) => m.gameId === gameA.id,
    );
    const res = await testApp.request
      .post(`/lineups/${lineupId}/matches/${match.id}/advance`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send();
    expect(res.status).toBe(400);
    const [after] = (await matchesFor(lineupId)).filter(
      (m) => m.id === match.id,
    );
    expect(after.status).toBe('suggested');
  });

  it('the scheduling poll page 404s when disabled', async () => {
    const { lineupId, gameA } = await buildDecidedLineup({
      includeSchedulingPhase: false,
    });
    const [match] = (await matchesFor(lineupId)).filter(
      (m) => m.gameId === gameA.id,
    );
    const res = await testApp.request
      .get(`/lineups/${lineupId}/schedule/${match.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(404);
  });

  // -- Sub-hour duration round-trip -----------------------------------------

  it('persists a sub-hour building duration (Tonight = 0.25h)', async () => {
    const before = Date.now();
    const createRes = await createLineup({ buildingDurationHours: 0.25 });
    expect(createRes.status).toBe(201);
    const lineupId = createRes.body.id as number;
    const detail = await testApp.request
      .get(`/lineups/${lineupId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    const deadline = new Date(detail.body.phaseDeadline).getTime();
    const elapsed = deadline - before;
    // ~15 min out: tolerate test latency but reject 0 (rounded down) and 1h+.
    expect(elapsed).toBeGreaterThan(10 * 60 * 1000);
    expect(elapsed).toBeLessThan(20 * 60 * 1000);
  });
}

describe('Lineup scheduling-phase toggle (ROK-1302)', describeSchedulingToggle);
