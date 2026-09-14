/**
 * Failing-first integration tests for the U4 SubmitBar write paths (ROK-1296).
 *
 * Endpoints under test (none of these exist yet):
 *   - POST /lineups/:id/submit-nominations
 *   - POST /lineups/:id/submit-votes
 *
 * Each writes to the new `community_lineup_user_submissions` row (lineup+user)
 * or to the new `scheduling_submitted_at` column on
 * `community_lineup_match_members`. None of the schema, controller, or service
 * is implemented yet — every assertion MUST fail at commit time so the dev
 * agent has a concrete green-bar target to drive the implementation against.
 *
 * Covered ACs (from planning-artifacts/specs/ROK-1296.md):
 *   - AC2a / AC2b / AC2c — write path stamps the right column.
 *   - AC5 — re-submission overwrites the timestamp to a later value.
 *   - Edge: phase mismatch → 403 for nominate-in-voting / vote-in-building.
 *   - Edge: private lineup non-invitee → 403 on submit-nominations.
 *
 * ROK-1544 retired the third endpoint (`submit-scheduling`): the scheduling
 * surface has no member Submit step, and `scheduling_submitted_at` is stamped
 * server-side from the vote itself. Its tests moved to
 * `scheduling/scheduling-vote-membership.integration.spec.ts`.
 *
 * Pattern mirrors `lineups-auto-advance.integration.spec.ts` for member +
 * private-invitee scaffolding so the dev recognises the helpers.
 */
import { sql } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../../common/testing/integration-helpers';
import * as schema from '../../drizzle/schema';
import { SettingsService } from '../../settings/settings.service';
import { SETTING_KEYS } from '../../drizzle/schema/app-settings';

interface SubmissionRow extends Record<string, unknown> {
  lineup_id: number;
  user_id: number;
  nominations_submitted_at: string | null;
  votes_submitted_at: string | null;
}

