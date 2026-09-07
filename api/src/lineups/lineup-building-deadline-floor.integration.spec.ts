/**
 * ROK-1443 (T3) — the building-deadline nomination floor, end to end.
 *
 * Bug: the deadline job advanced `building → voting` on status adjacency
 * alone, so a lineup nobody nominated on opened a vote with nothing to vote
 * on and DMed everyone that voting was open. Operator ruling: fewer than two
 * nominations at the building deadline → extend once, then abort. The
 * activity log is the extension memory, so a `voting → building` revert
 * neither resets nor double-counts it. The manual Advance stays an override.
 *
 * Harness mirrors `lineup-deadline-transition-notify.integration.spec.ts`:
 * the deadline path is driven by handing the processor a synthetic
 * `phase-transition` job.
 */
import { and, eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import { LineupPhaseProcessor } from './queue/lineup-phase.processor';
import { LINEUP_PHASE_TRANSITION } from './queue/lineup-phase.constants';
import { LineupPhaseQueueService } from './queue/lineup-phase.queue';
import { LineupsGateway } from './lineups.gateway';
import { LineupNotificationService } from './lineup-notification.service';
import { NOBODY_NOMINATED_REASON } from './lineup-building-deadline.helpers';

const EXTENDED = 'lineup_deadline_extended';

interface Member {
  token: string;
  userId: number;
}

function describeBuildingDeadlineFloor() {
  let testApp: TestApp;
  let adminToken: string;
  let processor: LineupPhaseProcessor;
  let phaseQueue: LineupPhaseQueueService;
  let notifyVotingOpen: jest.SpyInstance;
  let scheduleTransition: jest.SpyInstance;

  beforeAll(async () => {
    testApp = await getTestApp();
    adminToken = await loginAsAdmin(testApp.request, testApp.seed);
    processor = testApp.app.get(LineupPhaseProcessor);
    // `LineupPhaseQueueService` is provided by two modules; spy on the
    // instance the processor actually injected.
    phaseQueue = (
      processor as unknown as { queueService: LineupPhaseQueueService }
    ).queueService;
  });

  beforeEach(() => {
    const notifications = testApp.app.get(LineupNotificationService);
    notifyVotingOpen = jest
      .spyOn(notifications, 'notifyVotingOpen')
      .mockResolvedValue(undefined);
    jest
      .spyOn(testApp.app.get(LineupsGateway), 'emitStatusChange')
      .mockImplementation(() => undefined);
    scheduleTransition = jest.spyOn(phaseQueue, 'scheduleTransition');
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    testApp.seed = await truncateAllTables(testApp.db);
    adminToken = await loginAsAdmin(testApp.request, testApp.seed);
  });

  // ── helpers ────────────────────────────────────────────────────

  async function createMember(tag: string): Promise<Member> {
    const bcrypt = await import('bcrypt');
    const hash = await bcrypt.hash('Floor1!!', 4);
    const [user] = await testApp.db
      .insert(schema.users)
      .values({
        discordId: `local:${tag}@floor.local`,
        username: tag,
        role: 'member',
      })
      .returning();
    const email = `${tag}@floor.local`.toLowerCase();
    await testApp.db.insert(schema.localCredentials).values({
      email,
      passwordHash: hash,
      userId: user.id,
    });
    const res = await testApp.request
      .post('/auth/local')
      .send({ email, password: 'Floor1!!' });
    return { token: res.body.access_token as string, userId: user.id };
  }

  async function createGame(tag: string) {
    const [game] = await testApp.db
      .insert(schema.games)
      .values({
        name: `Floor Game ${tag}`,
        slug: `floor-game-${tag}-${Date.now()}-${Math.random()
          .toString(36)
          .slice(2, 7)}`,
      })
      .returning();
    return game;
  }

  async function nominate(token: string, lineupId: number, gameId: number) {
    const res = await testApp.request
      .post(`/lineups/${lineupId}/nominate`)
      .set('Authorization', `Bearer ${token}`)
      .send({ gameId });
    expect(res.status).toBe(201);
  }

  async function removeNomination(
    token: string,
    lineupId: number,
    gameId: number,
  ) {
    const res = await testApp.request
      .delete(`/lineups/${lineupId}/nominations/${gameId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(204);
  }

  async function patchStatus(lineupId: number, status: 'voting' | 'building') {
    return testApp.request
      .patch(`/lineups/${lineupId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status });
  }

  /**
   * A private building lineup with three invited members and `count`
   * nominations, one per nominator (admin first, then members).
   */
  async function seedBuildingLineup(tag: string, count: number) {
    const members = [
      await createMember(`${tag}-m1`),
      await createMember(`${tag}-m2`),
      await createMember(`${tag}-m3`),
    ];
    const createRes = await testApp.request
      .post('/lineups')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        title: `Floor ${tag}`,
        visibility: 'private',
        inviteeUserIds: members.map((m) => m.userId),
        votesPerPlayer: 1,
      });
    expect(createRes.status).toBe(201);
    const lineupId = createRes.body.id as number;
    const nominators = [adminToken, ...members.map((m) => m.token)];
    const games: (typeof schema.games.$inferSelect)[] = [];
    for (let i = 0; i < count; i++) {
      const game = await createGame(`${tag}-${i}`);
      await nominate(nominators[i], lineupId, game.id);
      games.push(game);
    }
    expect((await readLineup(lineupId)).status).toBe('building');
    return { lineupId, members, games };
  }

  async function readLineup(lineupId: number) {
    const [row] = await testApp.db
      .select()
      .from(schema.communityLineups)
      .where(eq(schema.communityLineups.id, lineupId));
    return row;
  }

  /** Put the current phase deadline one minute into the past. */
  async function expireDeadline(lineupId: number): Promise<Date> {
    const past = new Date(Date.now() - 60_000);
    await testApp.db
      .update(schema.communityLineups)
      .set({ phaseDeadline: past })
      .where(eq(schema.communityLineups.id, lineupId));
    return past;
  }

  async function fireVotingDeadline(lineupId: number): Promise<void> {
    await processor.process({
      name: LINEUP_PHASE_TRANSITION,
      data: { lineupId, targetStatus: 'voting' },
    } as never);
  }

  async function activityRows(lineupId: number, action: string) {
    return testApp.db
      .select()
      .from(schema.activityLog)
      .where(
        and(
          eq(schema.activityLog.entityType, 'lineup'),
          eq(schema.activityLog.entityId, lineupId),
          eq(schema.activityLog.action, action),
        ),
      );
  }

  function votingSchedules(lineupId: number) {
    return scheduleTransition.mock.calls.filter(
      (c) => c[0] === lineupId && c[1] === 'voting',
    );
  }

  // ── A + D: zero nominations — extend once, then abort ──────────

  it('A/D: zero nominations at the deadline extends once, and the second expiry aborts', async () => {
    const { lineupId } = await seedBuildingLineup('ad', 0);
    const before = await expireDeadline(lineupId);

    await fireVotingDeadline(lineupId);

    // A — extended, not advanced.
    const afterFirst = await readLineup(lineupId);
    expect(afterFirst.status).toBe('building');
    expect(afterFirst.phaseDeadline?.getTime()).toBeGreaterThan(
      before.getTime(),
    );
    const extensions = await activityRows(lineupId, EXTENDED);
    expect(extensions).toHaveLength(1);
    expect(extensions[0].actorId).toBeNull();
    expect(extensions[0].metadata).toEqual(
      expect.objectContaining({ nominationCount: 0 }),
    );
    expect(votingSchedules(lineupId)).toHaveLength(1);
    expect(votingSchedules(lineupId)[0][2]).toBeGreaterThan(0);
    expect(notifyVotingOpen).not.toHaveBeenCalled();
    expect(await activityRows(lineupId, 'voting_started')).toHaveLength(0);

    // D — still nobody; the second expiry closes the lineup.
    await expireDeadline(lineupId);
    await fireVotingDeadline(lineupId);

    const afterSecond = await readLineup(lineupId);
    expect(afterSecond.status).toBe('archived');
    expect(afterSecond.phaseDeadline).toBeNull();
    const aborted = await activityRows(lineupId, 'lineup_aborted');
    expect(aborted).toHaveLength(1);
    expect(aborted[0].actorId).toBeNull();
    expect(aborted[0].metadata).toEqual({ reason: NOBODY_NOMINATED_REASON });
    expect(await activityRows(lineupId, EXTENDED)).toHaveLength(1);
    expect(notifyVotingOpen).not.toHaveBeenCalled();
    expect(await activityRows(lineupId, 'voting_started')).toHaveLength(0);
  });

  // ── B: one nomination is still below the floor ─────────────────

  it('B: one nomination at the deadline extends instead of advancing', async () => {
    const { lineupId } = await seedBuildingLineup('b', 1);
    const before = await expireDeadline(lineupId);

    await fireVotingDeadline(lineupId);

    const row = await readLineup(lineupId);
    expect(row.status).toBe('building');
    expect(row.phaseDeadline?.getTime()).toBeGreaterThan(before.getTime());
    const extensions = await activityRows(lineupId, EXTENDED);
    expect(extensions).toHaveLength(1);
    expect(extensions[0].metadata).toEqual(
      expect.objectContaining({ nominationCount: 1 }),
    );
    expect(votingSchedules(lineupId)).toHaveLength(1);
    expect(notifyVotingOpen).not.toHaveBeenCalled();
  });

  // ── C: two nominations — the normal path is untouched ──────────

  it('C: two nominations at the deadline advance to voting as before', async () => {
    const { lineupId } = await seedBuildingLineup('c', 2);
    await expireDeadline(lineupId);

    await fireVotingDeadline(lineupId);

    expect((await readLineup(lineupId)).status).toBe('voting');
    expect(notifyVotingOpen).toHaveBeenCalledTimes(1);
    expect(await activityRows(lineupId, 'voting_started')).toHaveLength(1);
    expect(await activityRows(lineupId, EXTENDED)).toHaveLength(0);
  });

  // ── E: the manual operator Advance is a deliberate override ────

  it('E: PATCH /lineups/:id/status → voting with zero nominations still advances (AC6)', async () => {
    const { lineupId } = await seedBuildingLineup('e', 0);

    const res = await patchStatus(lineupId, 'voting');

    expect(res.status).toBe(200);
    expect((await readLineup(lineupId)).status).toBe('voting');
    expect(await activityRows(lineupId, EXTENDED)).toHaveLength(0);
  });

  // ── F: a revert neither resets nor double-counts the extension ─

  it('F: extend → advance → revert → nominations gone → next expiry aborts, one extension row throughout (AC7)', async () => {
    const { lineupId, members } = await seedBuildingLineup('f', 0);
    await expireDeadline(lineupId);
    await fireVotingDeadline(lineupId);
    expect((await readLineup(lineupId)).status).toBe('building');
    expect(await activityRows(lineupId, EXTENDED)).toHaveLength(1);

    // Two nominations arrive; the (extended) deadline advances normally.
    const g1 = await createGame('f-1');
    const g2 = await createGame('f-2');
    await nominate(adminToken, lineupId, g1.id);
    await nominate(members[0].token, lineupId, g2.id);
    await expireDeadline(lineupId);
    await fireVotingDeadline(lineupId);
    expect((await readLineup(lineupId)).status).toBe('voting');

    // Operator reverts; nominators pull their games back out.
    expect((await patchStatus(lineupId, 'building')).status).toBe(200);
    await removeNomination(adminToken, lineupId, g1.id);
    await removeNomination(members[0].token, lineupId, g2.id);
    await expireDeadline(lineupId);

    await fireVotingDeadline(lineupId);

    expect((await readLineup(lineupId)).status).toBe('archived');
    expect(await activityRows(lineupId, EXTENDED)).toHaveLength(1);
    expect(await activityRows(lineupId, 'lineup_aborted')).toHaveLength(1);
  });

  // ── G: a revert with plenty of nominations advances normally ───

  it('G: reverted voting → building with three nominations advances at the next deadline, no extension row', async () => {
    const { lineupId } = await seedBuildingLineup('g', 3);
    await expireDeadline(lineupId);
    await fireVotingDeadline(lineupId);
    expect((await readLineup(lineupId)).status).toBe('voting');
    expect(notifyVotingOpen).toHaveBeenCalledTimes(1);

    expect((await patchStatus(lineupId, 'building')).status).toBe(200);
    await expireDeadline(lineupId);

    await fireVotingDeadline(lineupId);

    expect((await readLineup(lineupId)).status).toBe('voting');
    expect(notifyVotingOpen).toHaveBeenCalledTimes(2);
    expect(await activityRows(lineupId, EXTENDED)).toHaveLength(0);
  });
}

describe(
  'Lineup building-deadline nomination floor (ROK-1443, integration)',
  describeBuildingDeadlineFloor,
);
