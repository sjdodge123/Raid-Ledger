/**
 * ROK-1374 — the tie hold, end to end (spec "Lifecycle" scenarios 3 and 4).
 *
 * The operator's dead-end, verbatim: two voters, two games, one vote each.
 * Before this story the completed-but-tied vote claimed the grace window, the
 * grace job re-checked quorum (tie-blind → ready), attempted `voting →
 * decided`, hit `TIEBREAKER_REQUIRED`, swallowed it and nulled
 * `pending_advance_at`. The banner vanished and nothing replaced it.
 *
 * Now the same run ends with the lineup parked on a durable tie hold (D2/D3):
 * `tie_detected_at` set, both game ids recorded, the grace claim released,
 * status still `voting`, nothing decided.
 *
 * REGRESSION RECIPE (the Lead runs it on the fleet — this file needs the tie
 * columns, so it cannot run before the migration exists): revert D1 (the tie
 * branch in `quorum-check.helpers.ts`), D3 (`holdForTie` + `recordTieFromError`
 * in the phase processor) AND the submit-path claim in
 * `lineups-auto-advance.helpers.ts`; every case below must then fail on
 * `tieDetectedAt` with `Received: null` — never by timeout.
 *
 * Scenario 3 is driven twice: once with the grace job invoked by hand (so the
 * claim itself is asserted deterministically) and once through the REAL
 * BullMQ worker with a 300 ms window, exactly as
 * `lineup-auto-advance-grace.integration.spec.ts` AC-T1 does.
 */
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
  waitFor,
} from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import { SETTING_KEYS } from '../drizzle/schema/app-settings';
import { SettingsService } from '../settings/settings.service';
import { createMemberAndLogin } from '../events/signups.integration.spec-helpers';
import { LineupPhaseQueueService } from './queue/lineup-phase.queue';
import { LINEUP_PHASE_QUEUE } from './queue/lineup-phase.constants';
import { LineupPhaseProcessor } from './queue/lineup-phase.processor';
import { computeTieExpiresAt } from './tiebreaker/tie-hold.helpers';

type LineupRow = typeof schema.communityLineups.$inferSelect;
type Response = { status: number; body: unknown };

/** Long enough that the real job cannot fire before the hand-driven cases read the claim. */
const LONG_GRACE_MS = 300_000;
/** Short enough that the real-worker case completes quickly. */
const SHORT_GRACE_MS = 300;
/** Ceiling for the delayed BullMQ job on a loaded runner — a poll, never a sleep. */
const JOB_DEADLINE_MS = 15_000;

let testApp: TestApp;
let adminToken: string;
let settings: SettingsService;
let phaseQueue: LineupPhaseQueueService;
let rawQueue: Queue;

beforeAll(async () => {
  testApp = await getTestApp();
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
  settings = testApp.app.get(SettingsService);
  phaseQueue = testApp.app.get(LineupPhaseQueueService);
  rawQueue = testApp.app.get<Queue>(getQueueToken(LINEUP_PHASE_QUEUE));
});

afterEach(async () => {
  await settings.delete(SETTING_KEYS.LINEUP_AUTO_ADVANCE_GRACE_MS);
  testApp.seed = await truncateAllTables(testApp.db);
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
});

// ─── fixture helpers ────────────────────────────────────────────────────────

/** A fixture step that fails loudly names ITSELF — never a downstream timeout. */
function expectOk(res: Response, step: string): void {
  if (res.status >= 300) {
    throw new Error(
      `fixture step "${step}" failed: HTTP ${res.status} ${JSON.stringify(res.body)}`,
    );
  }
}

function createPrivateLineup(
  token: string,
  inviteeUserIds: number[],
  votesPerPlayer: number,
) {
  return testApp.request
    .post('/lineups')
    .set('Authorization', `Bearer ${token}`)
    .send({
      title: 'Tie Hold Test',
      visibility: 'private',
      inviteeUserIds,
      votesPerPlayer,
    });
}

