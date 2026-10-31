/**
 * ROK-1728 — series signup integration proof (spec §6.1, I1–I13).
 *
 * A series of 5 nights relative to "now": night 1 past, nights 2/3/5 future,
 * night 4 cancelled. Night 2 starts in 6h (inside the 23h late-cancel window),
 * nights 3/5 are days away. Every assertion carries the src mutation it must
 * catch. Times are offsets from the wall clock, far from every boundary, so
 * no fake timers are needed (the services read `new Date()` against Postgres).
 */
import { randomUUID } from 'crypto';
import { and, eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import { nonEmpty } from '../common/testing/narrow';
import * as schema from '../drizzle/schema';
import { SeriesSignupsService } from './series-signups.service';
import { SignupsService } from './signups.service';
import { EventSeriesService } from './event-series.service';
import { DiscordNotificationService } from '../notifications/discord-notification.service';
import { GuildMemberAddListener } from '../discord-bot/listeners/guild-member-add.listener';
import { fetchSignupsByEvent } from '../notifications/event-reminder.helpers';
import { createMemberAndLogin } from './signups.integration.spec-helpers';
import { insertMembershipOrConflict } from './series-signups-join.helpers';

const HOUR = 60 * 60 * 1000;
const ACTIVE = ['signed_up', 'tentative'];

let testApp: TestApp;

beforeAll(async () => {
  testApp = await getTestApp();
});

// No afterAll truncate: the shared app's pool must stay open (memory
// reference_integration_specs_no_aftersall_truncate).
afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
});

// ── helpers ─────────────────────────────────────────────────────────────────

function must<T>(value: T | null | undefined, label: string): T {
  if (value === null || value === undefined)
    throw new Error(`Expected ${label}, got ${String(value)}`);
  return value;
}

interface Series {
  groupId: string;
  n1: number;
  n2: number;
  n3: number;
  n4: number;
  n5: number;
}

async function insertNight(
  groupId: string | null,
  offsetHours: number,
  cancelled = false,
): Promise<number> {
  const start = new Date(Date.now() + offsetHours * HOUR);
  const end = new Date(start.getTime() + 3 * HOUR);
  const [event] = nonEmpty(
    await testApp.db
      .insert(schema.events)
      .values({
        title: `Series night ${offsetHours}h`,
        creatorId: testApp.seed.adminUser.id,
        duration: [start, end] as [Date, Date],
        recurrenceGroupId: groupId,
        cancelledAt: cancelled ? new Date() : null,
      })
      .returning(),
    'series night',
  );
  return event.id;
}

async function seedSeries(): Promise<Series> {
  const groupId = randomUUID();
  return {
    groupId,
    n1: await insertNight(groupId, -48),
    n2: await insertNight(groupId, 6),
    n3: await insertNight(groupId, 48),
    n4: await insertNight(groupId, 72, true),
    n5: await insertNight(groupId, 96),
  };
}

let userSeq = 0;
async function createMember(
  overrides: Partial<typeof schema.users.$inferInsert> = {},
): Promise<number> {
  userSeq += 1;
  const [user] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({
        discordId: `17280000000000${String(userSeq).padStart(4, '0')}`,
        username: `series_member_${userSeq}`,
        role: 'member',
        ...overrides,
      })
      .returning(),
    'member',
  );
  return user.id;
}

async function insertSignup(
  eventId: number,
  userId: number,
  values: Partial<typeof schema.eventSignups.$inferInsert> = {},
): Promise<typeof schema.eventSignups.$inferSelect> {
  const [row] = nonEmpty(
    await testApp.db
      .insert(schema.eventSignups)
      .values({ eventId, userId, status: 'signed_up', ...values })
      .returning(),
    'signup',
  );
  return row;
}

async function rowFor(
  eventId: number,
  userId: number,
): Promise<typeof schema.eventSignups.$inferSelect | undefined> {
  const [row] = await testApp.db
    .select()
    .from(schema.eventSignups)
    .where(
      and(
        eq(schema.eventSignups.eventId, eventId),
        eq(schema.eventSignups.userId, userId),
      ),
    );
  return row;
}

