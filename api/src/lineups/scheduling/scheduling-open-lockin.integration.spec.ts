/**
 * ROK-2024 — locking in an OPEN scheduling poll.
 *
 * The web create form locks in an open poll with two calls: `POST /events
 * {schedulingMatchId}` then `POST /scheduling-polls/:matchId/complete`. Before
 * the fix, `complete` 404'd for a REGULAR lineup match (never linked, still
 * `scheduling`, yes-voters not signed up) and no open lock-in ever fired the
 * lineup EVENT CREATED announcement; only the expired lock-in
 * (`POST /lineups/:id/schedule/:matchId/create-event`) did.
 *
 * Each path must announce exactly once, after the slot voters' signups landed
 * — except a reschedule poll, whose event already exists.
 */
import { and, eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
  waitFor,
} from '../../common/testing/integration-helpers';
import * as schema from '../../drizzle/schema';
import { generatePublicSlug } from '../public-lineup-slug.helpers';
import { nonEmpty } from '../../common/testing/narrow';
import { LineupNotificationService } from '../lineup-notification.service';

const SLOT = new Date('2099-10-10T21:00:00.000Z');
const SLOT_END = new Date('2099-10-10T23:00:00.000Z');

type Stance = 'yes' | 'no';

describe('ROK-2024 open lock-in (integration)', () => {
  let testApp: TestApp;
  let adminToken: string;
  let spy: jest.SpyInstance;
  /** Signup count on the announced event at the moment of each announcement. */
  let signupsAtAnnounce: number[];

  beforeAll(async () => {
    testApp = await getTestApp();
    adminToken = await loginAsAdmin(testApp.request, testApp.seed);
  });

  beforeEach(() => {
    signupsAtAnnounce = [];
    spy = jest
      .spyOn(testApp.app.get(LineupNotificationService), 'notifyEventCreated')
      .mockImplementation(async (_match, _date, eventId) => {
        signupsAtAnnounce.push(
          eventId === undefined ? -1 : (await signupUserIds(eventId)).length,
        );
      });
  });

  afterEach(async () => {
    spy.mockRestore();
    testApp.seed = await truncateAllTables(testApp.db);
    adminToken = await loginAsAdmin(testApp.request, testApp.seed);
  });

  async function signupUserIds(eventId: number): Promise<number[]> {
    const rows = await testApp.db
      .select({ userId: schema.eventSignups.userId })
      .from(schema.eventSignups)
      .where(eq(schema.eventSignups.eventId, eventId));
    return rows.flatMap((r) => (r.userId === null ? [] : [r.userId]));
  }

  async function createUser(tag: string): Promise<number> {
    const [user] = nonEmpty(
      await testApp.db
        .insert(schema.users)
        .values({ discordId: `local:${tag}@test.local`, username: tag })
        .returning(),
      tag,
    );
    return user.id;
  }

  /** One slot at SLOT; `votes` maps each voter to their stance. */
  async function addSlot(
    matchId: number,
    votes: Array<[number, Stance]>,
  ): Promise<number> {
    const [slot] = nonEmpty(
      await testApp.db
        .insert(schema.communityLineupScheduleSlots)
        .values({ matchId, proposedTime: SLOT, suggestedBy: 'user' })
        .returning(),
      'slot',
    );
    await testApp.db
      .insert(schema.communityLineupScheduleVotes)
      .values(
        votes.map(([userId, stance]) => ({ slotId: slot.id, userId, stance })),
      );
    return slot.id;
  }

  /** Lineup-derived match on `scheduling`; admin is the organiser. */
  async function seedLineupMatch(
    lineupStatus: 'archived' | 'decided',
    visibility: 'public' | 'private' = 'public',
  ): Promise<{ lineupId: number; matchId: number }> {
    const [lineup] = nonEmpty(
      await testApp.db
        .insert(schema.communityLineups)
        .values({
          title: 'Open lock-in',
          createdBy: testApp.seed.adminUser.id,
          status: lineupStatus,
          visibility,
          publicSlug: generatePublicSlug(),
        })
        .returning(),
      'lineup',
    );
    const [match] = nonEmpty(
      await testApp.db
        .insert(schema.communityLineupMatches)
        .values({
          lineupId: lineup.id,
          gameId: testApp.seed.game.id,
          status: 'scheduling',
          thresholdMet: true,
          voteCount: 1,
        })
        .returning(),
      'match',
    );
    await testApp.db.insert(schema.communityLineupMatchMembers).values({
      matchId: match.id,
      userId: testApp.seed.adminUser.id,
      source: 'voted' as const,
    });
    return { lineupId: lineup.id, matchId: match.id };
  }

  async function createEvent(schedulingMatchId?: number): Promise<number> {
    const created = await testApp.request
      .post('/events')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        title: 'Open Lock-in Night',
        startTime: SLOT.toISOString(),
        endTime: SLOT_END.toISOString(),
        gameId: testApp.seed.game.id,
        ...(schedulingMatchId === undefined ? {} : { schedulingMatchId }),
      });
    expect(created.status).toBe(201);
    return created.body.id as number;
  }

  async function complete(matchId: number, eventId: number): Promise<number> {
    const done = await testApp.request
      .post(`/scheduling-polls/${matchId}/complete`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ eventId, startTime: SLOT.toISOString() });
    return done.status;
  }

  async function waitForSignupOf(eventId: number, userId: number) {
    await waitFor(async () => {
      expect(await signupUserIds(eventId)).toContain(userId);
    }, 5000);
  }

  /** An announcement that never comes: poll the full window, then judge. */
  async function announcementsAfterWindow(): Promise<number> {
    try {
      await waitFor(
        () => Promise.resolve(expect(spy).toHaveBeenCalled()),
        3000,
      );
    } catch {
      /* none within the window — the count below says so */
    }
    return spy.mock.calls.length;
  }

  /** EVENT CREATED DM title — the poll DMs share its `lineup_event_created`
   *  subtype, so the title is what tells them apart. */
  function eventCreatedTitle(): string {
    return `${testApp.seed.game.name} is happening!`;
  }

  /** Let the real announcement run (the default spy only records it). */
  function callThrough(): void {
    spy.mockRestore();
    spy = jest.spyOn(
      testApp.app.get(LineupNotificationService),
      'notifyEventCreated',
    );
  }

  async function addMember(matchId: number, userId: number): Promise<void> {
    await testApp.db
      .insert(schema.communityLineupMatchMembers)
      .values({ matchId, userId, source: 'voted' as const });
  }

  async function invite(lineupId: number, userId: number): Promise<void> {
    await testApp.db
      .insert(schema.communityLineupInvitees)
      .values({ lineupId, userId, invitedBy: testApp.seed.adminUser.id });
  }

  /** `community_lineup` DM rows of one user: title + payload subtype. */
  async function dmsOf(
    userId: number,
  ): Promise<Array<{ title: string; subtype: unknown; eventId: unknown }>> {
    const rows = await testApp.db
      .select({
        title: schema.notifications.title,
        payload: schema.notifications.payload,
      })
      .from(schema.notifications)
      .where(
        and(
          eq(schema.notifications.userId, userId),
          eq(schema.notifications.type, 'community_lineup'),
        ),
      );
    return rows.map((r) => {
      const p = r.payload as { subtype?: unknown; eventId?: unknown } | null;
      return { title: r.title, subtype: p?.subtype, eventId: p?.eventId };
    });
  }

  async function waitForEventCreatedDm(userId: number, eventId: number) {
    await waitFor(async () => {
      expect(await dmsOf(userId)).toContainEqual(
        expect.objectContaining({ title: eventCreatedTitle(), eventId }),
      );
    }, 5000);
  }

  /** A second DM that never comes: poll the full window, then judge. */
  async function dmsAfterWindow(userId: number) {
    try {
      await waitFor(async () => {
        expect((await dmsOf(userId)).length).toBeGreaterThan(1);
      }, 2000);
    } catch {
      /* no second DM within the window — the rows below say so */
    }
    return dmsOf(userId);
  }

  it('(a) expired lock-in announces exactly once', async () => {
    const poll = await seedLineupMatch('archived');
    const slotId = await addSlot(poll.matchId, [
      [testApp.seed.adminUser.id, 'yes'],
    ]);
    const res = await testApp.request
      .post(`/lineups/${poll.lineupId}/schedule/${poll.matchId}/create-event`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ slotId });
    expect(res.status).toBe(201);
    await waitFor(
      () => Promise.resolve(expect(spy).toHaveBeenCalledTimes(1)),
      5000,
    );
    expect(await announcementsAfterWindow()).toBe(1);
    expect(spy.mock.calls[0]?.[2]).toBe(res.body.eventId);
  });

  it('(b) open lineup lock-in links the match, signs up yes-voters only, announces once', async () => {
    const poll = await seedLineupMatch('decided');
    const yesVoter = await createUser('yesvoter');
    const noVoter = await createUser('novoter');
    await addSlot(poll.matchId, [
      [testApp.seed.adminUser.id, 'yes'],
      [yesVoter, 'yes'],
      [noVoter, 'no'],
    ]);
    const eventId = await createEvent(poll.matchId);
    expect(await complete(poll.matchId, eventId)).toBe(200);

    const [match] = await testApp.db
      .select({
        status: schema.communityLineupMatches.status,
        linkedEventId: schema.communityLineupMatches.linkedEventId,
      })
      .from(schema.communityLineupMatches)
      .where(eq(schema.communityLineupMatches.id, poll.matchId));
    expect(match).toEqual({ status: 'scheduled', linkedEventId: eventId });
    const [lineup] = await testApp.db
      .select({ status: schema.communityLineups.status })
      .from(schema.communityLineups)
      .where(eq(schema.communityLineups.id, poll.lineupId));
    expect(lineup?.status).toBe('decided');

    await waitForSignupOf(eventId, yesVoter);
    await waitFor(
      () => Promise.resolve(expect(spy).toHaveBeenCalledTimes(1)),
      5000,
    );
    expect(await announcementsAfterWindow()).toBe(1);
    const signups = await signupUserIds(eventId);
    expect(signups).toEqual(
      expect.arrayContaining([testApp.seed.adminUser.id, yesVoter]),
    );
    expect(signups).not.toContain(noVoter);
    expect(spy.mock.calls[0]?.[2]).toBe(eventId);
    expect(signupsAtAnnounce).toEqual([signups.length]);
  });

  it('(c) open standalone lock-in announces once, after the signups', async () => {
    const opened = await testApp.request
      .post('/scheduling-polls')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ gameId: testApp.seed.game.id });
    expect(opened.status).toBe(201);
    const matchId = opened.body.id as number;
    const yesVoter = await createUser('standaloneyes');
    await addSlot(matchId, [
      [testApp.seed.adminUser.id, 'yes'],
      [yesVoter, 'yes'],
    ]);
    const eventId = await createEvent(matchId);
    expect(await complete(matchId, eventId)).toBe(200);

    await waitForSignupOf(eventId, yesVoter);
    await waitFor(
      () => Promise.resolve(expect(spy).toHaveBeenCalledTimes(1)),
      5000,
    );
    expect(await announcementsAfterWindow()).toBe(1);
    expect(spy.mock.calls[0]?.[2]).toBe(eventId);
    expect(signupsAtAnnounce).toEqual([(await signupUserIds(eventId)).length]);
  });

  it('(d) a reschedule poll lock-in does not announce', async () => {
    const eventId = await createEvent();
    const opened = await testApp.request
      .post('/scheduling-polls')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ gameId: testApp.seed.game.id, linkedEventId: eventId });
    expect(opened.status).toBe(201);
    const matchId = opened.body.id as number;
    const yesVoter = await createUser('rescheduleyes');
    await addSlot(matchId, [[yesVoter, 'yes']]);
    expect(await complete(matchId, eventId)).toBe(200);

    await waitForSignupOf(eventId, yesVoter);
    expect(await announcementsAfterWindow()).toBe(0);
  });

  it('(e) open lineup lock-in: yes-voters get only the poll DM, the rest of the group gets EVENT CREATED', async () => {
    callThrough();
    const poll = await seedLineupMatch('decided');
    const yesVoter = await createUser('dm-yes');
    const bystander = await createUser('dm-bystander');
    await addMember(poll.matchId, yesVoter);
    await addMember(poll.matchId, bystander);
    await addSlot(poll.matchId, [
      [testApp.seed.adminUser.id, 'yes'],
      [yesVoter, 'yes'],
      [bystander, 'no'],
    ]);
    const eventId = await createEvent(poll.matchId);
    expect(await complete(poll.matchId, eventId)).toBe(200);

    await waitForEventCreatedDm(bystander, eventId);
    expect((await dmsOf(bystander)).map((d) => d.title)).toEqual([
      eventCreatedTitle(),
    ]);
    for (const uid of [yesVoter, testApp.seed.adminUser.id]) {
      const dms = await dmsAfterWindow(uid);
      expect({ uid, titles: dms.map((d) => d.title) }).toEqual({
        uid,
        titles: ['Auto-signed up'],
      });
    }
  });

  it('(f) expired lock-in still DMs the whole group EVENT CREATED', async () => {
    callThrough();
    const poll = await seedLineupMatch('archived');
    const yesVoter = await createUser('exp-yes');
    const bystander = await createUser('exp-bystander');
    await addMember(poll.matchId, yesVoter);
    await addMember(poll.matchId, bystander);
    const slotId = await addSlot(poll.matchId, [
      [testApp.seed.adminUser.id, 'yes'],
      [yesVoter, 'yes'],
    ]);
    const res = await testApp.request
      .post(`/lineups/${poll.lineupId}/schedule/${poll.matchId}/create-event`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ slotId });
    expect(res.status).toBe(201);
    const eventId = res.body.eventId as number;

    await waitForEventCreatedDm(yesVoter, eventId);
    await waitForEventCreatedDm(bystander, eventId);
  });

  it('(g) open PRIVATE lineup lock-in: invitee yes-voters get only the poll DM, other invitees get EVENT CREATED, non-invitees nothing', async () => {
    callThrough();
    const poll = await seedLineupMatch('decided', 'private');
    const yesVoter = await createUser('priv-yes');
    const invitee = await createUser('priv-invitee');
    const outsider = await createUser('priv-outsider');
    await invite(poll.lineupId, yesVoter);
    await invite(poll.lineupId, invitee);
    // The outsider is in the match group (the public route would DM them)
    // but not on the invitee list, so the private route must skip them.
    for (const uid of [yesVoter, invitee, outsider]) {
      await addMember(poll.matchId, uid);
    }
    await addSlot(poll.matchId, [
      [testApp.seed.adminUser.id, 'yes'],
      [yesVoter, 'yes'],
    ]);
    const eventId = await createEvent(poll.matchId);
    expect(await complete(poll.matchId, eventId)).toBe(200);

    await waitForEventCreatedDm(invitee, eventId);
    expect((await dmsOf(invitee)).map((d) => d.title)).toEqual([
      eventCreatedTitle(),
    ]);
    for (const uid of [yesVoter, testApp.seed.adminUser.id]) {
      const dms = await dmsAfterWindow(uid);
      expect({ uid, titles: dms.map((d) => d.title) }).toEqual({
        uid,
        titles: ['Auto-signed up'],
      });
    }
    expect((await dmsOf(outsider)).map((d) => d.title)).toEqual([]);
  });
});
