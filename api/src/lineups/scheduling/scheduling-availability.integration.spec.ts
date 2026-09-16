/**
 * ROK-1570 — GET /lineups/:lineupId/schedule/:matchId/availability?weekStart=
 *
 * The aggregate heatmap was built from recurring game-time TEMPLATES only, so
 * it painted a member FREE at an hour they were already signed up for. The
 * subtraction is dated, which makes three things only testable against a real
 * database:
 *
 * 1. The signup **status** filter is SQL-side (`inArray(status, ACTIVE_SIGNUP_STATUSES)`)
 *    — the unit tests mock the query away entirely, so only this tier proves a
 *    `declined` signup releases the hour and a `signed_up` one does not.
 * 2. The `events.duration` **tsrange overlap** (`&&`) is Postgres, not JS.
 * 3. `game_time_absences` is a `date`-typed inclusive range compared as strings.
 * 4. (review) `events.cancelled_at IS NULL` — cancelling stamps the EVENT, the
 *    signup row keeps `signed_up`, so only a real row proves the join filters it.
 * 5. (review) `?tzOffset=` keys the busy hours in the viewer's local clock, and
 *    the SQL week bounds shift with it. Only a real tsrange proves both.
 *
 * The fixture week is a fixed PAST Sunday so it can never collide with the
 * "garbage weekStart falls back to the current week" case.
 */
import * as bcrypt from 'bcrypt';
import { eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import { truncateAllTables } from '../../common/testing/integration-helpers';
import * as schema from '../../drizzle/schema';
import { generatePublicSlug } from '../public-lineup-slug.helpers';

/** Sunday 00:00 UTC — grid day 0. */
const WEEK_START = '2026-03-01T00:00:00.000Z';
/** The Sunday after it — same recurring templates, no event. */
const NEXT_WEEK_START = '2026-03-08T00:00:00.000Z';
/** Tuesday of WEEK_START = grid day 2. Template table day 1 (0 = Monday). */
const TUESDAY_GRID_DAY = 2;
const TUESDAY_TEMPLATE_DAY = 1;
/** 20:30–22:15 occupies hours 21 and 22 — a partial first hour is not busy. */
const EVENT_START = '2026-03-03T20:30:00.000Z';
const EVENT_END = '2026-03-03T22:15:00.000Z';
/**
 * The SAME local window for a UTC-5 viewer: Tue 20:30–22:15 local is stored on
 * WEDNESDAY in UTC. Keyed in UTC it is `3:2`/`3:3` and nothing is subtracted
 * from the Tuesday template — the defect this offset exists to fix.
 */
const CT_EVENT_START = '2026-03-04T01:30:00.000Z';
const CT_EVENT_END = '2026-03-04T03:15:00.000Z';
/** `Date.getTimezoneOffset()` for UTC-5, as the browser reports it. */
const CT_OFFSET = '300';

interface AvailabilityCell {
  dayOfWeek: number;
  hour: number;
  availableCount: number;
  staleCount: number;
  unknownCount: number;
  totalCount: number;
  /** ROK-1584 — templated members committed elsewhere at this hour. */
  busyCount: number;
}

/** Sunday 00:00 UTC of the week containing `now` — the server's default week. */
function currentWeekStartIso(): string {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - start.getUTCDay());
  return start.toISOString();
}