async function membershipsOf(
  userId: number,
): Promise<(typeof schema.seriesSignups.$inferSelect)[]> {
  return testApp.db
    .select()
    .from(schema.seriesSignups)
    .where(eq(schema.seriesSignups.userId, userId))
    .orderBy(schema.seriesSignups.id);
}

async function onlyMembership(
  userId: number,
): Promise<typeof schema.seriesSignups.$inferSelect> {
  const rows = await membershipsOf(userId);
  if (rows.length !== 1)
    throw new Error(`Expected 1 membership for ${userId}, got ${rows.length}`);
  return must(rows[0], 'membership');
}

const series = () => testApp.app.get(SeriesSignupsService);
const signups = () => testApp.app.get(SignupsService);
const eventSeries = () => testApp.app.get(EventSeriesService);

/** Joins from `eventId` as `userId` with an empty body. */
async function join(eventId: number, userId: number) {
  return series().join(eventId, userId, {});
}

// ── I1–I3: join materialises from the anchor forward ───────────────────────

describe('join materialises from the anchor (I1)', () => {
  it('I1: attaches the anchor in place, creates the missing future nights, skips cancelled + past', async () => {
    const s = await seedSeries();
    const { userId, token } = await createMemberAndLogin(
      testApp,
      'i1member',
      'i1member@test.local',
    );
    const [character] = nonEmpty(
      await testApp.db
        .insert(schema.characters)
        .values({ userId, gameId: testApp.seed.game.id, name: 'Anchorchar' })
        .returning(),
      'character',
    );
    const signedUpAt = new Date(Date.now() - 5 * 24 * HOUR);
    const anchorRow = await insertSignup(s.n2, userId, {
      status: 'tentative',
      characterId: character.id,
      preferredRoles: ['tank'],
      signedUpAt,
    });

    const res = await testApp.request
      .post(`/events/${s.n2}/series/signup`)
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(201);

    const membership = await onlyMembership(userId);
    const n2 = must(await rowFor(s.n2, userId), 'night 2 row');
    // mutation: skip tagSignup / attachSignups never sets series_signup_id
    expect(n2.seriesSignupId).toBe(membership.id);
    // mutation: attachSignups also sets status (→ signed_up)
    expect(n2.status).toBe('tentative');
    // mutation: attach re-creates the row via signup() (new id, new char)
    expect(n2.id).toBe(anchorRow.id);
    expect(n2.characterId).toBe(character.id);
    expect(n2.preferredRoles).toEqual(['tank']);
    expect(n2.signedUpAt.getTime()).toBe(anchorRow.signedUpAt.getTime());

    for (const night of [s.n3, s.n5]) {
      const row = must(await rowFor(night, userId), `night ${night} row`);
      // mutation: skip tagSignup after signup()
      expect(row.seriesSignupId).toBe(membership.id);
      expect(row.status).toBe('signed_up');
    }
    // mutation: drop the cancelledAt IS NULL filter (night 4 gets a row)
    expect(await rowFor(s.n4, userId)).toBeUndefined();
    // mutation: drop the now / fromStart filter (past night 1 gets a row)
    expect(await rowFor(s.n1, userId)).toBeUndefined();

    expect(res.body.attachedEventIds).toEqual([s.n2]);
    expect([...(res.body.createdEventIds as number[])].sort()).toEqual(
      [s.n3, s.n5].sort(),
    );
  });
});

describe('join audit (I1)', () => {
  it('I1: audits the join once on the anchor as series_joined', async () => {
    const s = await seedSeries();
    const userId = await createMember();
    await insertSignup(s.n2, userId);
    await join(s.n2, userId);
    const membership = await onlyMembership(userId);

    const logs = await testApp.db
      .select()
      .from(schema.activityLog)
      .where(eq(schema.activityLog.action, 'series_joined'));
    // mutation: logJoined dropped, or logged on the wrong entity / count
    expect(logs).toHaveLength(1);
    expect(logs[0]?.entityId).toBe(s.n2);
    expect(logs[0]?.actorId).toBe(userId);
    expect(logs[0]?.metadata).toEqual({
      seriesSignupId: membership.id,
      nights: 3,
    });
  });
});

