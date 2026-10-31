/**
 * ROK-2024 fix round 1 — the guards on locking in an OPEN lineup poll through
 * `POST /scheduling-polls/:matchId/complete`, plus the announcement evidence
 * `scheduling-open-lockin.integration.spec.ts` does not carry.
 *
 * - A lineup match only locks in WITH an event: an event-less completion would
 *   flip it to `scheduled` with no linked event and brick the poll (400).
 * - Same authorization as the standalone path: organiser/staff only (403),
 *   404 for a private lineup the caller cannot view, staff may lock in.
 * - One-shot: a repeat completion is a 409 that announces nothing more.
 * - A time that already passed cannot be locked in (parity with the expired
 *   path's `assertSlotIsFuture`).
 * - The EVENT CREATED channel card is dispatched, and on the standalone route
 *   the slot's yes-voters get no EVENT CREATED DM while the rest do.
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
import { NotificationDedupService } from '../../notifications/notification-dedup.service';
import { DiscordBotClientService } from '../../discord-bot/discord-bot-client.service';
import { SettingsService } from '../../settings/settings.service';
import { SETTING_KEYS } from '../../drizzle/schema/app-settings';

const SLOT = new Date('2099-10-10T21:00:00.000Z');
const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
const DAY_MS = 86_400_000;

type Stance = 'yes' | 'no';

let testApp: TestApp;
let adminToken: string;
/** Spies a case installed — restored after it so nothing leaks. */
let spies: jest.SpyInstance[] = [];

/** Track `spy` for the afterEach restore. */
function track(spy: jest.SpyInstance): jest.SpyInstance {
  spies.push(spy);
  return spy;
}

beforeAll(async () => {
  testApp = await getTestApp();
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
});

afterEach(async () => {
  for (const spy of spies) spy.mockRestore();
  spies = [];
  testApp.seed = await truncateAllTables(testApp.db);
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
});

interface Login {
  token: string;
  userId: number;
}

/** A user with no login — exists to vote or be a group member. */
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

/** A logged-in user with `role`. */
async function loginAs(
  tag: string,
  role: 'member' | 'operator',
): Promise<Login> {
  const bcrypt = await import('bcrypt');
  const [user] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({ discordId: `local:${tag}@test.local`, username: tag, role })
      .returning(),
    tag,
  );
  await testApp.db.insert(schema.localCredentials).values({
    email: `${tag}@test.local`,
    passwordHash: await bcrypt.hash('MemberPass1!', 4),
    userId: user.id,
  });
  const res = await testApp.request
    .post('/auth/local')
    .send({ email: `${tag}@test.local`, password: 'MemberPass1!' });
  expect(res.status).toBe(200);
  return { token: res.body.access_token as string, userId: user.id };
}

