/**
 * ROK-1371 — double-DM regression coverage.
 *
 * A rostered attendee who is ALSO game-interested was receiving TWO DMs after
 * an event ended: the targeted post-event follow-up DM (poll vote / quick
 * sign-up) AND the pre-existing game-interest broadcast (`community_lineup`
 * scheduling-poll DM on the poll path, `subscribed_game` affinity DM on the
 * event path). These tests prove the broadcast now SUBTRACTS the follow-up
 * recipients so an attendee gets exactly ONE DM, while a NON-attendee
 * game-interested user still gets the broadcast, and regular (non-follow-up)
 * flows are unchanged.
 *
 * Real DB (rows), real StandalonePollNotificationService /
 * GameAffinityNotificationService / NotificationService; runFollowupFanout is
 * the shared targeted fan-out.
 */
import { eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import { NotificationService } from './notification.service';
import { GameAffinityNotificationService } from './game-affinity-notification.service';
import { StandalonePollNotificationService } from '../lineups/standalone-poll/standalone-poll-notification.service';
import { runFollowupFanout } from './post-event-followup-fanout.helpers';

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
let seq = 0;
/** Synthetic new-event id per affinity call — avoids the Redis dedup key colliding across tests. */
let syntheticEventId = 900_000;

async function mkUser(testApp: TestApp) {
  seq += 1;
  const [user] = await testApp.db
    .insert(schema.users)
    .values({
      discordId: `80000000000000${String(seq).padStart(4, '0')}`,
      username: `dd${seq}`,
      role: 'member',
    })
    .returning();
  return user;
}

async function mkEndedEvent(
  testApp: TestApp,
  creatorId: number,
  gameId: number,
) {
  const [event] = await testApp.db
    .insert(schema.events)
    .values({
      title: 'Raid Night',
      creatorId,
      gameId,
      duration: [new Date(Date.now() - 3 * HOUR), new Date(Date.now() - HOUR)],
    })
    .returning();
  return event;
}

async function mkSignup(
  testApp: TestApp,
  eventId: number,
  userId: number,
  status = 'signed_up',
) {
  await testApp.db
    .insert(schema.eventSignups)
    .values({ eventId, userId, status });
}

async function mkInterest(testApp: TestApp, userId: number, gameId: number) {
  await testApp.db.insert(schema.gameInterests).values({ userId, gameId });
}

async function insertSentinel(testApp: TestApp, eventId: number) {
  await testApp.db.insert(schema.postEventFollowupSent).values({ eventId });
}

/** Notification rows for a user, optionally filtered by type. */
async function notifsFor(testApp: TestApp, userId: number, type?: string) {
  const rows = await testApp.db
    .select()
    .from(schema.notifications)
    .where(eq(schema.notifications.userId, userId));
  return type ? rows.filter((r) => r.type === type) : rows;
}

describe('ROK-1371 double-DM subtraction (integration)', () => {
  let testApp: TestApp;
  let pollNotify: StandalonePollNotificationService;
  let gameAffinity: GameAffinityNotificationService;
  let notificationService: NotificationService;

  beforeAll(async () => {
    testApp = await getTestApp();
    pollNotify = testApp.app.get(StandalonePollNotificationService);
    gameAffinity = testApp.app.get(GameAffinityNotificationService);
    notificationService = testApp.app.get(NotificationService);
  });

  afterEach(async () => {
    testApp.seed = await truncateAllTables(testApp.db);
  });

  /** Attendee (rostered + interested) + non-attendee (interested only) on one ended game event. */
  async function scenario() {
    const gameId = testApp.seed.game.id;
    const creator = await mkUser(testApp);
    const attendee = await mkUser(testApp);
    const nonAttendee = await mkUser(testApp);
    const ended = await mkEndedEvent(testApp, creator.id, gameId);
    await mkSignup(testApp, ended.id, attendee.id, 'signed_up');
    await mkInterest(testApp, attendee.id, gameId);
    await mkInterest(testApp, nonAttendee.id, gameId);
    await insertSentinel(testApp, ended.id);
    return { gameId, creator, attendee, nonAttendee, ended };
  }

  // ==================================================================
  // POLL path — community_lineup broadcast vs post_event_followup DM
  // ==================================================================
  describe('poll path', () => {
    it('attendee gets ONLY the follow-up DM; non-attendee still gets the broadcast', async () => {
      const { gameId, creator, attendee, nonAttendee, ended } =
        await scenario();

      // Follow-up poll broadcast excludes the attendee we DM directly.
      await pollNotify.notifyInterestedUsers(
        gameId,
        'Test Game',
        1,
        1,
        creator.id,
        null,
        undefined,
        [attendee.id],
      );
      // Targeted follow-up vote DM to attendees.
      await runFollowupFanout(
        { db: testApp.db, notificationService },
        ended.id,
        { lineupId: 1, matchId: 1, subtype: 'post_event_poll' },
        creator.id,
      );

      // Attendee: exactly one DM, and it is the follow-up (not the broadcast).
      expect(
        await notifsFor(testApp, attendee.id, 'community_lineup'),
      ).toHaveLength(0);
      expect(
        await notifsFor(testApp, attendee.id, 'post_event_followup'),
      ).toHaveLength(1);
      expect(await notifsFor(testApp, attendee.id)).toHaveLength(1);
      // Non-attendee: exactly the broadcast, no follow-up.
      expect(
        await notifsFor(testApp, nonAttendee.id, 'community_lineup'),
      ).toHaveLength(1);
      expect(
        await notifsFor(testApp, nonAttendee.id, 'post_event_followup'),
      ).toHaveLength(0);
    });

    it('regression: a regular poll (no exclude set) broadcasts to ALL interested users', async () => {
      const { gameId, creator, attendee, nonAttendee } = await scenario();

      await pollNotify.notifyInterestedUsers(
        gameId,
        'Test Game',
        1,
        1,
        creator.id,
      );

      expect(
        await notifsFor(testApp, attendee.id, 'community_lineup'),
      ).toHaveLength(1);
      expect(
        await notifsFor(testApp, nonAttendee.id, 'community_lineup'),
      ).toHaveLength(1);
    });
  });

  // ==================================================================
  // EVENT path — subscribed_game affinity broadcast
  // ==================================================================
  describe('event path (game-affinity)', () => {
    function affinityInput(
      gameId: number,
      creatorId: number,
      followupForEventId?: number,
    ) {
      syntheticEventId += 1;
      return {
        eventId: syntheticEventId,
        eventTitle: 'Follow-up Raid',
        gameName: 'Test Game',
        gameId,
        startTime: new Date(Date.now() + DAY).toISOString(),
        endTime: new Date(Date.now() + DAY + HOUR).toISOString(),
        creatorId,
        ...(followupForEventId != null ? { followupForEventId } : {}),
      };
    }

    it('followupForEventId subtracts the attendee; non-attendee still gets subscribed_game', async () => {
      const { gameId, creator, attendee, nonAttendee, ended } =
        await scenario();

      await gameAffinity.notifyGameAffinity(
        affinityInput(gameId, creator.id, ended.id),
      );

      expect(
        await notifsFor(testApp, attendee.id, 'subscribed_game'),
      ).toHaveLength(0);
      expect(
        await notifsFor(testApp, nonAttendee.id, 'subscribed_game'),
      ).toHaveLength(1);
    });

    it('regression: a normal event (no followupForEventId) alerts ALL interested users', async () => {
      const { gameId, creator, attendee, nonAttendee } = await scenario();

      await gameAffinity.notifyGameAffinity(affinityInput(gameId, creator.id));

      expect(
        await notifsFor(testApp, attendee.id, 'subscribed_game'),
      ).toHaveLength(1);
      expect(
        await notifsFor(testApp, nonAttendee.id, 'subscribed_game'),
      ).toHaveLength(1);
    });
  });
});