describe('join keeps inactive nights and the anchor (I2–I3)', () => {
  it('I2: declined and roached_out nights stay exactly as they were, untagged, in keptEventIds', async () => {
    const s = await seedSeries();
    const userId = await createMember();
    const declined = await insertSignup(s.n3, userId, { status: 'declined' });
    const roached = await insertSignup(s.n5, userId, {
      status: 'roached_out',
      roachedOutAt: new Date(),
    });

    const res = await join(s.n2, userId);

    const n3 = must(await rowFor(s.n3, userId), 'night 3');
    const n5 = must(await rowFor(s.n5, userId), 'night 5');
    // mutation: route keep rows through signup() (ROK-1769 reactivation)
    expect(n3.status).toBe('declined');
    expect(n5.status).toBe('roached_out');
    expect(n3.id).toBe(declined.id);
    expect(n5.id).toBe(roached.id);
    // mutation: tag inactive rows
    expect(n3.seriesSignupId).toBeNull();
    expect(n5.seriesSignupId).toBeNull();
    expect([...res.keptEventIds].sort()).toEqual([s.n3, s.n5].sort());
    expect(res.createdEventIds).toEqual([s.n2]);
  });

  it('I3: joining from night 3 leaves night 2 untouched (anchor-forward)', async () => {
    const s = await seedSeries();
    const userId = await createMember();

    const res = await join(s.n3, userId);

    // mutation: fromStart dropped (night 2 would be materialised)
    expect(await rowFor(s.n2, userId)).toBeUndefined();
    expect([...res.createdEventIds].sort()).toEqual([s.n3, s.n5].sort());
  });
});

// ── I4–I7: rejections ───────────────────────────────────────────────────────

describe('join rejections (I4–I5)', () => {
  it('I4: a non-series event returns 400', async () => {
    const plain = await insertNight(null, 48);
    const { token } = await createMemberAndLogin(
      testApp,
      'i4member',
      'i4member@test.local',
    );

    const res = await testApp.request
      .post(`/events/${plain}/series/signup`)
      .set('Authorization', `Bearer ${token}`)
      .send({});

    // mutation: remove the recurrenceGroupId check in loadSeriesAnchor
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Event is not part of a series');
  });

  it.each([
    ['bannedAt', { bannedAt: new Date(), banReason: 'abuse' }],
    ['kickedAt', { kickedAt: new Date() }],
    ['deactivatedAt', { deactivatedAt: new Date() }],
  ] as const)(
    'I5: a user with %s gets 403 and no membership row',
    async (_label, overrides) => {
      const s = await seedSeries();
      const userId = await createMember(overrides);

      // mutation: delete this condition from assertEligibleUser
      await expect(join(s.n2, userId)).rejects.toMatchObject({
        status: 403,
      });
      expect(await membershipsOf(userId)).toHaveLength(0);
      expect(await rowFor(s.n2, userId)).toBeUndefined();
    },
  );
});

describe('join conflicts (I6–I7)', () => {
  it('I6: a second join is 409, one active row stays, and a direct duplicate INSERT is rejected', async () => {
    const s = await seedSeries();
    const userId = await createMember();
    await join(s.n2, userId);

    // mutation: drop the ALREADY_MEMBER pre-check (unique violation → 409 too,
    // so the count below is the real guard against a duplicate)
    await expect(join(s.n2, userId)).rejects.toMatchObject({ status: 409 });
    const active = (await membershipsOf(userId)).filter(
      (m) => m.status === 'active',
    );
    expect(active).toHaveLength(1);

    const insertDuplicate = async (): Promise<void> => {
      await testApp.db.insert(schema.seriesSignups).values({
        recurrenceGroupId: s.groupId,
        userId,
        status: 'active',
      });
    };
    // mutation: drop uq_series_signups_active
    await expect(insertDuplicate()).rejects.toThrow();
  });

  it('I6: re-join after leave is allowed (partial index WHERE status = active)', async () => {
    const s = await seedSeries();
    const userId = await createMember();
    await join(s.n2, userId);

    await series().leave(s.n2, userId);
    // leave cancelled 2/3/5, so a fresh night is the joinable one.
    const n6 = await insertNight(s.groupId, 120);
    const rejoin = await join(s.n2, userId);

    // mutation: drop the partial index WHERE (left + new active collide)
    const rows = await membershipsOf(userId);
    expect(rows.map((m) => m.status)).toEqual(['left', 'active']);
    expect(rejoin.createdEventIds).toEqual([n6]);
  });

  it('I7: every future night already inactive → 409 and no membership row', async () => {
    const s = await seedSeries();
    const userId = await createMember();
    for (const night of [s.n2, s.n3, s.n5])
      await insertSignup(night, userId, { status: 'declined' });

    // mutation: insert the membership before the NO_NIGHTS check
    await expect(join(s.n2, userId)).rejects.toMatchObject({
      status: 409,
      message: 'No upcoming nights to join',
    });
    expect(await membershipsOf(userId)).toHaveLength(0);
  });
});

