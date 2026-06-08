/**
 * ROK-1219 — cancel-poll voter-notification integration tests (F-38).
 *
 * Failing TDD tests that pin down the spec for the enhanced
 * `POST /lineups/:lineupId/schedule/:matchId/cancel` endpoint. Every test
 * fails today because:
 *   - the controller takes NO body (no `reason` parse / no 400 on >500),
 *   - `cancelPoll` only flips the match to `archived` and dispatches NO
 *     notifications (voters get silence today),
 *   - `CancelSchedulePollSchema` does not exist yet,
 *   - `SchedulingModule` does not import `NotificationModule`.
 *
 * Coverage (one `it` per AC / edge case, see spec §Acceptance Criteria
 * + §Edge Cases):
 *   AC4 — cancel WITH reason → match archived; each matched member except
 *         the actor receives a `community_lineup` notification, subtype
 *         `scheduling_poll_cancelled`, message contains game name + reason,
 *         payload carries the reason. Actor excluded.
 *   AC5 — cancel WITHOUT reason → message has no "Reason:" suffix; payload
 *         reason is null.
 *   AC6 — reason > 500 chars → 400; match stays unarchived.
 *   Edge — reason exactly 500 chars accepted (200).
 *   Edge — match with only the actor as member → no notifications, still 200.
 *   Edge — non-operator member → 403 (existing RolesGuard, unchanged).
 */
import { eq, and } from 'drizzle-orm';
import { Logger } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../../common/testing/integration-helpers';
import * as schema from '../../drizzle/schema';
import { NotificationService } from '../../notifications/notification.service';
import { generatePublicSlug } from '../public-lineup-slug.helpers';
import { archiveAndNotifyCancel } from './scheduling-cancel.helpers';

