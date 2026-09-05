/**
 * ROK-1374 — expiry and escalation, end to end (spec scenarios 11 and 12).
 *
 * Both terminals of a stalled tie, and the two things neither may ever do:
 *
 *  - Scenario 11 (D13/AC18/E12): a hold whose week ran out is archived with
 *    `tie_expired_at` stamped and `decided_game_id` still NULL. Expiry is the
 *    single most tempting place to slip in a "sensible default winner", so the
 *    null is asserted on every pass, not just the first.
 *  - Scenario 12 (D14/AC17/E13): an `active` tiebreaker whose `round_deadline`
 *    has passed produces an escalation DM and changes NOTHING — `winner_game_id`
 *    stays null and the lineup stays where it was.
 *
 * CANNOT RUN YET: the `tie_*` columns land in migration `0169_lineup_tie_hold`,
 * which the Lead generates after the lanes merge. Run this file on the fleet
 * once that exists.
 *
 * REGRESSION RECIPE for the Lead (both cases must fail on their OWN assertion,
 * never by timeout):
 *  - Scenario 11: in `tie-expiry.helpers.ts::sweepExpiredTieHolds` delete the
 *    `expireTieHold` edge guard — "second sweep is a no-op" then fails with
 *    `expired` receiving `[id]` instead of `[]`. Or add `decidedGameId` to the
 *    archive payload — "decided_game_id is still NULL" fails naming the id.
 *  - Scenario 12: in `lineup-tiebreaker-reminder.helpers.ts::loadOverdueActiveTiebreakers`
 *    flip `round_deadline <=` back to `>` — "an escalation DM exists" then
 *    fails with a received length of 0.
 */
import { eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import { SETTING_KEYS } from '../drizzle/schema/app-settings';
import { SettingsService } from '../settings/settings.service';
import { createMemberAndLogin } from '../events/signups.integration.spec-helpers';
import { LineupPhaseQueueService } from './queue/lineup-phase.queue';
import { LineupPhaseProcessor } from './queue/lineup-phase.processor';
import { LineupReminderService } from './lineup-reminder.service';
import { TieExpiryService } from './tiebreaker/tie-expiry.service';

type LineupRow = typeof schema.communityLineups.$inferSelect;
type TiebreakerRow = typeof schema.communityLineupTiebreakers.$inferSelect;
type Response = { status: number; body: unknown };

/** Long enough that the queued grace job cannot fire mid-arrangement. */
const LONG_GRACE_MS = 300_000;
const DAY_MS = 24 * 60 * 60 * 1000;

let testApp: TestApp;
let adminToken: string;
let adminUserId: number;
let settings: SettingsService;
let phaseQueue: LineupPhaseQueueService;
let expiryService: TieExpiryService;
let reminderService: LineupReminderService;

beforeAll(async () => {
  testApp = await getTestApp();
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
  settings = testApp.app.get(SettingsService);
  phaseQueue = testApp.app.get(LineupPhaseQueueService);
  expiryService = testApp.app.get(TieExpiryService);
  reminderService = testApp.app.get(LineupReminderService);
});

afterEach(async () => {
  await settings.delete(SETTING_KEYS.LINEUP_AUTO_ADVANCE_GRACE_MS);
  testApp.seed = await truncateAllTables(testApp.db);
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
});

// ─── fixture helpers (copied from lineup-tie-hold.integration.spec.ts) ───────

/** A fixture step that fails loudly names ITSELF — never a downstream timeout. */
function expectOk(res: Response, step: string): void {
  if (res.status >= 300) {
    throw new Error(
      `fixture step "${step}" failed: HTTP ${res.status} ${JSON.stringify(res.body)}`,
    );
  }
}

function createPrivateLineup(token: string, inviteeUserIds: number[]) {
  return testApp.request
    .post('/lineups')
    .set('Authorization', `Bearer ${token}`)
    .send({
      title: 'Tie Expiry Test',
      visibility: 'private',
      inviteeUserIds,
      votesPerPlayer: 1,
    });
}

async function createGames(count: number) {
  const games: (typeof schema.games.$inferSelect)[] = [];
  for (let i = 0; i < count; i++) {
    const [game] = await testApp.db
      .insert(schema.games)
      .values({
        name: `Expiry Game ${i + 1}`,
        slug: `expiry-game-${i + 1}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
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

/** Cancel the queued job and run the grace branch by hand, as REWORK-4 does. */
async function driveGraceJobByHand(lineupId: number): Promise<void> {
  await phaseQueue.cancelGraceAdvance(lineupId);
  const processor = testApp.app.get<
    LineupPhaseProcessor,
    { processGraceAdvance(id: number): Promise<void> }
  >(LineupPhaseProcessor);
  await processor.processGraceAdvance(lineupId);
}

/** The operator scenario: two voters, two games, one vote each, all submitted. */
async function arrangeTiedVote(): Promise<{ lineupId: number }> {
  await settings.set(
    SETTING_KEYS.LINEUP_AUTO_ADVANCE_GRACE_MS,
    String(LONG_GRACE_MS),
  );
  const v1 = await createMemberAndLogin(testApp, 'exp-v1', 'exp-v1@test.local');
  const created = await createPrivateLineup(adminToken, [v1.userId]);
  expectOk(created, 'create lineup');
  const lineupId = (created.body as { id: number }).id;
  const [a, b] = await createGames(2);
  expectOk(await nominate(adminToken, lineupId, a.id), 'nominate game A');
  expectOk(await nominate(v1.token, lineupId, b.id), 'nominate game B');
  expectOk(await advanceToVoting(lineupId, adminToken), 'advance to voting');
  expectOk(await vote(adminToken, lineupId, a.id), 'admin votes A');
  expectOk(await vote(v1.token, lineupId, b.id), 'v1 votes B');
  await submitVotes(lineupId, [adminToken, v1.token]);
  await driveGraceJobByHand(lineupId);
  const row = await readLineup(lineupId);
  if (row.tieDetectedAt === null) {
    throw new Error(
      'fixture step "open tie hold" failed: tieDetectedAt is null',
    );
  }
  // The creator IS the admin here; read it off the row rather than a route.
  adminUserId = row.createdBy;
  return { lineupId };
}

/** Backdate the hold so the sweep sees it as expired without waiting a week. */
async function backdateTieExpiry(lineupId: number): Promise<void> {
  await testApp.db
    .update(schema.communityLineups)
    .set({ tieExpiresAt: new Date(Date.now() - DAY_MS) })
    .where(eq(schema.communityLineups.id, lineupId));
}

async function readEscalationDms(userId: number): Promise<unknown[]> {
  const rows = await testApp.db
    .select()
    .from(schema.notifications)
    .where(eq(schema.notifications.userId, userId));
  return rows.filter(
    (r) =>
      (r.payload as { subtype?: string } | null)?.subtype ===
      'lineup_tiebreaker_escalation',
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Scenario 11 — the hold's week runs out
// ═══════════════════════════════════════════════════════════════════════════

describe('scenario 11 — expiry archives undecided (D13 / AC18 / E12)', () => {
  it('archives the lineup, stamps tie_expired_at and decides nothing', async () => {
    const { lineupId } = await arrangeTiedVote();
    await backdateTieExpiry(lineupId);

    const { expired } = await expiryService.sweep();

    expect(expired).toContain(lineupId);
    const row = await readLineup(lineupId);
    expect(row.status).toBe('archived');
    expect(row.tieExpiredAt).not.toBeNull();
    // Q2: expiry never picks a winner, not even as a fallback.
    expect(row.decidedGameId).toBeNull();
    expect(row.tiePickGameId).toBeNull();
  });

  it('is a no-op on the second sweep — the row is not archived twice', async () => {
    const { lineupId } = await arrangeTiedVote();
    await backdateTieExpiry(lineupId);
    const first = await expiryService.sweep();
    expect(first.expired).toContain(lineupId);
    const afterFirst = await readLineup(lineupId);

    const second = await expiryService.sweep();

    expect(second.expired).toEqual([]);
    const afterSecond = await readLineup(lineupId);
    expect(afterSecond.tieExpiredAt).toEqual(afterFirst.tieExpiredAt);
    expect(afterSecond.decidedGameId).toBeNull();
  });

  it('leaves a hold whose week has NOT run out entirely alone', async () => {
    const { lineupId } = await arrangeTiedVote();

    const { expired } = await expiryService.sweep();

    expect(expired).not.toContain(lineupId);
    const row = await readLineup(lineupId);
    expect(row.status).toBe('voting');
    expect(row.tieExpiredAt).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Scenario 12 — a started tiebreaker's round deadline passes
// ═══════════════════════════════════════════════════════════════════════════

describe('scenario 12 — a passed round_deadline escalates (D14 / AC17 / E13)', () => {
  async function arrangeOverdueTiebreaker(): Promise<{
    lineupId: number;
    tiebreakerId: number;
  }> {
    const { lineupId } = await arrangeTiedVote();
    const started = await testApp.request
      .post(`/lineups/${lineupId}/tiebreaker`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ mode: 'veto', roundDurationHours: 24 });
    expectOk(started, 'start tiebreaker');
    const [tb] = await testApp.db
      .update(schema.communityLineupTiebreakers)
      .set({ roundDeadline: new Date(Date.now() - DAY_MS) })
      .where(eq(schema.communityLineupTiebreakers.lineupId, lineupId))
      .returning();
    if (!tb)
      throw new Error('fixture step "backdate round deadline" found no row');
    return { lineupId, tiebreakerId: tb.id };
  }

  it('DMs the creator and resolves nothing', async () => {
    const { lineupId, tiebreakerId } = await arrangeOverdueTiebreaker();

    await reminderService.checkTiebreakerReminders();

    expect(await readEscalationDms(adminUserId)).toHaveLength(1);
    const [tb] = (await testApp.db
      .select()
      .from(schema.communityLineupTiebreakers)
      .where(
        eq(schema.communityLineupTiebreakers.id, tiebreakerId),
      )) as TiebreakerRow[];
    // Q3: escalation notifies, louder. It never decides.
    expect(tb.winnerGameId).toBeNull();
    expect(tb.status).toBe('active');
    const row = await readLineup(lineupId);
    expect(row.status).toBe('voting');
    expect(row.decidedGameId).toBeNull();
  });

  it('sends nothing on a second run — one escalation per tiebreaker', async () => {
    await arrangeOverdueTiebreaker();
    await reminderService.checkTiebreakerReminders();

    await reminderService.checkTiebreakerReminders();

    expect(await readEscalationDms(adminUserId)).toHaveLength(1);
  });
});