// ── I8–I9: skip a night, leave the series ───────────────────────────────────

describe('skip and leave (I8–I9)', () => {
  it('I8: declining one night keeps the membership active; the 23h rule is unchanged', async () => {
    const s = await seedSeries();
    const userId = await createMember();
    await join(s.n2, userId);

    await signups().cancel(s.n3, userId);
    await signups().cancel(s.n2, userId);

    // mutation: have SignupsService.cancel end the membership
    expect((await onlyMembership(userId)).status).toBe('active');
    // mutation: series rows bypass the GRACEFUL_DECLINE_HOURS rule
    expect(must(await rowFor(s.n3, userId), 'night 3').status).toBe('declined');
    expect(must(await rowFor(s.n2, userId), 'night 2').status).toBe(
      'roached_out',
    );
    // untouched night stays in
    expect(must(await rowFor(s.n5, userId), 'night 5').status).toBe(
      'signed_up',
    );
  });

  it('I9: leave → left/user_left, cancels only tagged future rows (late on night 2), untags, past untouched', async () => {
    const s = await seedSeries();
    const userId = await createMember();
    const past = await insertSignup(s.n1, userId);
    await join(s.n2, userId);
    // A single-night signup on a later night of the same group: untagged.
    const n6 = await insertNight(s.groupId, 120);
    await insertSignup(n6, userId);

    const res = await series().leave(s.n2, userId);

    const m = await onlyMembership(userId);
    // mutation: endMembership not called / wrong reason
    expect(m.status).toBe('left');
    expect(m.endedReason).toBe('user_left');
    expect(m.endedAt).not.toBeNull();
    // mutation: invert isLateCancel / cancel skipped
    expect(must(await rowFor(s.n3, userId), 'night 3').status).toBe('declined');
    expect(must(await rowFor(s.n5, userId), 'night 5').status).toBe('declined');
    expect(must(await rowFor(s.n2, userId), 'night 2').status).toBe(
      'roached_out',
    );
    expect(res.lateCancelledEventIds).toEqual([s.n2]);
    expect([...res.cancelledEventIds].sort()).toEqual(
      [s.n2, s.n3, s.n5].sort(),
    );
    // mutation: skip clearFutureTagsForMemberships
    for (const night of [s.n2, s.n3, s.n5])
      expect((await rowFor(night, userId))?.seriesSignupId).toBeNull();
    // mutation: cancel by group instead of by tag (night 6 would be declined)
    expect(must(await rowFor(n6, userId), 'night 6').status).toBe('signed_up');
    const n1 = must(await rowFor(s.n1, userId), 'night 1');
    expect(n1.status).toBe(past.status);
    expect(n1.seriesSignupId).toBeNull();

    const logs = await testApp.db
      .select()
      .from(schema.activityLog)
      .where(eq(schema.activityLog.action, 'series_left'));
    // mutation: the series_left audit dropped
    expect(logs).toHaveLength(1);
    expect(logs[0]?.entityId).toBe(s.n2);
    expect(logs[0]?.metadata).toEqual({ seriesSignupId: m.id, cancelled: 3 });
  });

  it('I9b: leave without an active membership is 404', async () => {
    const s = await seedSeries();
    const userId = await createMember();
    await expect(series().leave(s.n2, userId)).rejects.toMatchObject({
      status: 404,
    });
  });
});

// ── I10: deactivation cascade + GuildMemberAdd ─────────────────────────────

