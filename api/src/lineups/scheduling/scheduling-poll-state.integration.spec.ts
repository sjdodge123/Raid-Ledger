/**
 * ROK-1545 (P1-3) — the poll page answers "what happened to this poll?".
 *
 * Before this story GET /lineups/:lineupId/schedule/:matchId said nothing
 * about WHY a poll was read-only: lock-in, an operator cancellation and a
 * silently expired phase all rendered the same "Voting is closed." banner
 * (audit F-01/F-02/F-04). The response now carries four fields —
 * `pollStatus`, `lockedInTime`, `cancelReason`, `canVote` — derived by
 * `resolvePollTerminalState` from the match AND its parent lineup together.
 *
 * These tests pin the wire contract end-to-end, through the real controller
 * and a real DB, for every point on the lifecycle:
 *   (a) open      — `pollStatus 'open'`, `canVote true`, `lockedInTime null`
 *   (b) locked_in — `lockedInTime` is the linked event's start, `canVote false`
 *   (c) cancelled — `cancelReason` persisted on the match and returned
 *   (d) closed    — the EXPIRED shape from prod (match 49 / lineup 26): the
 *                   lineup-phase job archived the LINEUP and left the match
 *                   on `scheduling` with no linked event
 *   (e) canVote   — private lineup hides the affordance from a non-invitee;
 *                   a public lineup keeps it (voting self-enrols, deliberate)
 *   (f) joinedAt  — the viewer's member row names when they joined, for the
 *                   late-joiner catch-up line (F-05)
 */
import { eq, sql } from 'drizzle-orm';
import * as bcrypt from 'bcrypt';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../../common/testing/integration-helpers';
import * as schema from '../../drizzle/schema';
import { generatePublicSlug } from '../public-lineup-slug.helpers';

