/**
 * ROK-1444 — count-based early advance + the revert trap.
 *
 * The trap (why this file exists): 20 games nominated, lineup advances to
 * voting. Someone new joins, the group wants different games, the operator
 * reverts voting -> building. The count condition is STILL TRUE the instant the
 * revert lands, so a naive target re-advances immediately and the lineup can
 * never be edited. Livelock.
 *
 * `TRAP` below walks the whole thing end to end. Its final leg deliberately
 * expires `LINEUP_AUTO_ADVANCE_PAUSE_TTL_MS` so the ROK-1253 revert pause is
 * NOT what is holding the lineup — only the sticky
 * `nomination_target_disarmed_at` guard can keep it in `building`. That is the
 * assertion that fails if someone later "simplifies" the guard down to the
 * existing pause.
 *
 * Grace is pinned to 0 throughout (the documented escape hatch) so advancement
 * is synchronous and these tests never poll a BullMQ worker.
 */
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import { eq } from 'drizzle-orm';
import { SettingsService } from '../settings/settings.service';
import { SETTING_KEYS } from '../drizzle/schema/app-settings';

function describeNominationTarget() {
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
  ): Promise<{ token: string; userId: number }> {
    const bcrypt = await import('bcrypt');
    const hash = await bcrypt.hash('NomTarget1!', 4);
    const [user] = await testApp.db
      .insert(schema.users)
      .values({
        discordId: `local:${tag}@nomtarget.local`,
        username: tag,
        role: 'member',
      })
      .returning();
    const email = `${tag}@nomtarget.local`.toLowerCase();
    await testApp.db.insert(schema.localCredentials).values({
      email,
      passwordHash: hash,
      userId: user.id,
    });
    const res = await testApp.request
      .post('/auth/local')
      .send({ email, password: 'NomTarget1!' });
    return { token: res.body.access_token as string, userId: user.id };
  }

  /** `nominationTargetPct` null => today's deadline-only behaviour. */
  async function createLineup(targetPct: number | null) {
    const res = await testApp.request
      .post('/lineups')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        title: 'Nomination Target',
        ...(targetPct === null ? {} : { nominationTargetPct: targetPct }),
      });
    expect(res.status).toBe(201);
    return res.body.id as number;
  }

  async function createGames(count: number) {
    const games: (typeof schema.games.$inferSelect)[] = [];
    for (let i = 0; i < count; i++) {
      const [game] = await testApp.db
        .insert(schema.games)
        .values({
          name: `NomTarget Game ${i + 1}`,
          slug: `nomtarget-${i + 1}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        })
        .returning();
      games.push(game);
    }
    return games;
  }

  async function nominate(token: string, lineupId: number, gameId: number) {
    return testApp.request
      .post(`/lineups/${lineupId}/nominate`)
      .set('Authorization', `Bearer ${token}`)
      .send({ gameId });
  }

  async function unnominate(token: string, lineupId: number, gameId: number) {
    return testApp.request
      .delete(`/lineups/${lineupId}/nominations/${gameId}`)
      .set('Authorization', `Bearer ${token}`);
  }

  async function setStatus(lineupId: number, status: string) {
    return testApp.request
      .patch(`/lineups/${lineupId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status });
  }

  async function readStatus(lineupId: number): Promise<string> {
    const [row] = await testApp.db
      .select({ status: schema.communityLineups.status })
      .from(schema.communityLineups)
      .where(eq(schema.communityLineups.id, lineupId));
    return row?.status ?? 'missing';
  }

  async function readDisarmedAt(lineupId: number): Promise<Date | null> {
    const [row] = await testApp.db
      .select({ at: schema.communityLineups.nominationTargetDisarmedAt })
      .from(schema.communityLineups)
      .where(eq(schema.communityLineups.id, lineupId));
    return row?.at ?? null;
  }

  /**
   * Nominate `games` across TWO members so the >=2-voter quorum guard is
   * satisfied (public lineups gate on distinct nominators). With 2 nominators
   * the cap is `max(20, 2 * 5)` = 20, so a 25% target lands at 5 entries.
   */
  async function nominateAcrossTwoMembers(
    lineupId: number,
    games: (typeof schema.games.$inferSelect)[],
    a: { token: string },
    b: { token: string },
  ) {
    for (const [i, game] of games.entries()) {
      const who = i === games.length - 1 ? b : a;
      const res = await nominate(who.token, lineupId, game.id);
      expect(res.status).toBe(201);
    }
  }

  // -- AC: target reached advances; not reached / unset does not -------------

  it('advances building -> voting once nominations reach the target share of the cap', async () => {
    const a = await createMember('target-a');
    const b = await createMember('target-b');
    const lineupId = await createLineup(25); // 25% of cap 20 = 5 entries
    const games = await createGames(5);

    expect(await readStatus(lineupId)).toBe('building');
    await nominateAcrossTwoMembers(lineupId, games, a, b);

    expect(await readStatus(lineupId)).toBe('voting');
  });

  it('stays in building when the target is not reached (deadline remains the upper bound)', async () => {
    const a = await createMember('under-a');
    const b = await createMember('under-b');
    const lineupId = await createLineup(50); // 50% of cap 20 = 10 entries
    const games = await createGames(5); // only half way there

    await nominateAcrossTwoMembers(lineupId, games, a, b);

    expect(await readStatus(lineupId)).toBe('building');
  });

  it('leaves behaviour unchanged when no target is configured', async () => {
    const a = await createMember('unset-a');
    const b = await createMember('unset-b');
    const lineupId = await createLineup(null);
    const games = await createGames(8);

    await nominateAcrossTwoMembers(lineupId, games, a, b);

    // No target => only the phase deadline or a manual advance can move it.
    expect(await readStatus(lineupId)).toBe('building');
  });

  // -- THE TRAP -------------------------------------------------------------

  it('TRAP: reverting voting -> building does not re-advance, and survives an edit that re-crosses the target', async () => {
    const a = await createMember('trap-a');
    const b = await createMember('trap-b');
    const lineupId = await createLineup(25); // 5 entries of a 20 cap
    const games = await createGames(5);

    // 1. Nominate to the target -> advances.
    await nominateAcrossTwoMembers(lineupId, games, a, b);
    expect(await readStatus(lineupId)).toBe('voting');

    // 2. Operator reverts to edit the candidate list.
    expect((await setStatus(lineupId, 'building')).status).toBe(200);
    expect(await readStatus(lineupId)).toBe('building');
    // The sticky disarm — NOT the TTL'd pause — is what must hold from here.
    expect(await readDisarmedAt(lineupId)).not.toBeNull();

    // 3. Expire the ROK-1253 revert pause so it cannot be what is holding the
    //    lineup. Only `nomination_target_disarmed_at` is left.
    await settings.set(SETTING_KEYS.LINEUP_AUTO_ADVANCE_PAUSE_TTL_MS, '0');

    // 4. The count condition is still standing (5 >= 5): must NOT re-advance.
    expect(await readStatus(lineupId)).toBe('building');

    // 5. The realistic edit: drop a weak game, add a better one. That dips
    //    below the target and re-crosses it — a genuine rising edge, which is
    //    precisely why rising-edge detection ALONE is insufficient.
    expect((await unnominate(b.token, lineupId, games[4].id)).status).toBe(204);
    expect(await readStatus(lineupId)).toBe('building');

    const [replacement] = await createGames(1);
    expect((await nominate(b.token, lineupId, replacement.id)).status).toBe(
      201,
    );

    // 6. Still building. The operator keeps control for the rest of the
    //    lineup's life; only the deadline or a manual advance moves it now.
    expect(await readStatus(lineupId)).toBe('building');
  });

  it('TRAP: repeated remove/re-add cycles after a revert never re-advance', async () => {
    const a = await createMember('cycle-a');
    const b = await createMember('cycle-b');
    const lineupId = await createLineup(25);
    const games = await createGames(5);

    await nominateAcrossTwoMembers(lineupId, games, a, b);
    expect(await readStatus(lineupId)).toBe('voting');
    await setStatus(lineupId, 'building');
    await settings.set(SETTING_KEYS.LINEUP_AUTO_ADVANCE_PAUSE_TTL_MS, '0');

    for (let i = 0; i < 3; i++) {
      expect((await unnominate(b.token, lineupId, games[4].id)).status).toBe(
        204,
      );
      expect((await nominate(b.token, lineupId, games[4].id)).status).toBe(201);
      expect(await readStatus(lineupId)).toBe('building');
    }
  });

  // -- Rising edge: a lineup that starts at/above target never fires ---------

  it('does not fire on a standing condition present before the lineup was armed', async () => {
    const a = await createMember('standing-a');
    const b = await createMember('standing-b');
    const lineupId = await createLineup(25);
    const games = await createGames(6);

    // Seed 5 entries directly (bypassing the nominate path, as carry-over
    // does) so the target is already satisfied before any quorum evaluation,
    // then clear the create-time arm to model a carry-over-seeded lineup.
    for (const [i, game] of games.slice(0, 5).entries()) {
      await testApp.db.insert(schema.communityLineupEntries).values({
        lineupId,
        gameId: game.id,
        nominatedBy: i === 4 ? b.userId : a.userId,
      });
    }
    await testApp.db
      .update(schema.communityLineups)
      .set({ nominationTargetBelowSeenAt: null })
      .where(eq(schema.communityLineups.id, lineupId));

    // A 6th nomination triggers evaluation. The condition is standing, not
    // crossing, so the lineup must stay put.
    expect((await nominate(b.token, lineupId, games[5].id)).status).toBe(201);

    expect(await readStatus(lineupId)).toBe('building');
  });

  // -- Monotonic denominator: a REMOVAL must never advance the lineup -------

  it("removing a nominator's last entry does not advance, even though it shrinks the live cap", async () => {
    // Regression for the bug this design originally shipped with: the live cap
    // is max(20, distinctNominators * 5), so dropping the 5th nominator
    // collapses it 25 -> 20 and lifts 21/25 = 84% to 20/20 = 100%. With a 90%
    // target that DELETION opened voting. `nomination_cap_peak` pins the
    // denominator at its high-water mark so the percentage can never rise on a
    // removal.
    const ms = [];
    for (const tag of ['peak-a', 'peak-b', 'peak-c', 'peak-d', 'peak-e']) {
      ms.push(await createMember(tag));
    }
    const lineupId = await createLineup(90);
    const games = await createGames(25);

    // One entry each from five distinct nominators -> cap ratchets to 25.
    for (const [i, m] of ms.entries()) {
      expect((await nominate(m.token, lineupId, games[i].id)).status).toBe(201);
    }
    // Pad to 21 entries: 21/25 = 84%, under the 90% target.
    for (let i = 5; i < 21; i++) {
      expect((await nominate(ms[0].token, lineupId, games[i].id)).status).toBe(
        201,
      );
    }
    expect(await readStatus(lineupId)).toBe('building');

    // The fifth nominator removes their ONLY entry. Live cap would fall to 20.
    expect((await unnominate(ms[4].token, lineupId, games[4].id)).status).toBe(
      204,
    );

    expect(await readStatus(lineupId)).toBe('building');

    // And the published denominator stays at the peak rather than jittering.
    const res = await testApp.request
      .get(`/lineups/${lineupId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.body.nominationCap).toBe(25);

    // Codex review P2: the Common Ground meta drives the web's `atCap`, and
    // `validateNominationCap` gates on the peak. If this reported the LIVE cap
    // (20) the lineup would render as full at 20 entries and disable every
    // nominate button while the API still accepted nominations up to 25.
    const cg = await testApp.request
      .get(`/lineups/common-ground?lineupId=${lineupId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(cg.status).toBe(200);
    expect(cg.body.meta.maxNominations).toBe(25);
  });

  // -- Carry-over pins the cap even with no target (Codex P2) ---------------

  it('pins the cap for a carried-over roster even when no target is configured', async () => {
    // Codex review P2: the ratchet used to live behind the target's arm, so a
    // DEADLINE-ONLY lineup seeded by carry-over never pinned its denominator.
    // Such a lineup could start at 5 nominators (cap 25), lose one nominator's
    // only entry, collapse to a live cap of 20, and render as full at 20/20
    // with every nominate button disabled.
    const members = [];
    for (const tag of ['co-a', 'co-b', 'co-c', 'co-d', 'co-e']) {
      members.push(await createMember(tag));
    }
    const games = await createGames(5);

    // A finished lineup whose below-threshold matches are carry-over fodder.
    const [prev] = await testApp.db
      .insert(schema.communityLineups)
      .values({
        title: 'Carryover Source',
        createdBy: members[0].userId,
        status: 'decided',
        visibility: 'public',
        // public_slug is varchar(16).
        publicSlug: `cs-${Date.now()}`.slice(0, 16),
      })
      .returning();
    for (const [i, game] of games.entries()) {
      await testApp.db.insert(schema.communityLineupEntries).values({
        lineupId: prev.id,
        gameId: game.id,
        nominatedBy: members[i].userId,
      });
      await testApp.db.insert(schema.communityLineupMatches).values({
        lineupId: prev.id,
        gameId: game.id,
        status: 'suggested',
        thresholdMet: false,
        // Explicit: the DB column has no DEFAULT despite the Drizzle
        // `.default(0)`, so omitting it inserts NULL and trips NOT NULL.
        voteCount: 0,
      });
    }

    // New lineup with NO nominationTargetPct — the deadline-only default.
    const lineupId = await createLineup(null);

    const [row] = await testApp.db
      .select({
        peak: schema.communityLineups.nominationCapPeak,
      })
      .from(schema.communityLineups)
      .where(eq(schema.communityLineups.id, lineupId));
    // 5 carried-over nominators -> max(20, 5 * 5) = 25, pinned.
    expect(row?.peak).toBe(25);

    const res = await testApp.request
      .get(`/lineups/${lineupId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.body.nominationCap).toBe(25);
  });

  // -- The published denominator --------------------------------------------

  it('publishes the nomination cap the target is measured against', async () => {
    const a = await createMember('cap-a');
    const b = await createMember('cap-b');
    const lineupId = await createLineup(50);
    const games = await createGames(3);

    await nominateAcrossTwoMembers(lineupId, games, a, b);

    const res = await testApp.request
      .get(`/lineups/${lineupId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    // 2 distinct nominators -> max(20, 2 * 5) = 20.
    expect(res.body.nominationCap).toBe(20);
    expect(res.body.nominationTargetPct).toBe(50);
    expect(res.body.nominationTargetDisarmedAt).toBeNull();
  });
}

describe('Lineup nomination target (ROK-1444)', describeNominationTarget);
