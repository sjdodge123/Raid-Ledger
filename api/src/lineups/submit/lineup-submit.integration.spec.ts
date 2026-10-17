/**
 * Integration tests for the U4 SubmitBar write path (ROK-1296).
 *
 * Endpoint under test: POST /lineups/:id/submit-votes, which stamps
 * `votes_submitted_at` on the (lineup, user) `community_lineup_user_submissions`
 * row.
 *
 * Covered:
 *   - AC2b — the write path stamps `votes_submitted_at`.
 *   - AC5 — re-submitting overwrites the stamp (ON CONFLICT upsert, one row).
 *   - Edge: phase mismatch → 403 for vote-in-building.
 *   - Edge: private lineup non-invitee → 403 (participation gate).
 *   - TDB:449 — POST /lineups/:id/submit-nominations is retired → 404.
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
import { parseTimestampUtc } from '../../drizzle/timestamp-utils';
import { at, nonEmpty } from '../../common/testing/narrow';

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
    const [user] = nonEmpty(
      await testApp.db
        .insert(schema.users)
        .values({
          discordId: `local:${tag}@submit.local`,
          username: tag,
          role: 'member',
        })
        .returning(),
      'user',
    );
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
      const [game] = nonEmpty(
        await testApp.db
          .insert(schema.games)
          .values({
            name: `Submit Game ${i + 1}`,
            slug: `submit-game-${i + 1}-${Date.now()}-${Math.random()
              .toString(36)
              .slice(2, 7)}`,
          })
          .returning(),
        'game',
      );
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
    await vote(member.token, lineupId, at(games, 0).id);

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

  // -- AC5 — re-submission overwrites the stamp; one row per (lineup, user) --

  it('re-submitting votes overwrites the existing timestamp with a later one and keeps one row (AC5)', async () => {
    const voter = await createMember('resubmit-voter');
    // A second invitee who never submits keeps the voting quorum unmet, so
    // the lineup stays in voting between the two submits.
    const idle = await createMember('resubmit-idle');
    const createRes = await createPrivateLineup(adminToken, [
      voter.userId,
      idle.userId,
    ]);
    expect(createRes.status).toBe(201);
    const lineupId = createRes.body.id as number;
    const games = await createGames(2);
    for (const g of games) await nominate(adminToken, lineupId, g.id);
    expect((await advanceToVoting(lineupId, adminToken)).status).toBe(200);

    const submitVotes = () =>
      testApp.request
        .post(`/lineups/${lineupId}/submit-votes`)
        .set('Authorization', `Bearer ${voter.token}`)
        .send({});

    expect((await submitVotes()).status).toBe(200);
    // Backdate the first stamp so "later" is deterministic without a sleep.
    // `now()` is the same clock the endpoint stamps with, so both values sit
    // in the session zone's wall clock and compare like for like.
    await testApp.db.execute(sql`
      UPDATE community_lineup_user_submissions
         SET votes_submitted_at = now() - interval '1 hour'
       WHERE lineup_id = ${lineupId} AND user_id = ${voter.userId}
    `);
    const backdated = await readSubmission(lineupId, voter.userId);
    // The raw read returns the zone-less column as a naive string; a bare
    // `new Date()` parses it in the host's TZ and skewed this by the runner's
    // UTC offset (fleet TZ=America/Denver). Parse it as UTC like the app does.
    const firstMs = parseTimestampUtc(backdated!.votes_submitted_at!).getTime();

    const second = await submitVotes();
    expect(second.status).toBe(200);
    const secondTs = second.body.viewerSubmissions.votesSubmittedAt as string;
    // A fresh stamp lands ~1h after the backdated one; an un-overwritten
    // stamp would echo the backdated value back (equal, not later).
    expect(new Date(secondTs).getTime() - firstMs).toBeGreaterThan(
      59 * 60 * 1000,
    );
    const stored = await readSubmission(lineupId, voter.userId);
    expect(
      parseTimestampUtc(stored!.votes_submitted_at!).getTime(),
    ).toBeGreaterThan(firstMs);

    const rows = await testApp.db.execute<{ c: number }>(
      sql`SELECT count(*)::int AS c FROM community_lineup_user_submissions WHERE lineup_id = ${lineupId} AND user_id = ${voter.userId}`,
    );
    expect(Number(rows[0]?.c ?? 0)).toBe(1);
  });

  // -- Edge: phase mismatch -------------------------------------------------

  it('POST /lineups/:id/submit-votes returns 403 when the lineup is still building', async () => {
    const createRes = await createPublicLineup(adminToken);
    const lineupId = createRes.body.id as number;
    const [game] = nonEmpty(await createGames(1), 'game');
    await nominate(adminToken, lineupId, game.id);

    const res = await testApp.request
      .post(`/lineups/${lineupId}/submit-votes`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});

    expect(res.status).toBe(403);
  });

  // -- Edge: private lineup non-invitee -------------------------------------

  it('POST /lineups/:id/submit-votes returns 403 for a non-invitee on a private lineup and writes nothing', async () => {
    const invitee = await createMember('priv-invitee');
    const outsider = await createMember('priv-outsider');
    const createRes = await createPrivateLineup(adminToken, [invitee.userId]);
    expect(createRes.status).toBe(201);
    const lineupId = createRes.body.id as number;
    const games = await createGames(2);
    for (const g of games) await nominate(adminToken, lineupId, g.id);
    expect((await advanceToVoting(lineupId, adminToken)).status).toBe(200);

    const res = await testApp.request
      .post(`/lineups/${lineupId}/submit-votes`)
      .set('Authorization', `Bearer ${outsider.token}`)
      .send({});

    expect(res.status).toBe(403);
    expect(await readSubmission(lineupId, outsider.userId)).toBeNull();
  });

  // -- TDB:449 — the nominations submit route is retired --------------------

  it('POST /lineups/:id/submit-nominations returns 404 and writes nothing (route retired)', async () => {
    const createRes = await createPublicLineup(adminToken);
    expect(createRes.status).toBe(201);
    const lineupId = createRes.body.id as number;
    const [game] = nonEmpty(await createGames(1), 'game');
    await nominate(adminToken, lineupId, game.id);

    const res = await testApp.request
      .post(`/lineups/${lineupId}/submit-nominations`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});

    expect(res.status).toBe(404);
    expect(
      await readSubmission(lineupId, testApp.seed.adminUser.id),
    ).toBeNull();
  });
}

describe(
  'Lineup submit endpoints (ROK-1296, integration)',
  describeLineupSubmit,
);