/** Lineup-derived match on `scheduling`; admin is the organiser + a member. */
async function seedLineupMatch(
  visibility: 'public' | 'private' = 'public',
): Promise<number> {
  const [lineup] = nonEmpty(
    await testApp.db
      .insert(schema.communityLineups)
      .values({
        title: 'Lock-in guards',
        createdBy: testApp.seed.adminUser.id,
        status: 'decided',
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
  await addMember(match.id, testApp.seed.adminUser.id);
  return match.id;
}

async function addMember(matchId: number, userId: number): Promise<void> {
  await testApp.db
    .insert(schema.communityLineupMatchMembers)
    .values({ matchId, userId, source: 'voted' as const });
}

/** One slot at `at`; `votes` maps each voter to their stance. */
async function addSlot(
  matchId: number,
  votes: Array<[number, Stance]>,
  at: Date = SLOT,
): Promise<number> {
  const [slot] = nonEmpty(
    await testApp.db
      .insert(schema.communityLineupScheduleSlots)
      .values({ matchId, proposedTime: at, suggestedBy: 'user' })
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

/** The create form's first call, as admin: `POST /events {schedulingMatchId}`. */
async function postEvent(schedulingMatchId: number): Promise<number> {
  const created = await testApp.request
    .post('/events')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      title: 'Guarded Lock-in Night',
      startTime: SLOT.toISOString(),
      endTime: new Date(SLOT.getTime() + TWO_HOURS_MS).toISOString(),
      gameId: testApp.seed.game.id,
      schedulingMatchId,
    });
  expect(created.status).toBe(201);
  return created.body.id as number;
}

/** An event row created FROM poll `fromPollId` (bypasses the past-time and
 *  role checks of `POST /events`, which these cases do not exercise). */
async function insertEvent(
  creatorId: number,
  start: Date,
  fromPollId: number,
): Promise<number> {
  const [event] = nonEmpty(
    await testApp.db
      .insert(schema.events)
      .values({
        title: 'Guarded Poll Night',
        gameId: testApp.seed.game.id,
        duration: [start, new Date(start.getTime() + TWO_HOURS_MS)],
        maxAttendees: 10,
        creatorId,
        createdFromPollId: fromPollId,
      })
      .returning(),
    'event',
  );
  return event.id;
}

function complete(token: string, matchId: number, body: object) {
  return testApp.request
    .post(`/scheduling-polls/${matchId}/complete`)
    .set('Authorization', `Bearer ${token}`)
    .send(body);
}

async function matchState(matchId: number) {
  const [row] = await testApp.db
    .select({
      status: schema.communityLineupMatches.status,
      linkedEventId: schema.communityLineupMatches.linkedEventId,
    })
    .from(schema.communityLineupMatches)
    .where(eq(schema.communityLineupMatches.id, matchId));
  return row;
}

const STILL_OPEN = { status: 'scheduling', linkedEventId: null };

/** Records each EVENT CREATED announcement without running it. */
function recordAnnouncements(): jest.SpyInstance {
  return track(
    jest
      .spyOn(testApp.app.get(LineupNotificationService), 'notifyEventCreated')
      .mockResolvedValue(undefined),
  );
}

/** Announcements after a full window — for "no second one" assertions. */
async function announcementsAfterWindow(spy: jest.SpyInstance) {
  try {
    await waitFor(
      () => Promise.resolve(expect(spy.mock.calls.length).toBeGreaterThan(1)),
      3000,
    );
  } catch {
    /* no second announcement within the window — the count says so */
  }
  return spy.mock.calls.length;
}

describe('ROK-2024 open lineup lock-in guards (integration)', () => {
  it('(i) refuses an event-less lineup lock-in (400) and leaves the poll open', async () => {
    const matchId = await seedLineupMatch();
    await addSlot(matchId, [[testApp.seed.adminUser.id, 'yes']]);

    const res = await complete(adminToken, matchId, {});

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('A lineup poll locks in with an event');
    expect(await matchState(matchId)).toEqual(STILL_OPEN);
  });

  it('(ii-a) 403s a non-organiser member of a public lineup', async () => {
    const member = await loginAs('guard-member', 'member');
    const matchId = await seedLineupMatch();
    await addMember(matchId, member.userId);
    await addSlot(matchId, [[member.userId, 'yes']]);
    const eventId = await insertEvent(member.userId, SLOT, matchId);

    const res = await complete(member.token, matchId, {
      eventId,
      startTime: SLOT.toISOString(),
    });

    expect(res.status).toBe(403);
    expect(await matchState(matchId)).toEqual(STILL_OPEN);
  });

  it('(ii-b) 404s a caller who cannot view the private lineup', async () => {
    const stranger = await loginAs('guard-stranger', 'member');
    const matchId = await seedLineupMatch('private');
    await addSlot(matchId, [[testApp.seed.adminUser.id, 'yes']]);

    const res = await complete(stranger.token, matchId, {});

    expect(res.status).toBe(404);
    expect(await matchState(matchId)).toEqual(STILL_OPEN);
  });

  it('(ii-c) lets an operator lock in and links the event', async () => {
    recordAnnouncements();
    const operator = await loginAs('guard-operator', 'operator');
    const matchId = await seedLineupMatch();
    await addSlot(matchId, [[testApp.seed.adminUser.id, 'yes']]);
    const eventId = await insertEvent(operator.userId, SLOT, matchId);

    const res = await complete(operator.token, matchId, {
      eventId,
      startTime: SLOT.toISOString(),
    });

    expect(res.status).toBe(200);
    expect(await matchState(matchId)).toEqual({
      status: 'scheduled',
      linkedEventId: eventId,
    });
  });

  it('(iii) a repeat lock-in is a 409 that announces nothing more', async () => {
    const spy = recordAnnouncements();
    const matchId = await seedLineupMatch();
    await addSlot(matchId, [[testApp.seed.adminUser.id, 'yes']]);
    const eventId = await postEvent(matchId);
    const body = { eventId, startTime: SLOT.toISOString() };

    expect((await complete(adminToken, matchId, body)).status).toBe(200);
    expect((await complete(adminToken, matchId, body)).status).toBe(409);

    await waitFor(
      () => Promise.resolve(expect(spy).toHaveBeenCalledTimes(1)),
      5000,
    );
    expect(await announcementsAfterWindow(spy)).toBe(1);
  });

  it('(iv) refuses a slot whose time has passed (400) and leaves the poll open', async () => {
    const past = new Date(Date.now() - DAY_MS);
    const matchId = await seedLineupMatch();
    await addSlot(matchId, [[testApp.seed.adminUser.id, 'yes']], past);
    const eventId = await insertEvent(testApp.seed.adminUser.id, past, matchId);

    const res = await complete(adminToken, matchId, {
      eventId,
      startTime: past.toISOString(),
    });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('That time has already passed');
    expect(await matchState(matchId)).toEqual(STILL_OPEN);
  });
});

describe('ROK-2024 open lock-in announcement evidence (integration)', () => {
  /** `community_lineup` DM titles + event ids of one user. */
  async function dmsOf(userId: number) {
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
      const p = r.payload as { eventId?: unknown } | null;
      return { title: r.title, eventId: p?.eventId };
    });
  }

  function eventCreatedTitle(): string {
    return `${testApp.seed.game.name} is happening!`;
  }

  /** A second DM that never comes: poll the full window, then judge. */
  async function titlesAfterWindow(userId: number): Promise<string[]> {
    try {
      await waitFor(async () => {
        expect((await dmsOf(userId)).length).toBeGreaterThan(1);
      }, 2000);
    } catch {
      /* no second DM within the window — the rows below say so */
    }
    return (await dmsOf(userId)).map((d) => d.title);
  }

  it('(v) dispatches the EVENT CREATED channel card for the lineup match', async () => {
    const dedupSpy = track(
      jest.spyOn(testApp.app.get(NotificationDedupService), 'checkAndMarkSent'),
    );
    const matchId = await seedLineupMatch();
    await addSlot(matchId, [[testApp.seed.adminUser.id, 'yes']]);
    const eventId = await postEvent(matchId);

    const res = await complete(adminToken, matchId, {
      eventId,
      startTime: SLOT.toISOString(),
    });

    expect(res.status).toBe(200);
    await waitFor(
      () =>
        Promise.resolve(
          expect(dedupSpy).toHaveBeenCalledWith(
            `lineup-event:${matchId}`,
            expect.anything(),
          ),
        ),
      5000,
    );
  });

  it('(vi) standalone lock-in: the slot yes-voter gets no EVENT CREATED DM, a non-yes member does', async () => {
    const opened = await testApp.request
      .post('/scheduling-polls')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ gameId: testApp.seed.game.id });
    expect(opened.status).toBe(201);
    const matchId = opened.body.id as number;
    const yesVoter = await createUser('sa-dm-yes');
    const bystander = await createUser('sa-dm-bystander');
    await addMember(matchId, yesVoter);
    await addMember(matchId, bystander);
    await addSlot(matchId, [
      [testApp.seed.adminUser.id, 'yes'],
      [yesVoter, 'yes'],
      [bystander, 'no'],
    ]);
    const eventId = await postEvent(matchId);

    const res = await complete(adminToken, matchId, {
      eventId,
      startTime: SLOT.toISOString(),
    });

    expect(res.status).toBe(200);
    await waitFor(async () => {
      expect(await dmsOf(bystander)).toContainEqual({
        title: eventCreatedTitle(),
        eventId,
      });
    }, 5000);
    expect(await titlesAfterWindow(bystander)).toEqual([eventCreatedTitle()]);
    expect(await titlesAfterWindow(yesVoter)).toEqual(['Auto-signed up']);
  });
});

