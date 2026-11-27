/**
 * ROK-1710 — edit `nominationTargetPct` after creation, plus the re-arm rule.
 *
 * `PATCH /lineups/:id/metadata` now accepts `nominationTargetPct`. An explicit
 * edit is the operator re-arming on purpose: it clears the sticky disarm that a
 * `voting -> building` revert stamped AND the rising-edge arm, then re-runs the
 * create-time arm check. So:
 *   - below the new target  -> armed, advances on the next crossing;
 *   - at/above the target   -> unarmed standing condition, never fires;
 *   - the ROK-1253 revert pause still holds while it lasts;
 *   - outside `building`    -> 409.
 *
 * Grace is pinned to 0 so advancement is synchronous (no BullMQ polling).
 * Two nominators keep the cap at `max(20, 2 * 5)` = 20.
 */
import { eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import { SettingsService } from '../settings/settings.service';
import { SETTING_KEYS } from '../drizzle/schema/app-settings';
import { nonEmpty } from '../common/testing/narrow';
import { LineupPhaseProcessor } from './queue/lineup-phase.processor';
import { LINEUP_GRACE_ADVANCE } from './queue/lineup-phase.constants';
import { runStatusTransition } from './lineups-transition.helpers';
import { advanceGuardFrom } from './lineups-advance-guard.helpers';
import { evaluateNominationTarget } from './quorum/nomination-target.helpers';

type Game = typeof schema.games.$inferSelect;
type Lineup = typeof schema.communityLineups.$inferSelect;

function describeNominationTargetEdit() {
  let testApp: TestApp;
  let adminToken: string;
  let settings: SettingsService;

  beforeAll(async () => {
    testApp = await getTestApp();
    adminToken = await loginAsAdmin(testApp.request, testApp.seed);
    settings = testApp.app.get(SettingsService);
    await settings.set(SETTING_KEYS.LINEUP_AUTO_ADVANCE_GRACE_MS, '0');
  });

  afterAll(async () => {
    await settings.delete(SETTING_KEYS.LINEUP_AUTO_ADVANCE_GRACE_MS);
    await settings.delete(SETTING_KEYS.LINEUP_AUTO_ADVANCE_PAUSE_TTL_MS);
  });

  afterEach(async () => {
    testApp.seed = await truncateAllTables(testApp.db);
    adminToken = await loginAsAdmin(testApp.request, testApp.seed);
    await settings.set(SETTING_KEYS.LINEUP_AUTO_ADVANCE_GRACE_MS, '0');
    await settings.delete(SETTING_KEYS.LINEUP_AUTO_ADVANCE_PAUSE_TTL_MS);
  });

  // -- Helpers ---------------------------------------------------------------

  async function createMember(
    tag: string,
    role: 'member' | 'operator' = 'member',
  ): Promise<{ token: string; userId: number }> {
    const bcrypt = await import('bcrypt');
    const hash = await bcrypt.hash('TargetEdit1!', 4);
    const [user] = nonEmpty(
      await testApp.db
        .insert(schema.users)
        .values({
          discordId: `local:${tag}@targetedit.local`,
          username: tag,
          role,
        })
        .returning(),
      'user',
    );
    const email = `${tag}@targetedit.local`.toLowerCase();
    await testApp.db.insert(schema.localCredentials).values({
      email,
      passwordHash: hash,
      userId: user.id,
    });
    const res = await testApp.request
      .post('/auth/local')
      .send({ email, password: 'TargetEdit1!' });
    return { token: res.body.access_token as string, userId: user.id };
  }

  async function createLineup(targetPct: number | null): Promise<number> {
    const res = await testApp.request
      .post('/lineups')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        title: 'Target Edit',
        ...(targetPct === null ? {} : { nominationTargetPct: targetPct }),
      });
    expect(res.status).toBe(201);
    return res.body.id as number;
  }

  async function createGames(count: number): Promise<Game[]> {
    const games: Game[] = [];
    for (let i = 0; i < count; i++) {
      const [game] = nonEmpty(
        await testApp.db
          .insert(schema.games)
          .values({
            name: `TargetEdit Game ${i + 1}`,
            slug: `targetedit-${i + 1}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          })
          .returning(),
        'game',
      );
      games.push(game);
    }
    return games;
  }

  /** Last game goes to `b` so there are always two distinct nominators. */
  async function nominateAll(
    lineupId: number,
    games: Game[],
    a: { token: string },
    b: { token: string },
  ): Promise<void> {
    for (const [i, game] of games.entries()) {
      const who = i === games.length - 1 ? b : a;
      const res = await testApp.request
        .post(`/lineups/${lineupId}/nominate`)
        .set('Authorization', `Bearer ${who.token}`)
        .send({ gameId: game.id });
      expect(res.status).toBe(201);
    }
  }

  function patchTarget(
    lineupId: number,
    body: Record<string, unknown>,
    token = adminToken,
  ) {
    return testApp.request
      .patch(`/lineups/${lineupId}/metadata`)
      .set('Authorization', `Bearer ${token}`)
      .send(body);
  }

  async function setStatus(lineupId: number, status: string) {
    return testApp.request
      .patch(`/lineups/${lineupId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status });
  }

  async function readRow(lineupId: number): Promise<Lineup> {
    const [row] = nonEmpty(
      await testApp.db
        .select()
        .from(schema.communityLineups)
        .where(eq(schema.communityLineups.id, lineupId)),
      'lineup',
    );
    return row;
  }

  /**
   * 25% target, 5 games across two members -> voting, then revert to
   * building. Leaves a DISARMED lineup at 5/20 = 25% inside the revert pause.
   */
  async function disarmedLineupAtFive() {
    const a = await createMember('edit-a');
    const b = await createMember('edit-b');
    const lineupId = await createLineup(25);
    await nominateAll(lineupId, await createGames(5), a, b);
    expect((await readRow(lineupId)).status).toBe('voting');
    expect((await setStatus(lineupId, 'building')).status).toBe(200);
    const row = await readRow(lineupId);
    expect(row.status).toBe('building');
    expect(row.nominationTargetDisarmedAt).not.toBeNull();
    return { lineupId, a, b };
  }

  /**
   * 75% target, 5 games across two members: 5/20 = 25%. Never reverted, so
   * ARMED (below-seen stamped) and not disarmed — the common edit path.
   */
  async function armedLineupAtFive() {
    const a = await createMember('armed-a');
    const b = await createMember('armed-b');
    const lineupId = await createLineup(75);
    await nominateAll(lineupId, await createGames(5), a, b);
    const row = await readRow(lineupId);
    expect(row.status).toBe('building');
    expect(row.nominationTargetDisarmedAt).toBeNull();
    expect(row.nominationTargetBelowSeenAt).not.toBeNull();
    return { lineupId, a, b, belowSeenAt: row.nominationTargetBelowSeenAt };
  }

  async function setCreator(lineupId: number, userId: number): Promise<void> {
    await testApp.db
      .update(schema.communityLineups)
      .set({ createdBy: userId })
      .where(eq(schema.communityLineups.id, lineupId));
  }

  // -- Cases -----------------------------------------------------------------

  it('sets a target on a deadline-only building lineup and arms it', async () => {
    const lineupId = await createLineup(null);

    const res = await patchTarget(lineupId, { nominationTargetPct: 50 });

    expect(res.status).toBe(200);
    expect(res.body.nominationTargetPct).toBe(50);
    // 0 entries < 50%: below target, so the rising edge is armed.
    expect(res.body.nominationTargetArmed).toBe(true);
    expect((await readRow(lineupId)).nominationTargetPct).toBe(50);
  });

  it('clears the disarm stamp on a reverted lineup and arms it below the new target', async () => {
    const { lineupId } = await disarmedLineupAtFive();

    const res = await patchTarget(lineupId, { nominationTargetPct: 50 });

    expect(res.status).toBe(200);
    expect(res.body.nominationTargetDisarmedAt).toBeNull();
    // 5/20 = 25% < 50%: armed.
    expect(res.body.nominationTargetArmed).toBe(true);
    expect((await readRow(lineupId)).nominationTargetDisarmedAt).toBeNull();
  });

  it('opens voting on the next crossing once re-armed and the pause has lapsed', async () => {
    const { lineupId, a, b } = await disarmedLineupAtFive();
    expect(
      (await patchTarget(lineupId, { nominationTargetPct: 50 })).status,
    ).toBe(200);
    await settings.set(SETTING_KEYS.LINEUP_AUTO_ADVANCE_PAUSE_TTL_MS, '0');

    // 5 -> 10 entries = 50% of 20: a genuine rising edge.
    await nominateAll(lineupId, await createGames(5), a, b);

    expect((await readRow(lineupId)).status).toBe('voting');
  });

  it('refuses a target edit during a pending grace window: 409, no writes, the countdown still fires (Codex round 3)', async () => {
    await settings.set(SETTING_KEYS.LINEUP_AUTO_ADVANCE_GRACE_MS, '600000');
    const a = await createMember('grace-a');
    const b = await createMember('grace-b');
    const lineupId = await createLineup(50);
    // 10 of 20 = 50%: the crossing claims a 10-minute grace window.
    await nominateAll(lineupId, await createGames(10), a, b);
    const claimed = await readRow(lineupId);
    expect(claimed.pendingAdvanceAt).not.toBeNull();

    const res = await patchTarget(lineupId, {
      title: 'Renamed mid-countdown',
      nominationTargetPct: 75,
    });
    expect(res.status).toBe(409);
    expect(res.body.message).toBe(
      'An early advance is already counting down — wait for it or advance manually',
    );
    const after = await readRow(lineupId);
    expect(after.title).toBe(claimed.title);
    expect(after.nominationTargetPct).toBe(50);
    expect(after.pendingAdvanceAt).toEqual(claimed.pendingAdvanceAt);

    // The grace job firing at its deadline still opens voting.
    await testApp.app
      .get(LineupPhaseProcessor)
      .process({ name: LINEUP_GRACE_ADVANCE, data: { lineupId } } as never);
    expect((await readRow(lineupId)).status).toBe('voting');
  });

  it('a stale zero-grace evaluation cannot advance after a 50 -> 75 -> 50 edit (Codex round 4 ABA)', async () => {
    const a = await createMember('aba-a');
    const b = await createMember('aba-b');
    const lineupId = await createLineup(50);
    // 9 of 20 = 45%: below target, so the rising edge is armed.
    const games = await createGames(10);
    await nominateAll(lineupId, games.slice(0, 9), a, b);
    // The 10th entry lands without the nominate hook, then the evaluation
    // reads the row: 10/20 = 50% while armed, i.e. a ready crossing.
    const tenth = nonEmpty(games.slice(9), 'tenth game')[0];
    await testApp.db.insert(schema.communityLineupEntries).values({
      lineupId,
      gameId: tenth.id,
      nominatedBy: b.userId,
    });
    const judged = await readRow(lineupId);
    expect(judged.status).toBe('building');
    expect(judged.nominationTargetBelowSeenAt).not.toBeNull();

    // Before that evaluation writes, an operator raises the target and puts
    // it back. 50% is not below 50%, so the edit leaves the lineup unarmed.
    expect(
      (await patchTarget(lineupId, { nominationTargetPct: 75 })).status,
    ).toBe(200);
    const back = await patchTarget(lineupId, { nominationTargetPct: 50 });
    expect(back.status).toBe(200);
    expect(back.body.nominationTargetArmed).toBe(false);

    // The stale evaluation now writes its transition, pinned to `judged`.
    const processor = testApp.app.get(LineupPhaseProcessor);
    const outcome = await runStatusTransition(
      processor['buildTransitionDeps'](),
      lineupId,
      { status: 'voting' },
      null,
      advanceGuardFrom(judged),
    ).then(
      () => 'advanced',
      (err: unknown) => (err instanceof Error ? err.name : String(err)),
    );

    // An evaluation judged under the old arm must not advance an unarmed lineup.
    expect(outcome).toBe('ConflictException');
    expect((await readRow(lineupId)).status).toBe('building');
  });

  it('a stale zero-grace evaluation cannot advance after a 50 -> 75 -> 50 edit that re-arms (review r4 MINOR 2)', async () => {
    const a = await createMember('aba2-a');
    const b = await createMember('aba2-b');
    const lineupId = await createLineup(50);
    const games = await createGames(10);
    await nominateAll(lineupId, games.slice(0, 9), a, b);
    const tenth = nonEmpty(games.slice(9), 'tenth game')[0];
    const [entry] = nonEmpty(
      await testApp.db
        .insert(schema.communityLineupEntries)
        .values({ lineupId, gameId: tenth.id, nominatedBy: b.userId })
        .returning(),
      'tenth entry',
    );
    // The evaluation reads 10/20 = 50% while armed: a ready crossing.
    const judged = await readRow(lineupId);
    expect(judged.nominationTargetBelowSeenAt).not.toBeNull();

    // Before it writes, the count drops to 9 (45%) and the operator edits
    // 50 -> 75 -> 50. Both edits see 45% below target, so each re-arms with
    // a fresh stamp; the 10th game then comes back.
    await testApp.db
      .delete(schema.communityLineupEntries)
      .where(eq(schema.communityLineupEntries.id, entry.id));
    expect(
      (await patchTarget(lineupId, { nominationTargetPct: 75 })).status,
    ).toBe(200);
    const back = await patchTarget(lineupId, { nominationTargetPct: 50 });
    expect(back.status).toBe(200);
    expect(back.body.nominationTargetArmed).toBe(true);
    const rearmed = await readRow(lineupId);
    expect(rearmed.nominationTargetBelowSeenAt).not.toEqual(
      judged.nominationTargetBelowSeenAt,
    );
    await testApp.db
      .insert(schema.communityLineupEntries)
      .values({ lineupId, gameId: tenth.id, nominatedBy: b.userId });

    const processor = testApp.app.get(LineupPhaseProcessor);
    const outcome = await runStatusTransition(
      processor['buildTransitionDeps'](),
      lineupId,
      { status: 'voting' },
      null,
      advanceGuardFrom(judged),
    ).then(
      () => 'advanced',
      (err: unknown) => (err instanceof Error ? err.name : String(err)),
    );

    // The re-arm wrote a new stamp, so the old evaluation's arm is gone.
    expect(outcome).toBe('ConflictException');
    expect((await readRow(lineupId)).status).toBe('building');
  });

  it('an evaluation arms an unarmed lineup it reads below target', async () => {
    const a = await createMember('arm-a');
    const b = await createMember('arm-b');
    const lineupId = await createLineup(75);
    await nominateAll(lineupId, await createGames(5), a, b);
    // Fixture: unarmed below target (5/20 = 25% of 75%). `updated_at` keeps
    // its insert-time microsecond value, so the ms-precision match is tested.
    await testApp.db
      .update(schema.communityLineups)
      .set({ nominationTargetBelowSeenAt: null })
      .where(eq(schema.communityLineups.id, lineupId));

    // A live nomination (6/20 = 30%) evaluates a fresh read and arms.
    await nominateAll(lineupId, await createGames(1), a, b);

    expect(
      (await readRow(lineupId)).nominationTargetBelowSeenAt,
    ).not.toBeNull();
  });

  it('a stale evaluation cannot re-arm after a 75 -> 50 -> 75 edit (Codex round 5)', async () => {
    const a = await createMember('rearm-a');
    const b = await createMember('rearm-b');
    const lineupId = await createLineup(75);
    const games = await createGames(16);
    await nominateAll(lineupId, games.slice(0, 14), a, b);
    // Fixture: an unarmed lineup at 14/20 = 70%, below its 75% target.
    await testApp.db
      .update(schema.communityLineups)
      .set({ nominationTargetBelowSeenAt: null })
      .where(eq(schema.communityLineups.id, lineupId));
    // An evaluation reads it here: below target, so it is about to arm.
    const stale = await readRow(lineupId);
    expect(stale.nominationTargetBelowSeenAt).toBeNull();

    // Before it writes, two nominations land (16/20 = 80%) and the operator
    // saves 75 -> 50 -> 75. 80% is a standing condition for both, so both
    // edits leave the lineup unarmed.
    await testApp.db.insert(schema.communityLineupEntries).values(
      games.slice(14).map((g) => ({
        lineupId,
        gameId: g.id,
        nominatedBy: b.userId,
      })),
    );
    expect(
      (await patchTarget(lineupId, { nominationTargetPct: 50 })).status,
    ).toBe(200);
    const back = await patchTarget(lineupId, { nominationTargetPct: 75 });
    expect(back.status).toBe(200);
    expect(back.body.nominationTargetArmed).toBe(false);

    // The stale evaluation now runs its arm write on the old snapshot.
    const result = await evaluateNominationTarget(testApp.db, stale, 14, 1);
    expect(result.ready).toBe(false);

    expect((await readRow(lineupId)).nominationTargetBelowSeenAt).toBeNull();
  });

  it('still honours the 24h revert pause after a re-arm', async () => {
    const { lineupId, a, b } = await disarmedLineupAtFive();
    expect(
      (await patchTarget(lineupId, { nominationTargetPct: 50 })).status,
    ).toBe(200);

    // Pause TTL left at its default: crossing 50% must NOT advance yet.
    await nominateAll(lineupId, await createGames(5), a, b);

    expect((await readRow(lineupId)).status).toBe('building');
  });

  it('leaves a lineup already at/above the new target unarmed (no instant advance)', async () => {
    const { lineupId, a, b } = await disarmedLineupAtFive();

    // Same 25% re-sent on a disarmed lineup is a deliberate re-arm request.
    const res = await patchTarget(lineupId, { nominationTargetPct: 25 });

    expect(res.status).toBe(200);
    expect(res.body.nominationTargetDisarmedAt).toBeNull();
    // 5/20 = 25% >= 25%: a standing condition, so the edge stays unarmed.
    expect(res.body.nominationTargetArmed).toBe(false);
    expect(res.body.status).toBe('building');

    // Even with the pause gone, one more nomination is not a rising edge.
    await settings.set(SETTING_KEYS.LINEUP_AUTO_ADVANCE_PAUSE_TTL_MS, '0');
    await nominateAll(lineupId, await createGames(1), a, b);
    expect((await readRow(lineupId)).status).toBe('building');
  });

  it('turns the target off with null and clears both stamps', async () => {
    const { lineupId } = await disarmedLineupAtFive();

    const res = await patchTarget(lineupId, { nominationTargetPct: null });

    expect(res.status).toBe(200);
    expect(res.body.nominationTargetPct).toBeNull();
    const row = await readRow(lineupId);
    expect(row.nominationTargetDisarmedAt).toBeNull();
    expect(row.nominationTargetBelowSeenAt).toBeNull();
  });

  it('returns 409 when the lineup is not building', async () => {
    const lineupId = await createLineup(25);
    await testApp.db
      .update(schema.communityLineups)
      .set({ status: 'voting' })
      .where(eq(schema.communityLineups.id, lineupId));

    const res = await patchTarget(lineupId, { nominationTargetPct: 50 });

    expect(res.status).toBe(409);
    expect((await readRow(lineupId)).nominationTargetPct).toBe(25);
  });

  it('rejects a mixed title + target body outside building without writing the title', async () => {
    const lineupId = await createLineup(25);
    await testApp.db
      .update(schema.communityLineups)
      .set({ status: 'voting' })
      .where(eq(schema.communityLineups.id, lineupId));

    const res = await patchTarget(lineupId, {
      title: 'Renamed',
      nominationTargetPct: 50,
    });

    expect(res.status).toBe(409);
    expect((await readRow(lineupId)).title).toBe('Target Edit');
  });

  it('returns 403 to a non-creator member', async () => {
    const lineupId = await createLineup(25);
    const outsider = await createMember('edit-outsider');

    const res = await patchTarget(
      lineupId,
      { nominationTargetPct: 50 },
      outsider.token,
    );

    expect(res.status).toBe(403);
    expect((await readRow(lineupId)).nominationTargetPct).toBe(25);
  });

  it('rejects out-of-range and non-integer targets with 400', async () => {
    const lineupId = await createLineup(null);
    for (const bad of [0, 101, 12.5, '50']) {
      const res = await patchTarget(lineupId, { nominationTargetPct: bad });
      expect(res.status).toBe(400);
    }
  });

  it('rejects an empty body with 400 and still accepts a title-only body', async () => {
    const lineupId = await createLineup(25);

    expect((await patchTarget(lineupId, {})).status).toBe(400);
    const res = await patchTarget(lineupId, { title: 'Just a rename' });
    expect(res.status).toBe(200);
    expect(res.body.nominationTargetPct).toBe(25);
  });

  it('lowers an armed lineup to its current fill: comes back unarmed and does not advance', async () => {
    const { lineupId, a, b } = await armedLineupAtFive();

    const res = await patchTarget(lineupId, { nominationTargetPct: 25 });

    expect(res.status).toBe(200);
    // 5/20 = 25% >= 25%: a standing condition, so the old arm is cleared.
    expect(res.body.nominationTargetArmed).toBe(false);
    expect((await readRow(lineupId)).nominationTargetBelowSeenAt).toBeNull();

    // No revert pause applies, and the next nomination is still no crossing.
    await settings.set(SETTING_KEYS.LINEUP_AUTO_ADVANCE_PAUSE_TTL_MS, '0');
    await nominateAll(lineupId, await createGames(1), a, b);
    expect((await readRow(lineupId)).status).toBe('building');
  });

  it('re-sending the same pct on an armed lineup keeps its arm stamp', async () => {
    const { lineupId, belowSeenAt } = await armedLineupAtFive();

    const res = await patchTarget(lineupId, { nominationTargetPct: 75 });

    expect(res.status).toBe(200);
    expect(res.body.nominationTargetArmed).toBe(true);
    const row = await readRow(lineupId);
    expect(row.nominationTargetBelowSeenAt?.getTime()).toBe(
      belowSeenAt?.getTime(),
    );
  });

  it('lets the non-admin creator edit the target', async () => {
    const creator = await createMember('edit-creator');
    const lineupId = await createLineup(25);
    await setCreator(lineupId, creator.userId);

    const res = await patchTarget(
      lineupId,
      { nominationTargetPct: 50 },
      creator.token,
    );

    expect(res.status).toBe(200);
    expect((await readRow(lineupId)).nominationTargetPct).toBe(50);
  });

  it('lets an operator who did not create the lineup edit the target', async () => {
    const operator = await createMember('edit-operator', 'operator');
    const lineupId = await createLineup(25);

    const res = await patchTarget(
      lineupId,
      { nominationTargetPct: 50 },
      operator.token,
    );

    expect(res.status).toBe(200);
    expect((await readRow(lineupId)).nominationTargetPct).toBe(50);
  });
}

describe(
  'Lineup nomination target edit (integration, ROK-1710)',
  describeNominationTargetEdit,
);