function buildGuildMemberAddListener(): GuildMemberAddListener {
  return new GuildMemberAddListener(
    testApp.db,
    { getClient: () => null } as never,
    {
      findAdmin: jest.fn().mockResolvedValue({ id: testApp.seed.adminUser.id }),
    } as never,
    { create: jest.fn().mockResolvedValue(undefined) } as never,
  );
}

describe('deactivation (I10)', () => {
  it('I10: deactivation ends the membership as deactivated; GuildMemberAdd reactivates the user but not the membership', async () => {
    const s = await seedSeries();
    const userId = await createMember();
    await join(s.n2, userId);

    await testApp.app.get(DiscordNotificationService).deactivateUser(userId);

    const m = await onlyMembership(userId);
    // mutation: remove the endUserSeriesMemberships call from runCascade
    expect(m.status).toBe('ended');
    expect(m.endedReason).toBe('deactivated');
    for (const night of [s.n2, s.n3, s.n5]) {
      const row = must(await rowFor(night, userId), `night ${night}`);
      expect(ACTIVE).not.toContain(row.status);
      expect(row.seriesSignupId).toBeNull();
    }

    const [user] = nonEmpty(
      await testApp.db
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, userId)),
      'user',
    );
    const discordId = must(user.discordId, 'discordId');
    await (
      buildGuildMemberAddListener() as unknown as {
        handleGuildMemberAdd: (m: unknown) => Promise<void>;
      }
    ).handleGuildMemberAdd({
      user: { id: discordId, username: user.username, avatar: null },
    });

    const [after] = nonEmpty(
      await testApp.db
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, userId)),
      'user after',
    );
    expect(after.deactivatedAt).toBeNull();
    // mutation: make reactivation restore memberships
    const again = await onlyMembership(userId);
    expect(again.status).toBe('ended');
    expect(again.endedReason).toBe('deactivated');
  });
});

// ── I11–I12: series delete / cancel (D6) ────────────────────────────────────

describe('series delete and cancel (I11–I12)', () => {
  const admin = () => testApp.seed.adminUser.id;

  it('I11: delete scope=all ends memberships as series_deleted', async () => {
    const s = await seedSeries();
    const userId = await createMember();
    await join(s.n2, userId);

    await eventSeries().delete(s.n2, admin(), true, 'all');

    const m = await onlyMembership(userId);
    // mutation: drop the endMembershipsAfterSeriesOp hook in delete()
    expect(m.status).toBe('ended');
    expect(m.endedReason).toBe('series_deleted');
  });

  it('I11: delete scope=this on night 2 leaves memberships active', async () => {
    const s = await seedSeries();
    const userId = await createMember();
    await join(s.n2, userId);

    await eventSeries().delete(s.n2, admin(), true, 'this');

    // mutation: end unconditionally (skip the countRemainingNights gate)
    const m = await onlyMembership(userId);
    expect(m.status).toBe('active');
    expect(m.endedReason).toBeNull();
    expect((await rowFor(s.n3, userId))?.seriesSignupId).toBe(m.id);
  });

  it('I12: cancel this_and_following from the first future night ends memberships as series_cancelled', async () => {
    const s = await seedSeries();
    const userId = await createMember();
    await join(s.n2, userId);

    await eventSeries().cancel(s.n2, admin(), true, 'this_and_following', {});

    const m = await onlyMembership(userId);
    // mutation: drop the hook in cancel(); count cancelled events as
    // remaining (drop isNull(cancelledAt) in countRemainingNights)
    expect(m.status).toBe('ended');
    expect(m.endedReason).toBe('series_cancelled');
  });

  it('I12: cancel scope=this on night 3 leaves memberships active', async () => {
    const s = await seedSeries();
    const userId = await createMember();
    await join(s.n2, userId);

    await eventSeries().cancel(s.n3, admin(), true, 'this', {});

    // mutation: end unconditionally (skip the countRemainingNights gate)
    const m = await onlyMembership(userId);
    expect(m.status).toBe('active');
    expect(m.endedReason).toBeNull();
  });
});

// ── I13: reminders unchanged for a materialised night ───────────────────────