describe('ROK-2054 standalone lock-in posts no lineup channel card (integration)', () => {
  const DEFAULT_CHANNEL = 'rok2054-default-chan';
  const GAME_CHANNEL = 'rok2054-game-chan';

  /** Bot "connected", every channel post recorded; default + game channels. */
  async function wireDiscord(): Promise<jest.SpyInstance> {
    const client = testApp.app.get(DiscordBotClientService);
    track(jest.spyOn(client, 'isConnected').mockReturnValue(true));
    // The binding's guild, so the event's own embed resolves the game channel.
    track(jest.spyOn(client, 'getGuildId').mockReturnValue('rok2054-guild'));
    const sendEmbed = track(
      jest
        .spyOn(client, 'sendEmbed')
        .mockResolvedValue({ id: 'rok2054-msg' } as never),
    );
    await testApp.app
      .get(SettingsService)
      .set(SETTING_KEYS.DISCORD_BOT_DEFAULT_CHANNEL, DEFAULT_CHANNEL);
    await testApp.db.insert(schema.channelBindings).values({
      guildId: 'rok2054-guild',
      channelId: GAME_CHANNEL,
      channelType: 'text',
      bindingPurpose: 'game-announcements',
      gameId: testApp.seed.game.id,
    });
    return sendEmbed;
  }

  /** Channel ids `sendEmbed` posted to — after `dmUserId`'s DM proves the
   *  fan-out (which runs after the card) has finished. */
  async function postedChannels(
    sendEmbed: jest.SpyInstance,
    dmUserId: number,
    eventId: number,
  ): Promise<unknown[]> {
    await waitFor(async () => {
      const rows = await testApp.db
        .select({ payload: schema.notifications.payload })
        .from(schema.notifications)
        .where(
          and(
            eq(schema.notifications.userId, dmUserId),
            eq(schema.notifications.type, 'community_lineup'),
          ),
        );
      const ids = rows.map(
        (r) => (r.payload as { eventId?: unknown } | null)?.eventId,
      );
      expect(ids).toContain(eventId);
    }, 5000);
    return sendEmbed.mock.calls.map((c) => c[0]);
  }

  /** Every channel posted to, once the event's own game-channel embed (the
   *  only post a standalone lock-in should make) has landed. */
  async function settledChannels(
    sendEmbed: jest.SpyInstance,
  ): Promise<unknown[]> {
    const channels = () => sendEmbed.mock.calls.map((c) => c[0]);
    await waitFor(() => {
      expect(channels()).toContain(GAME_CHANNEL);
      return Promise.resolve();
    }, 5000);
    return channels();
  }

  it('standalone: no channel post to the default (or any lineup) channel; the EVENT CREATED DM still goes out', async () => {
    const sendEmbed = await wireDiscord();
    const opened = await testApp.request
      .post('/scheduling-polls')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ gameId: testApp.seed.game.id });
    expect(opened.status).toBe(201);
    const matchId = opened.body.id as number;
    const bystander = await createUser('rok2054-bystander');
    await addMember(matchId, bystander);
    await addSlot(matchId, [
      [testApp.seed.adminUser.id, 'yes'],
      [bystander, 'no'],
    ]);
    const eventId = await postEvent(matchId);

    const res = await complete(adminToken, matchId, {
      eventId,
      startTime: SLOT.toISOString(),
    });

    expect(res.status).toBe(200);
    await postedChannels(sendEmbed, bystander, eventId);
    // Every post went to the game channel (the poll's own card may land there too).
    expect(new Set(await settledChannels(sendEmbed))).toEqual(
      new Set([GAME_CHANNEL]),
    );
  });

  it('standalone, expired-path lock-in (createEventFromSlot → createLockedInEvent): no lineup card, the DM still goes out', async () => {
    const sendEmbed = await wireDiscord();
    const opened = await testApp.request
      .post('/scheduling-polls')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ gameId: testApp.seed.game.id });
    expect(opened.status).toBe(201);
    const matchId = opened.body.id as number;
    const bystander = await createUser('rok2054-expired-bystander');
    await addMember(matchId, bystander);
    const slotId = await addSlot(matchId, [
      [testApp.seed.adminUser.id, 'yes'],
      [bystander, 'no'],
    ]);

    const res = await testApp.request
      .post(`/lineups/0/schedule/${matchId}/create-event`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ slotId });

    expect(res.status).toBe(201);
    const eventId = res.body.eventId as number;
    await postedChannels(sendEmbed, bystander, eventId);
    // Every post went to the game channel (the poll's own card may land there too).
    expect(new Set(await settledChannels(sendEmbed))).toEqual(
      new Set([GAME_CHANNEL]),
    );
  });

  it('community lineup: the EVENT CREATED card still posts to the default channel', async () => {
    const sendEmbed = await wireDiscord();
    const matchId = await seedLineupMatch();
    const bystander = await createUser('rok2054-lineup-bystander');
    await addMember(matchId, bystander);
    await addSlot(matchId, [
      [testApp.seed.adminUser.id, 'yes'],
      [bystander, 'no'],
    ]);
    const eventId = await postEvent(matchId);

    const res = await complete(adminToken, matchId, {
      eventId,
      startTime: SLOT.toISOString(),
    });

    expect(res.status).toBe(200);
    expect(await postedChannels(sendEmbed, bystander, eventId)).toContain(
      DEFAULT_CHANNEL,
    );
  });
});