function describeSchedulingAvailability() {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await getTestApp();
  });

  afterEach(async () => {
    testApp.seed = await truncateAllTables(testApp.db);
  });

  async function createUser(
    suffix: string,
  ): Promise<{ id: number; token: string }> {
    const email = `avail-${suffix}@test.local`;
    const hash = await bcrypt.hash('AvailPass1!', 4);
    const [user] = await testApp.db
      .insert(schema.users)
      .values({
        discordId: `discord:avail-${suffix}`,
        username: `avail-${suffix}`,
        role: 'member',
        // Confirmed just now, so the member counts as FRESH (not stale) and
        // therefore lands in `availableCount` rather than `staleCount`.
        gameTimeConfirmedAt: new Date(),
      })
      .returning();
    await testApp.db.insert(schema.localCredentials).values({
      email,
      passwordHash: hash,
      userId: user.id,
    });
    const res = await testApp.request
      .post('/auth/local')
      .send({ email, password: 'AvailPass1!' });
    return { id: user.id, token: res.body.access_token as string };
  }

  async function seedPoll(
    creatorId: number,
  ): Promise<{ lineupId: number; matchId: number }> {
    const [lineup] = await testApp.db
      .insert(schema.communityLineups)
      .values({
        title: `Availability Poll ${generatePublicSlug()}`,
        createdBy: creatorId,
        status: 'decided',
        visibility: 'public',
        publicSlug: generatePublicSlug(),
        includeSchedulingPhase: true,
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
    await testApp.db.insert(schema.communityLineupMatchMembers).values({
      matchId: match.id,
      userId: creatorId,
      source: 'voted',
    });
    return { lineupId: lineup.id, matchId: match.id };
  }

  /** Tuesday 20:00 and 21:00, every week — the hours under test. */
  async function setTuesdayEveningTemplate(userId: number): Promise<void> {
    await testApp.db.insert(schema.gameTimeTemplates).values([
      { userId, dayOfWeek: TUESDAY_TEMPLATE_DAY, startHour: 20 },
      { userId, dayOfWeek: TUESDAY_TEMPLATE_DAY, startHour: 21 },
    ]);
  }

  /** An event over Tuesday 20:30–22:15 of the fixture week, plus B's signup. */
  async function signUpForTuesdayEvent(
    userId: number,
    status: 'signed_up' | 'tentative' | 'declined',
    window: { start: string; end: string } = {
      start: EVENT_START,
      end: EVENT_END,
    },
  ): Promise<{ signupId: number; eventId: number }> {
    const [event] = await testApp.db
      .insert(schema.events)
      .values({
        title: 'ROK-1570 fixture raid',
        creatorId: userId,
        gameId: testApp.seed.game.id,
        duration: [new Date(window.start), new Date(window.end)],
      })
      .returning();
    const [signup] = await testApp.db
      .insert(schema.eventSignups)
      .values({ eventId: event.id, userId, status })
      .returning();
    return { signupId: signup.id, eventId: event.id };
  }

  interface Fixture {
    lineupId: number;
    matchId: number;
    token: string;
    memberBId: number;
  }

  /**
   * Two templated members on Tuesday 20:00 + 21:00 — A (the creator, who also
   * views) and B, who is signed up for the 20:30–22:15 event.
   */
  async function seedTwoTemplatedMembers(
    suffix: string,
    status: 'signed_up' | 'tentative' | 'declined' = 'signed_up',
    window?: { start: string; end: string },
  ): Promise<Fixture & { signupId: number; eventId: number }> {
    const memberA = await createUser(`${suffix}-a`);
    const memberB = await createUser(`${suffix}-b`);
    const { lineupId, matchId } = await seedPoll(memberA.id);
    await testApp.db
      .insert(schema.communityLineupMatchMembers)
      .values({ matchId, userId: memberB.id, source: 'added' });
    await setTuesdayEveningTemplate(memberA.id);
    await setTuesdayEveningTemplate(memberB.id);
    const { signupId, eventId } = await signUpForTuesdayEvent(
      memberB.id,
      status,
      window,
    );
    return {
      lineupId,
      matchId,
      token: memberA.token,
      memberBId: memberB.id,
      signupId,
      eventId,
    };
  }

  /**
   * `tzOffset` is explicit everywhere: `'0'` (the server default) means the
   * assertions below read in UTC hours, so the one local-clock case cannot be
   * confused for the norm.
   */
  function getAvailability(
    fixture: Fixture,
    weekStart?: string,
    tzOffset = '0',
  ) {
    const req = testApp.request
      .get(
        `/lineups/${fixture.lineupId}/schedule/${fixture.matchId}/availability`,
      )
      .set('Authorization', `Bearer ${fixture.token}`);
    return weekStart === undefined
      ? req.query({ tzOffset })
      : req.query({ weekStart, tzOffset });
  }

  /** The Tuesday cell for `hour`, or undefined if nobody is templated there. */
  function cellAt(body: unknown, hour: number): AvailabilityCell | undefined {
    const { cells } = body as { cells: AvailabilityCell[] };
    return cells.find(
      (c) => c.dayOfWeek === TUESDAY_GRID_DAY && c.hour === hour,
    );
  }

  // ── The reported bug ──────────────────────────────────────────

  // Pre-change this returned availableCount 2 at hour 21: both members were
  // painted free at an hour one of them was already signed up for.
  it('does not count a member as available at an hour they are signed up for', async () => {
    const fixture = await seedTwoTemplatedMembers('signed');

    const res = await getAvailability(fixture, WEEK_START);

    expect(res.status).toBe(200);
    expect(res.body.weekStart).toBe(WEEK_START);
    // 20:30 starts mid-hour, so 20:00 is still free for BOTH members.
    expect(cellAt(res.body, 20)?.availableCount).toBe(2);
    // 21:00 is inside the event — only member A is free.
    expect(cellAt(res.body, 21)?.availableCount).toBe(1);
    // Busy is not unknown: B still has a template.
    expect(cellAt(res.body, 21)?.unknownCount).toBe(0);
    expect(res.body.untemplatedMembers).toBe(0);
    expect(res.body.totalMembers).toBe(2);
  });

  // ROK-1584: the subtraction used to be invisible over the wire — the cell
  // just got thinner. `busyCount` names the member the poll cannot schedule.
  it('reports the signed-up member as busy on the hour they occupy', async () => {
    const fixture = await seedTwoTemplatedMembers('busycount');

    const res = await getAvailability(fixture, WEEK_START);

    expect(res.status).toBe(200);
    // 21:00 is inside the event: B is busy, so A alone is free.
    expect(cellAt(res.body, 21)?.busyCount).toBe(1);
    expect(cellAt(res.body, 21)?.availableCount).toBe(1);
    // 20:00 starts before the event does — nobody is busy, both are free.
    expect(cellAt(res.body, 20)?.busyCount).toBe(0);
    expect(cellAt(res.body, 20)?.availableCount).toBe(2);
    // Busy members are still counted in the roster, never as unknown.
    expect(cellAt(res.body, 21)?.totalCount).toBe(2);
    expect(cellAt(res.body, 21)?.unknownCount).toBe(0);
  });

  it('normalises a mid-week weekStart to the Sunday that starts it', async () => {
    const fixture = await seedTwoTemplatedMembers('midweek');

    // Wednesday of the fixture week — same week, expressed awkwardly.
    const res = await getAvailability(fixture, '2026-03-04T17:45:00.000Z');

    expect(res.status).toBe(200);
    expect(res.body.weekStart).toBe(WEEK_START);
    expect(cellAt(res.body, 21)?.availableCount).toBe(1);
  });

  // ── The SQL-side status filter the unit tests mock away ───────

  it('releases the hour when the signup is declined', async () => {
    const fixture = await seedTwoTemplatedMembers('declined');

    const busy = await getAvailability(fixture, WEEK_START);
    expect(busy.body.cells).toBeDefined();
    expect(cellAt(busy.body, 21)?.availableCount).toBe(1);

    await testApp.db
      .update(schema.eventSignups)
      .set({ status: 'declined' })
      .where(eq(schema.eventSignups.id, fixture.signupId));

    const free = await getAvailability(fixture, WEEK_START);

    expect(free.status).toBe(200);
    // `declined` has released the slot — B is schedulable at 21:00 again.
    expect(cellAt(free.body, 21)?.availableCount).toBe(2);
  });

  it('treats a tentative signup as occupying the hour', async () => {
    const fixture = await seedTwoTemplatedMembers('tentative', 'tentative');

    const res = await getAvailability(fixture, WEEK_START);

    expect(res.status).toBe(200);
    expect(cellAt(res.body, 21)?.availableCount).toBe(1);
  });

  // ── Cancelled events (review fix) ─────────────────────────────

  // Pre-change this stayed at availableCount 1: cancelling stamps
  // events.cancelled_at and leaves the signup `signed_up`, so a cancelled raid
  // blocked the very hour the poll was trying to reschedule into.
  it('frees the hour again once the event is cancelled', async () => {
    const fixture = await seedTwoTemplatedMembers('cancelled');

    const busy = await getAvailability(fixture, WEEK_START);
    expect(cellAt(busy.body, 21)?.availableCount).toBe(1);

    await testApp.db
      .update(schema.events)
      .set({ cancelledAt: new Date(), cancellationReason: 'ROK-1570 fixture' })
      .where(eq(schema.events.id, fixture.eventId));

    const free = await getAvailability(fixture, WEEK_START);

    expect(free.status).toBe(200);
    expect(cellAt(free.body, 21)?.availableCount).toBe(2);
  });

  // ── The viewer's local clock (review fix) ─────────────────────

  // Pre-change the UTC keys `3:2`/`3:3` never met the `2:21` template row, so
  // every evening signup in the Americas was ignored by the subtraction.
  it('subtracts a signup stored on the NEXT UTC day at the local hour', async () => {
    const fixture = await seedTwoTemplatedMembers('tz', 'signed_up', {
      start: CT_EVENT_START,
      end: CT_EVENT_END,
    });

    const local = await getAvailability(fixture, WEEK_START, CT_OFFSET);

    expect(local.status).toBe(200);
    // The calendar week the client asked for is echoed unchanged.
    expect(local.body.weekStart).toBe(WEEK_START);
    // 20:30 local starts mid-hour, so 20:00 local is still free for both.
    expect(cellAt(local.body, 20)?.availableCount).toBe(2);
    expect(cellAt(local.body, 21)?.availableCount).toBe(1);
    expect(cellAt(local.body, 21)?.unknownCount).toBe(0);

    // The SAME row read as UTC falls on Wednesday 02:00/03:00, so the Tuesday
    // cells are untouched — proof it is the offset that moved the subtraction.
    const utc = await getAvailability(fixture, WEEK_START);

    expect(cellAt(utc.body, 21)?.availableCount).toBe(2);
  });

  // ── Absences ──────────────────────────────────────────────────

  it('removes an absent member from every cell of the week', async () => {
    const fixture = await seedTwoTemplatedMembers('absent');
    await testApp.db.insert(schema.gameTimeAbsences).values({
      userId: fixture.memberBId,
      startDate: '2026-03-01',
      endDate: '2026-03-07',
      reason: 'ROK-1570 fixture travel',
    });

    const res = await getAvailability(fixture, WEEK_START);

    expect(res.status).toBe(200);
    // The absence covers the whole week, so even the hour the event misses.
    expect(cellAt(res.body, 20)?.availableCount).toBe(1);
    expect(cellAt(res.body, 21)?.availableCount).toBe(1);
    expect(cellAt(res.body, 20)?.unknownCount).toBe(0);
  });

  // ── The grid is dated ─────────────────────────────────────────

  it('counts the member available again in the FOLLOWING week', async () => {
    const fixture = await seedTwoTemplatedMembers('nextweek');

    const res = await getAvailability(fixture, NEXT_WEEK_START);

    expect(res.status).toBe(200);
    expect(res.body.weekStart).toBe(NEXT_WEEK_START);
    // Templates recur; the event does not. Both members are free.
    expect(cellAt(res.body, 20)?.availableCount).toBe(2);
    expect(cellAt(res.body, 21)?.availableCount).toBe(2);
  });

  // ── Degraded input ────────────────────────────────────────────

  it('falls back to the current week on an unparseable weekStart (no 400/500)', async () => {
    const fixture = await seedTwoTemplatedMembers('garbage');

    const res = await getAvailability(fixture, 'abc');

    expect(res.status).toBe(200);
    expect(res.body.weekStart).toBe(currentWeekStartIso());
    // The fixture event is in a fixed PAST week, so nobody is busy this week.
    expect(cellAt(res.body, 21)?.availableCount).toBe(2);
  });

  it('defaults to the current week when weekStart is omitted entirely', async () => {
    const fixture = await seedTwoTemplatedMembers('omitted');

    const res = await getAvailability(fixture);

    expect(res.status).toBe(200);
    expect(res.body.weekStart).toBe(currentWeekStartIso());
    expect(cellAt(res.body, 21)?.availableCount).toBe(2);
  });
}

describe(
  'Scheduling — dated heatmap availability (integration)',
  describeSchedulingAvailability,
);