async function createGames(count: number) {
  const games: (typeof schema.games.$inferSelect)[] = [];
  for (let i = 0; i < count; i++) {
    const [game] = await testApp.db
      .insert(schema.games)
      .values({
        name: `Tie Game ${i + 1}`,
        slug: `tie-game-${i + 1}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      })
      .returning();
    games.push(game);
  }
  return games;
}

function nominate(token: string, lineupId: number, gameId: number) {
  return testApp.request
    .post(`/lineups/${lineupId}/nominate`)
    .set('Authorization', `Bearer ${token}`)
    .send({ gameId });
}

function vote(token: string, lineupId: number, gameId: number) {
  return testApp.request
    .post(`/lineups/${lineupId}/vote`)
    .set('Authorization', `Bearer ${token}`)
    .send({ gameId });
}

function advanceToVoting(lineupId: number, token: string) {
  return testApp.request
    .patch(`/lineups/${lineupId}/status`)
    .set('Authorization', `Bearer ${token}`)
    .send({ status: 'voting' });
}

/** ROK-1296: the per-voter quorum gate closes on an explicit submit. */
async function submitVotes(lineupId: number, tokens: string[]): Promise<void> {
  for (const t of tokens) {
    const res = await testApp.request
      .post(`/lineups/${lineupId}/submit-votes`)
      .set('Authorization', `Bearer ${t}`)
      .send({});
    expectOk(res, 'submit votes');
  }
}

async function readLineup(lineupId: number): Promise<LineupRow> {
  const [row] = await testApp.db
    .select()
    .from(schema.communityLineups)
    .where(eq(schema.communityLineups.id, lineupId));
  if (!row) throw new Error(`lineup ${lineupId} vanished`);
  return row;
}

function getGraceJob(lineupId: number) {
  return rawQueue.getJob(`lineup-grace-${lineupId}`);
}

/** Cancel the queued job and run the grace branch by hand, as REWORK-4 does. */
async function driveGraceJobByHand(lineupId: number): Promise<void> {
  await phaseQueue.cancelGraceAdvance(lineupId);
  // The grace branch is private; the DI generic names the surface we drive.
  const processor = testApp.app.get<
    LineupPhaseProcessor,
    { processGraceAdvance(id: number): Promise<void> }
  >(LineupPhaseProcessor);
  await processor.processGraceAdvance(lineupId);
}

/**
 * The operator scenario, up to and including the last submit: a private
 * lineup with two voters, two nominated games, one vote each, all submitted.
 */
async function arrangeTiedVote(): Promise<{
  lineupId: number;
  gameIds: [number, number];
}> {
  const v1 = await createMemberAndLogin(testApp, 'tie-v1', 'tie-v1@test.local');
  const created = await createPrivateLineup(adminToken, [v1.userId], 1);
  expectOk(created, 'create lineup');
  const lineupId = (created.body as { id: number }).id;
  const [a, b] = await createGames(2);
  expectOk(await nominate(adminToken, lineupId, a.id), 'nominate game A');
  expectOk(await nominate(v1.token, lineupId, b.id), 'nominate game B');
  expectOk(await advanceToVoting(lineupId, adminToken), 'advance to voting');
  expectOk(await vote(adminToken, lineupId, a.id), 'admin votes A');
  expectOk(await vote(v1.token, lineupId, b.id), 'v1 votes B');
  await submitVotes(lineupId, [adminToken, v1.token]);
  return { lineupId, gameIds: [a.id, b.id] };
}

/** The four row facts of scenario 3, plus the "nothing decided" invariants. */
function expectTieHold(row: LineupRow, gameIds: [number, number]): void {
  expect(row.tieDetectedAt).not.toBeNull();
  expect([...(row.tieGameIds ?? [])].sort((x, y) => x - y)).toEqual(
    [...gameIds].sort((x, y) => x - y),
  );
  expect(row.tieVoteCount).toBe(1);
  expect(row.pendingAdvanceAt).toBeNull();
  expect(row.status).toBe('voting');
  // Q2: the hold records and never decides.
  expect(row.decidedGameId).toBeNull();
  expect(row.activeTiebreakerId).toBeNull();
  expect(row.tiePickAt).toBeNull();
  expect(row.tieExpiredAt).toBeNull();
  // D13: a full week past the intended end of voting, anchored at detection.
  expect(row.tieExpiresAt).toEqual(
    computeTieExpiresAt(row.phaseDeadline, row.tieDetectedAt as Date),
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Scenario 3 — the dead-end, hand-driven grace job
// ═══════════════════════════════════════════════════════════════════════════

describe('ROK-1374 tie hold — the operator dead-end (Lifecycle scenario 3)', () => {
  it('claims the grace window on a completed-but-tied vote, then parks the lineup on the hold', async () => {
    await settings.set(
      SETTING_KEYS.LINEUP_AUTO_ADVANCE_GRACE_MS,
      String(LONG_GRACE_MS),
    );
    const { lineupId, gameIds } = await arrangeTiedVote();

    // The tie claims the grace window exactly as a decidable quorum does —
    // the banner shows first (AC7) and nothing is announced before the
    // window elapses.
    const claimed = await readLineup(lineupId);
    expect(claimed.pendingAdvanceAt).not.toBeNull();
    expect(claimed.tieDetectedAt).toBeNull();
    expect(await getGraceJob(lineupId)).toBeTruthy();

    await driveGraceJobByHand(lineupId);

    expectTieHold(await readLineup(lineupId), gameIds);
  });

  it('reaches the same hold through the real BullMQ worker when the window elapses', async () => {
    await settings.set(
      SETTING_KEYS.LINEUP_AUTO_ADVANCE_GRACE_MS,
      String(SHORT_GRACE_MS),
    );
    const { lineupId, gameIds } = await arrangeTiedVote();

    await waitFor(
      async () => {
        expect((await readLineup(lineupId)).tieDetectedAt).not.toBeNull();
      },
      JOB_DEADLINE_MS,
      100,
    );

    expectTieHold(await readLineup(lineupId), gameIds);
    expect(await getGraceJob(lineupId)).toBeFalsy();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Scenario 4 — re-entry is idempotent on the announce edge
// ═══════════════════════════════════════════════════════════════════════════

describe('ROK-1374 tie hold — re-entry (Lifecycle scenario 4)', () => {
  it('re-running the grace job on an armed hold refreshes nothing it must not: detection and expiry stamps survive', async () => {
    await settings.set(
      SETTING_KEYS.LINEUP_AUTO_ADVANCE_GRACE_MS,
      String(LONG_GRACE_MS),
    );
    const { lineupId, gameIds } = await arrangeTiedVote();
    await driveGraceJobByHand(lineupId);
    const first = await readLineup(lineupId);
    expectTieHold(first, gameIds);

    // A BullMQ retry, a second job, or a later vote change re-arms the claim
    // and reaches `openTieHold` again (D4). Re-arm exactly as the submit
    // path would, then run the job again.
    await testApp.db
      .update(schema.communityLineups)
      .set({ pendingAdvanceAt: new Date(Date.now() + LONG_GRACE_MS) })
      .where(eq(schema.communityLineups.id, lineupId));
    await phaseQueue.scheduleGraceAdvance(lineupId, LONG_GRACE_MS);
    await driveGraceJobByHand(lineupId);

    const second = await readLineup(lineupId);
    expectTieHold(second, gameIds);
    expect(second.tieDetectedAt).toEqual(first.tieDetectedAt);
    expect(second.tieExpiresAt).toEqual(first.tieExpiresAt);
  });
});