describe('Cancel scheduling poll — voter notifications (integration, ROK-1219)', () => {
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

  // ── helpers ────────────────────────────────────────────────────────

  /** Create a member user (+ local creds) and return id + login token. */
  async function createMember(
    suffix: string,
    role: 'member' | 'operator' = 'member',
  ): Promise<{ id: number; token: string }> {
    const email = `cancel-${suffix}@test.local`;
    const hash = await bcrypt.hash('CancelPass1!', 4);
    const [user] = await testApp.db
      .insert(schema.users)
      .values({
        discordId: `local:${email}`,
        username: `cancel-${suffix}`,
        role,
      })
      .returning();
    await testApp.db.insert(schema.localCredentials).values({
      email,
      passwordHash: hash,
      userId: user.id,
    });
    const res = await testApp.request
      .post('/auth/local')
      .send({ email, password: 'CancelPass1!' });
    return { id: user.id, token: res.body.access_token as string };
  }

  /**
   * Seed a schedulable match for the seeded game with the given member ids
   * as matched members. Returns lineupId + matchId.
   */
  async function seedMatchWithMembers(
    memberIds: number[],
  ): Promise<{ lineupId: number; matchId: number }> {
    const [lineup] = await testApp.db
      .insert(schema.communityLineups)
      .values({
        title: 'Cancel Poll Lineup',
        createdBy: testApp.seed.adminUser.id,
        publicSlug: generatePublicSlug(),
      })
      .returning();
    const [match] = await testApp.db
      .insert(schema.communityLineupMatches)
      .values({
        lineupId: lineup.id,
        gameId: testApp.seed.game.id,
        status: 'scheduling',
        thresholdMet: true,
        voteCount: memberIds.length,
      })
      .returning();
    if (memberIds.length > 0) {
      await testApp.db.insert(schema.communityLineupMatchMembers).values(
        memberIds.map((userId) => ({
          matchId: match.id,
          userId,
          source: 'voted' as const,
        })),
      );
    }
    return { lineupId: lineup.id, matchId: match.id };
  }

  async function postCancel(
    token: string,
    lineupId: number,
    matchId: number,
    body?: Record<string, unknown>,
  ) {
    const req = testApp.request
      .post(`/lineups/${lineupId}/schedule/${matchId}/cancel`)
      .set('Authorization', `Bearer ${token}`);
    return body === undefined ? req.send() : req.send(body);
  }

  /** Fetch the scheduling-poll-cancelled notifications for a user. */
  async function findCancelNotifications(userId: number) {
    return testApp.db
      .select()
      .from(schema.notifications)
      .where(
        and(
          eq(schema.notifications.userId, userId),
          eq(schema.notifications.type, 'community_lineup'),
        ),
      );
  }

  async function matchStatus(matchId: number): Promise<string> {
    const [row] = await testApp.db
      .select()
      .from(schema.communityLineupMatches)
      .where(eq(schema.communityLineupMatches.id, matchId));
    return row.status;
  }

  // ── AC4 — cancel WITH reason notifies members, excludes actor ──────

  it('cancel with reason archives match + notifies each member except the actor', async () => {
    const voter1 = await createMember('voter1');
    const voter2 = await createMember('voter2');
    // The actor (admin) is also a matched member to prove they are excluded.
    const { lineupId, matchId } = await seedMatchWithMembers([
      voter1.id,
      voter2.id,
      testApp.seed.adminUser.id,
    ]);

    const reason = 'Not enough interest this week.';
    const res = await postCancel(adminToken, lineupId, matchId, { reason });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true });

    expect(await matchStatus(matchId)).toBe('archived');

    // Both voters get exactly one community_lineup notification.
    for (const voter of [voter1, voter2]) {
      const notifs = await findCancelNotifications(voter.id);
      expect(notifs).toHaveLength(1);
      const n = notifs[0];
      expect(n.payload).toMatchObject({
        subtype: 'scheduling_poll_cancelled',
        matchId,
        lineupId,
        reason,
      });
      // Message carries the game name AND the reason.
      expect(n.message).toContain(testApp.seed.game.name);
      expect(n.message).toContain(reason);
    }

    // Actor (admin) is excluded — no cancel notification for them.
    const actorNotifs = await findCancelNotifications(
      testApp.seed.adminUser.id,
    );
    expect(
      actorNotifs.filter(
        (n) =>
          (n.payload as { subtype?: string } | null)?.subtype ===
          'scheduling_poll_cancelled',
      ),
    ).toHaveLength(0);
  });

  // ── AC5 — cancel WITHOUT reason omits the "Reason:" suffix ─────────

  it('cancel without reason → no "Reason:" suffix and payload reason null', async () => {
    const voter = await createMember('noreason');
    const { lineupId, matchId } = await seedMatchWithMembers([voter.id]);

    const res = await postCancel(adminToken, lineupId, matchId);
    expect(res.status).toBe(200);
    expect(await matchStatus(matchId)).toBe('archived');

    const notifs = await findCancelNotifications(voter.id);
    expect(notifs).toHaveLength(1);
    const n = notifs[0];
    expect(n.message).not.toMatch(/Reason:/i);
    expect(n.message).toContain(testApp.seed.game.name);
    expect((n.payload as { reason?: unknown }).reason).toBeNull();
  });

  // ── Edge — empty/whitespace reason behaves as no reason ────────────

  it('whitespace-only reason → treated as no reason (no suffix, payload null)', async () => {
    const voter = await createMember('whitespace');
    const { lineupId, matchId } = await seedMatchWithMembers([voter.id]);

    const res = await postCancel(adminToken, lineupId, matchId, {
      reason: '   ',
    });
    expect(res.status).toBe(200);

    const notifs = await findCancelNotifications(voter.id);
    expect(notifs).toHaveLength(1);
    expect(notifs[0].message).not.toMatch(/Reason:/i);
    expect((notifs[0].payload as { reason?: unknown }).reason).toBeNull();
  });

  // ── AC6 — reason > 500 chars rejected with 400 ────────────────────

  it('reason longer than 500 chars returns 400 and does not archive', async () => {
    const voter = await createMember('toolong');
    const { lineupId, matchId } = await seedMatchWithMembers([voter.id]);

    const res = await postCancel(adminToken, lineupId, matchId, {
      reason: 'x'.repeat(501),
    });
    expect(res.status).toBe(400);

    // Match is untouched, no notifications dispatched.
    expect(await matchStatus(matchId)).toBe('scheduling');
    expect(await findCancelNotifications(voter.id)).toHaveLength(0);
  });

  // ── Edge — reason exactly 500 chars accepted ──────────────────────

  it('reason exactly 500 chars is accepted (200)', async () => {
    const voter = await createMember('exactly500');
    const { lineupId, matchId } = await seedMatchWithMembers([voter.id]);

    const res = await postCancel(adminToken, lineupId, matchId, {
      reason: 'y'.repeat(500),
    });
    expect(res.status).toBe(200);
    expect(await matchStatus(matchId)).toBe('archived');
  });

  // ── Edge — match with only the actor → no notifications, still 200 ─

  it('match whose only member is the actor → cancels with zero notifications', async () => {
    const { lineupId, matchId } = await seedMatchWithMembers([
      testApp.seed.adminUser.id,
    ]);

    const res = await postCancel(adminToken, lineupId, matchId, {
      reason: 'solo',
    });
    expect(res.status).toBe(200);
    expect(await matchStatus(matchId)).toBe('archived');

    const actorNotifs = await findCancelNotifications(
      testApp.seed.adminUser.id,
    );
    expect(
      actorNotifs.filter(
        (n) =>
          (n.payload as { subtype?: string } | null)?.subtype ===
          'scheduling_poll_cancelled',
      ),
    ).toHaveLength(0);
  });

  // ── Edge — non-operator member → 403 (RolesGuard unchanged) ───────

  it('non-operator member POST returns 403 and does not archive', async () => {
    const member = await createMember('forbidden');
    const { lineupId, matchId } = await seedMatchWithMembers([member.id]);

    const res = await postCancel(member.token, lineupId, matchId, {
      reason: 'nope',
    });
    expect(res.status).toBe(403);
    expect(await matchStatus(matchId)).toBe('scheduling');
  });

  // ── Concurrency — only the winning archive transition notifies ────
  // Two cancels can both pass `assertSchedulable` before either UPDATE lands;
  // the conditional archive means only the request that flips the row to
  // `archived` dispatches notifications, so voters never get duplicate DMs.
  it('a second archive attempt dispatches no duplicate notifications', async () => {
    const voter = await createMember('race-voter');
    const { lineupId, matchId } = await seedMatchWithMembers([voter.id]);

    const notifications = testApp.app.get(NotificationService);
    const deps = {
      db: testApp.db,
      notifications,
      logger: new Logger('cancel-race-test'),
    };
    const match = { id: matchId, lineupId, gameId: testApp.seed.game.id };

    // The loser's conditional UPDATE matches 0 rows (status already archived),
    // so it returns before dispatching — voter gets exactly one notification.
    await archiveAndNotifyCancel(
      deps,
      match,
      testApp.seed.adminUser.id,
      'race',
    );
    await archiveAndNotifyCancel(
      deps,
      match,
      testApp.seed.adminUser.id,
      'race',
    );

    expect(await matchStatus(matchId)).toBe('archived');
    const notifs = await findCancelNotifications(voter.id);
    expect(
      notifs.filter(
        (n) =>
          (n.payload as { subtype?: string } | null)?.subtype ===
          'scheduling_poll_cancelled',
      ),
    ).toHaveLength(1);
  });
});