describe('Scheduling poll page — terminal states (integration, ROK-1545)', () => {
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
  async function createUser(
    suffix: string,
  ): Promise<{ id: number; token: string }> {
    const email = `pollstate-${suffix}@test.local`;
    const hash = await bcrypt.hash('PollStatePass1!', 4);
    const [user] = await testApp.db
      .insert(schema.users)
      .values({
        discordId: `local:${email}`,
        username: `pollstate-${suffix}`,
        role: 'member',
      })
      .returning();
    await testApp.db.insert(schema.localCredentials).values({
      email,
      passwordHash: hash,
      userId: user.id,
    });
    const res = await testApp.request
      .post('/auth/local')
      .send({ email, password: 'PollStatePass1!' });
    return { id: user.id, token: res.body.access_token as string };
  }

  interface SeededPoll {
    lineupId: number;
    matchId: number;
    slotId: number;
    slotTime: Date;
  }

  /** Seed an OPEN poll (lineup `decided`, match `scheduling`, one slot). */
  async function seedOpenPoll(
    visibility: 'public' | 'private' = 'public',
    extraMemberIds: number[] = [],
  ): Promise<SeededPoll> {
    const [lineup] = await testApp.db
      .insert(schema.communityLineups)
      .values({
        title: 'Terminal State Poll',
        createdBy: testApp.seed.adminUser.id,
        status: 'decided',
        visibility,
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
        voteCount: 1,
      })
      .returning();
    await testApp.db.insert(schema.communityLineupMatchMembers).values(
      [testApp.seed.adminUser.id, ...extraMemberIds].map((userId) => ({
        matchId: match.id,
        userId,
        source: 'voted' as const,
      })),
    );
    const slotTime = new Date('2099-04-01T19:00:00.000Z');
    const [slot] = await testApp.db
      .insert(schema.communityLineupScheduleSlots)
      .values({ matchId: match.id, proposedTime: slotTime, suggestedBy: 'system' })
      .returning();
    return {
      lineupId: lineup.id,
      matchId: match.id,
      slotId: slot.id,
      slotTime,
    };
  }

  /** GET the poll page as `token` (omit for an anonymous viewer). */
  function getPoll(poll: SeededPoll, token?: string) {
    const req = testApp.request.get(
      `/lineups/${poll.lineupId}/schedule/${poll.matchId}`,
    );
    return token ? req.set('Authorization', `Bearer ${token}`) : req;
  }

  /**
   * Lock the poll in through the real path: the caller must have voted for
   * the slot (`assertUserHasVoted`) before create-event will accept it.
   */
  async function lockIn(poll: SeededPoll, token: string): Promise<number> {
    const vote = await testApp.request
      .post(`/lineups/${poll.lineupId}/schedule/${poll.matchId}/vote`)
      .set('Authorization', `Bearer ${token}`)
      .send({ slotId: poll.slotId });
    expect(vote.status).toBe(200);
    const res = await testApp.request
      .post(`/lineups/${poll.lineupId}/schedule/${poll.matchId}/create-event`)
      .set('Authorization', `Bearer ${token}`)
      .send({ slotId: poll.slotId });
    expect(res.status).toBe(201);
    return res.body.eventId as number;
  }

  // ── (a) open ───────────────────────────────────────────────────────

  it('an open poll reports pollStatus=open, canVote=true and no terminal detail', async () => {
    const poll = await seedOpenPoll();

    const res = await getPoll(poll, adminToken);

    expect(res.status).toBe(200);
    expect(res.body.pollStatus).toBe('open');
    expect(res.body.canVote).toBe(true);
    expect(res.body.lockedInTime).toBeNull();
    expect(res.body.cancelReason).toBeNull();
  });

  it('an anonymous viewer of an open poll gets canVote=false (nothing to vote with)', async () => {
    const poll = await seedOpenPoll();

    const res = await getPoll(poll);

    expect(res.status).toBe(200);
    expect(res.body.pollStatus).toBe('open');
    expect(res.body.canVote).toBe(false);
  });

  // ── (b) locked in ──────────────────────────────────────────────────

  it('after lock-in reports pollStatus=locked_in, lockedInTime = the event start, canVote=false', async () => {
    const poll = await seedOpenPoll();

    const eventId = await lockIn(poll, adminToken);

    const res = await getPoll(poll, adminToken);

    expect(res.status).toBe(200);
    expect(res.body.pollStatus).toBe('locked_in');
    // The linked event's start — not the top-voted slot — is the answer to
    // "when is it?", because lock-in is free to pick any slot.
    const [event] = await testApp.db
      .select({ start: sql<string>`lower(${schema.events.duration})` })
      .from(schema.events)
      .where(eq(schema.events.id, eventId));
    expect(res.body.lockedInTime).not.toBeNull();
    expect(res.body.lockedInTime).toBe(new Date(event.start).toISOString());
    // NOT asserted against `poll.slotTime`: `events.duration` is a naive
    // tsrange, so the stored start is the slot time shifted by the runner's
    // TZ offset. That shift is the events-service's business (pre-existing,
    // unchanged by ROK-1545) — what this story owns is that the page reports
    // the EVENT's start rather than the top-voted slot.
    expect(res.body.canVote).toBe(false);
    expect(res.body.match.linkedEventId).toBe(eventId);
  });

  // ── (c) cancelled ──────────────────────────────────────────────────

  it('a cancelled poll reports pollStatus=cancelled and returns the persisted reason', async () => {
    const poll = await seedOpenPoll();
    const reason = 'Half the group is away for the holiday.';

    const cancel = await testApp.request
      .post(`/lineups/${poll.lineupId}/schedule/${poll.matchId}/cancel`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason });
    expect(cancel.status).toBe(200);

    // Persisted on the match row (migration 0184), not just in the notification.
    const [match] = await testApp.db
      .select()
      .from(schema.communityLineupMatches)
      .where(eq(schema.communityLineupMatches.id, poll.matchId));
    expect(match.cancellationReason).toBe(reason);

    const res = await getPoll(poll, adminToken);

    expect(res.status).toBe(200);
    expect(res.body.pollStatus).toBe('cancelled');
    expect(res.body.cancelReason).toBe(reason);
    expect(res.body.lockedInTime).toBeNull();
    expect(res.body.canVote).toBe(false);
  });

  it('a poll cancelled without a reason reports pollStatus=cancelled and cancelReason=null', async () => {
    const poll = await seedOpenPoll();

    const cancel = await testApp.request
      .post(`/lineups/${poll.lineupId}/schedule/${poll.matchId}/cancel`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});
    expect(cancel.status).toBe(200);

    const res = await getPoll(poll, adminToken);

    expect(res.body.pollStatus).toBe('cancelled');
    expect(res.body.cancelReason).toBeNull();
  });

  // ── (d) expired ────────────────────────────────────────────────────

  it('an EXPIRED poll (lineup archived, match still scheduling, no event) reports pollStatus=closed', async () => {
    const poll = await seedOpenPoll();
    // The prod shape (match 49 / lineup 26): the lineup-phase job archives the
    // LINEUP and never touches the match — only reading both together shows it.
    await testApp.db
      .update(schema.communityLineups)
      .set({ status: 'archived' })
      .where(eq(schema.communityLineups.id, poll.lineupId));

    const res = await getPoll(poll, adminToken);

    expect(res.status).toBe(200);
    const [match] = await testApp.db
      .select()
      .from(schema.communityLineupMatches)
      .where(eq(schema.communityLineupMatches.id, poll.matchId));
    expect(match.status).toBe('scheduling');
    expect(match.linkedEventId).toBeNull();
    expect(res.body.pollStatus).toBe('closed');
    expect(res.body.canVote).toBe(false);
    expect(res.body.cancelReason).toBeNull();
    expect(res.body.lockedInTime).toBeNull();
  });

  it('a poll whose phase deadline has passed reports pollStatus=closed', async () => {
    const poll = await seedOpenPoll();
    await testApp.db
      .update(schema.communityLineups)
      .set({ phaseDeadline: new Date(Date.now() - 60 * 60 * 1000) })
      .where(eq(schema.communityLineups.id, poll.lineupId));

    const res = await getPoll(poll, adminToken);

    expect(res.body.pollStatus).toBe('closed');
    expect(res.body.canVote).toBe(false);
  });

  // ── (e) canVote on private vs public ───────────────────────────────

  it('a non-invitee of a PRIVATE lineup gets canVote=false (their vote would 403)', async () => {
    const outsider = await createUser('private-outsider');
    const poll = await seedOpenPoll('private');

    const res = await getPoll(poll, outsider.token);

    expect(res.status).toBe(200);
    expect(res.body.pollStatus).toBe('open');
    expect(res.body.canVote).toBe(false);
  });

  it('an invitee of a PRIVATE lineup gets canVote=true', async () => {
    const invitee = await createUser('private-invitee');
    const poll = await seedOpenPoll('private');
    await testApp.db
      .insert(schema.communityLineupInvitees)
      .values({ lineupId: poll.lineupId, userId: invitee.id });

    const res = await getPoll(poll, invitee.token);

    expect(res.body.canVote).toBe(true);
  });

  it('a non-member of a PUBLIC lineup gets canVote=true — voting self-enrols them', async () => {
    const outsider = await createUser('public-outsider');
    const poll = await seedOpenPoll('public');

    const res = await getPoll(poll, outsider.token);

    expect(res.status).toBe(200);
    expect(res.body.canVote).toBe(true);
    // …and the affordance is honest: the vote really is accepted.
    const vote = await testApp.request
      .post(`/lineups/${poll.lineupId}/schedule/${poll.matchId}/vote`)
      .set('Authorization', `Bearer ${outsider.token}`)
      .send({ slotId: poll.slotId });
    expect(vote.status).toBe(200);
  });

  it('canVote is false on a LOCKED-IN private lineup even for the creator', async () => {
    const poll = await seedOpenPoll('private');
    await lockIn(poll, adminToken);

    const res = await getPoll(poll, adminToken);

    expect(res.body.pollStatus).toBe('locked_in');
    expect(res.body.canVote).toBe(false);
  });

  // ── (f) joinedAt on the viewer's member row ────────────────────────

  it("the viewer's member row carries joinedAt for the late-joiner catch-up line", async () => {
    const latecomer = await createUser('latecomer');
    const poll = await seedOpenPoll('public', [latecomer.id]);

    const res = await getPoll(poll, latecomer.token);

    expect(res.status).toBe(200);
    const mine = (
      res.body.match.members as { userId: number; joinedAt: string }[]
    ).find((m) => m.userId === latecomer.id);
    expect(mine).toBeDefined();
    expect(typeof mine!.joinedAt).toBe('string');
    expect(Number.isNaN(Date.parse(mine!.joinedAt))).toBe(false);
  });
});