describe('reminders (I13)', () => {
  it('I13: the reminder query includes a materialised night and drops it after a skip', async () => {
    const s = await seedSeries();
    const userId = await createMember();
    await join(s.n2, userId);

    const before = await fetchSignupsByEvent(testApp.db, [s.n3]);
    // mutation: the series tag column breaks the reminder select
    expect(before.get(s.n3)).toContain(userId);

    await signups().cancel(s.n3, userId);

    const after = await fetchSignupsByEvent(testApp.db, [s.n3]);
    // mutation: status filter removed from fetchSignupsByEvent
    expect(after.get(s.n3) ?? []).not.toContain(userId);
  });
});

// ── review fixes: rows that appear mid-join, the 23505 → 409 map, leave failures

describe('join never resurrects a night that appeared mid-join (spec §4)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('a night declined while the join loop runs stays declined, untagged, and is reported in failed', async () => {
    const s = await seedSeries();
    const userId = await createMember();
    const svc = signups();
    const real = svc.signup.bind(svc);
    // The user declines night 5 while the loop is still creating night 2.
    jest.spyOn(svc, 'signup').mockImplementationOnce(async (...args) => {
      await insertSignup(s.n5, userId, { status: 'declined' });
      return real(...args);
    });

    const res = await join(s.n2, userId);

    // mutation: drop the findUserRowsForEvents re-read in materializeOne
    // (signup() reactivates the declined row — ROK-1769 — and it is tagged)
    const n5 = must(await rowFor(s.n5, userId), 'night 5');
    expect(n5.status).toBe('declined');
    expect(n5.seriesSignupId).toBeNull();
    expect(res.createdEventIds).not.toContain(s.n5);
    expect(res.failed).toEqual([
      { eventId: s.n5, message: 'You already had a signup on this night' },
    ]);
  });

  it('a row signup() returns from before the join is a duplicate, never tagged', async () => {
    const s = await seedSeries();
    const userId = await createMember();
    const svc = signups();
    const real = svc.signup.bind(svc);
    const before = new Date(Date.now() - 48 * HOUR);
    // The row lands after the re-read, so only the signedUpAt cutoff sees it.
    jest.spyOn(svc, 'signup').mockImplementation(async (...args) => {
      if (args[0] === s.n5)
        await insertSignup(s.n5, userId, { signedUpAt: before });
      return real(...args);
    });

    const res = await join(s.n2, userId);

    // mutation: drop the `signedUpAt < membership.joinedAt` check
    expect(
      must(await rowFor(s.n5, userId), 'night 5').seriesSignupId,
    ).toBeNull();
    expect(res.createdEventIds).not.toContain(s.n5);
    expect(res.failed.map((f) => f.eventId)).toEqual([s.n5]);
  });
});

describe('membership insert conflict (I6, 23505 → 409)', () => {
  it('a unique violation on the active membership maps to 409 ALREADY_MEMBER', async () => {
    const s = await seedSeries();
    const userId = await createMember();
    await testApp.db
      .insert(schema.seriesSignups)
      .values({ recurrenceGroupId: s.groupId, userId, status: 'active' });

    // mutation: rethrow the raw error instead of mapping isUniqueViolation
    await expect(
      insertMembershipOrConflict(testApp.db, {
        groupId: s.groupId,
        userId,
        characterId: null,
        preferredRoles: null,
      }),
    ).rejects.toMatchObject({
      status: 409,
      message: 'You are already signed up for this series',
    });
  });
});

describe('leave reports nights it could not cancel (I9c)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('a failed cancel is returned in failed, the night stays signed_up and untagged', async () => {
    const s = await seedSeries();
    const userId = await createMember();
    await join(s.n2, userId);
    const svc = signups();
    const real = svc.cancel.bind(svc);
    jest.spyOn(svc, 'cancel').mockImplementation(async (...args) => {
      if (args[0] === s.n3) throw new Error('cancel exploded');
      return real(...args);
    });

    const res = await series().leave(s.n2, userId);

    // mutation: only log the failure in cancelTaggedNights (failed stays [])
    expect(res.failed).toEqual([{ eventId: s.n3, message: 'cancel exploded' }]);
    expect([...res.cancelledEventIds].sort()).toEqual([s.n2, s.n5].sort());
    const n3 = must(await rowFor(s.n3, userId), 'night 3');
    expect(n3.status).toBe('signed_up');
    // mutation: clearFutureTagsForMemberships filters on the wrong events
    expect(n3.seriesSignupId).toBeNull();
  });
});