function describeLineupSubmit() {
  let testApp: TestApp;
  let adminToken: string;
  let settings: SettingsService;

  beforeAll(async () => {
    testApp = await getTestApp();
    adminToken = await loginAsAdmin(testApp.request, testApp.seed);
    settings = testApp.app.get(SettingsService);
    // Same escape hatch lineups-auto-advance uses — 0ms grace so the
    // assertions in this file don't race the BullMQ worker when an
    // auto-advance side-effect happens to fire after a submit.
    await settings.set(SETTING_KEYS.LINEUP_AUTO_ADVANCE_GRACE_MS, '0');
  });

  afterAll(async () => {
    await settings.delete(SETTING_KEYS.LINEUP_AUTO_ADVANCE_GRACE_MS);
  });

  afterEach(async () => {
    testApp.seed = await truncateAllTables(testApp.db);
    adminToken = await loginAsAdmin(testApp.request, testApp.seed);
    await settings.set(SETTING_KEYS.LINEUP_AUTO_ADVANCE_GRACE_MS, '0');
  });

  // -- Member + lineup helpers (mirror lineups-auto-advance pattern) --------

  async function createMember(
    tag: string,
  ): Promise<{ token: string; userId: number }> {
    const bcrypt = await import('bcrypt');
    const hash = await bcrypt.hash('Submit1Pass!', 4);
    const [user] = await testApp.db
      .insert(schema.users)
      .values({
        discordId: `local:${tag}@submit.local`,
        username: tag,
        role: 'member',
      })
      .returning();
    const email = `${tag}@submit.local`.toLowerCase();
    await testApp.db.insert(schema.localCredentials).values({
      email,
      passwordHash: hash,
      userId: user.id,
    });
    const res = await testApp.request
      .post('/auth/local')
      .send({ email, password: 'Submit1Pass!' });
    return { token: res.body.access_token as string, userId: user.id };
  }

  async function createPublicLineup(token: string) {
    return testApp.request
      .post('/lineups')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Submit Test Public' });
  }

  async function createPrivateLineup(token: string, inviteeUserIds: number[]) {
    return testApp.request
      .post('/lineups')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'Submit Test Private',
        visibility: 'private',
        inviteeUserIds,
      });
  }

  async function createGames(count: number) {
    const games: (typeof schema.games.$inferSelect)[] = [];
    for (let i = 0; i < count; i++) {
      const [game] = await testApp.db
        .insert(schema.games)
        .values({
          name: `Submit Game ${i + 1}`,
          slug: `submit-game-${i + 1}-${Date.now()}-${Math.random()
            .toString(36)
            .slice(2, 7)}`,
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

  async function vote(token: string, lineupId: number, gameId: number) {
    return testApp.request
      .post(`/lineups/${lineupId}/vote`)
      .set('Authorization', `Bearer ${token}`)
      .send({ gameId });
  }

  async function advanceToVoting(lineupId: number, token: string) {
    return testApp.request
      .patch(`/lineups/${lineupId}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'voting' });
  }

  // -- Direct DB probes for the new columns ---------------------------------

  async function readSubmission(
    lineupId: number,
    userId: number,
  ): Promise<SubmissionRow | null> {
    const rows = await testApp.db.execute<SubmissionRow>(sql`
      SELECT lineup_id, user_id, nominations_submitted_at, votes_submitted_at
        FROM community_lineup_user_submissions
       WHERE lineup_id = ${lineupId} AND user_id = ${userId}
    `);
    return rows[0] ?? null;
  }

  // -- AC2a — submit-nominations writes nominations_submitted_at -----------

  it('POST /lineups/:id/submit-nominations writes nominations_submitted_at for the authed user (AC2a)', async () => {
    const createRes = await createPublicLineup(adminToken);
    expect(createRes.status).toBe(201);
    const lineupId = createRes.body.id as number;

    const [game] = await createGames(1);
    // Nominate something so the user is a participant.
    await nominate(adminToken, lineupId, game.id);

    const before = await readSubmission(lineupId, testApp.seed.adminUser.id);
    expect(before?.nominations_submitted_at ?? null).toBeNull();

    const submitRes = await testApp.request
      .post(`/lineups/${lineupId}/submit-nominations`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});

    expect(submitRes.status).toBe(200);
    expect(submitRes.body.viewerSubmissions).toBeDefined();
    expect(typeof submitRes.body.viewerSubmissions.nominationsSubmittedAt).toBe(
      'string',
    );
    expect(submitRes.body.viewerSubmissions.votesSubmittedAt).toBeNull();
    // ISO-shaped timestamp.
    expect(submitRes.body.viewerSubmissions.nominationsSubmittedAt).toMatch(
      /^\d{4}-\d{2}-\d{2}T/,
    );

    const after = await readSubmission(lineupId, testApp.seed.adminUser.id);
    expect(after).not.toBeNull();
    expect(after?.nominations_submitted_at).not.toBeNull();
    expect(after?.votes_submitted_at ?? null).toBeNull();
  });

  // -- AC2b — submit-votes writes votes_submitted_at -----------------------

  it('POST /lineups/:id/submit-votes writes votes_submitted_at for the authed user (AC2b)', async () => {
    const member = await createMember('vote-submitter');
    const createRes = await createPrivateLineup(adminToken, [member.userId]);
    expect(createRes.status).toBe(201);
    const lineupId = createRes.body.id as number;

    const games = await createGames(3);
    for (const g of games) {
      await nominate(adminToken, lineupId, g.id);
    }
    await advanceToVoting(lineupId, adminToken);

    // Cast at least one real vote so the user is a meaningful participant.
    await vote(member.token, lineupId, games[0].id);

    const submitRes = await testApp.request
      .post(`/lineups/${lineupId}/submit-votes`)
      .set('Authorization', `Bearer ${member.token}`)
      .send({});

    expect(submitRes.status).toBe(200);
    expect(submitRes.body.viewerSubmissions).toBeDefined();
    expect(typeof submitRes.body.viewerSubmissions.votesSubmittedAt).toBe(
      'string',
    );
    expect(submitRes.body.viewerSubmissions.votesSubmittedAt).toMatch(
      /^\d{4}-\d{2}-\d{2}T/,
    );

    const row = await readSubmission(lineupId, member.userId);
    expect(row).not.toBeNull();
    expect(row?.votes_submitted_at).not.toBeNull();
  });

  // -- AC5 — re-submission overwrites the timestamp to a LATER value -------

  it('re-submitting nominations overwrites the existing timestamp with a later one (AC5)', async () => {
    const createRes = await createPublicLineup(adminToken);
    const lineupId = createRes.body.id as number;
    const [game] = await createGames(1);
    await nominate(adminToken, lineupId, game.id);

    const first = await testApp.request
      .post(`/lineups/${lineupId}/submit-nominations`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});
    expect(first.status).toBe(200);
    const firstTs = first.body.viewerSubmissions
      .nominationsSubmittedAt as string;
    expect(typeof firstTs).toBe('string');

    // Postgres now() has microsecond resolution; sleep ensures a STRICT >.
    await new Promise((r) => setTimeout(r, 25));

    const second = await testApp.request
      .post(`/lineups/${lineupId}/submit-nominations`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});
    expect(second.status).toBe(200);
    const secondTs = second.body.viewerSubmissions
      .nominationsSubmittedAt as string;
    expect(typeof secondTs).toBe('string');

    expect(new Date(secondTs).getTime()).toBeGreaterThan(
      new Date(firstTs).getTime(),
    );

    // And only one row exists (upsert, not append).
    const rows = await testApp.db.execute<{ c: number }>(
      sql`SELECT count(*)::int AS c FROM community_lineup_user_submissions WHERE lineup_id = ${lineupId} AND user_id = ${testApp.seed.adminUser.id}`,
    );
    expect(Number(rows[0]?.c ?? 0)).toBe(1);
  });

  // -- Edge: phase mismatch -------------------------------------------------

  it('POST /lineups/:id/submit-votes returns 403 when the lineup is still building', async () => {
    const createRes = await createPublicLineup(adminToken);
    const lineupId = createRes.body.id as number;
    const [game] = await createGames(1);
    await nominate(adminToken, lineupId, game.id);

    const res = await testApp.request
      .post(`/lineups/${lineupId}/submit-votes`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});

    expect(res.status).toBe(403);
  });

  it('POST /lineups/:id/submit-nominations returns 403 when the lineup is in voting', async () => {
    const createRes = await createPublicLineup(adminToken);
    const lineupId = createRes.body.id as number;
    const games = await createGames(2);
    for (const g of games) await nominate(adminToken, lineupId, g.id);
    await advanceToVoting(lineupId, adminToken);

    const res = await testApp.request
      .post(`/lineups/${lineupId}/submit-nominations`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});

    expect(res.status).toBe(403);
  });

  // -- Edge: private lineup non-invitee -------------------------------------

  it('POST /lineups/:id/submit-nominations returns 403 for a non-invitee on a private lineup', async () => {
    const invitee = await createMember('priv-invitee');
    const outsider = await createMember('priv-outsider');

    const createRes = await createPrivateLineup(adminToken, [invitee.userId]);
    expect(createRes.status).toBe(201);
    const lineupId = createRes.body.id as number;

    const res = await testApp.request
      .post(`/lineups/${lineupId}/submit-nominations`)
      .set('Authorization', `Bearer ${outsider.token}`)
      .send({});

    expect(res.status).toBe(403);
  });
}

describe(
  'Lineup submit endpoints (ROK-1296, integration)',
  describeLineupSubmit,
);
