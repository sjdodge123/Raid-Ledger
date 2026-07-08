/**
 * ROK-1371 — Post-event follow-up: recipient resolver (M1) + cron candidate
 * detection (M2) integration tests.
 *
 * TDD RED (written before implementation). This file imports from
 * `./post-event-followup.helpers`, which does not exist yet, and inserts into
 * the `post_event_followup_sent` table, whose migration does not exist yet.
 * Until the dev creates BOTH, the suite fails to load (fails-by-construction).
 * Once they exist, every test below runs green against a real Postgres DB.
 *
 * Scope (per the TDD brief): the two core, deterministic backend units —
 *   M1  resolvePostEventFollowupRecipients (who gets a quick-signup DM)
 *   M2  findFollowupCandidateEvents        (which ended events get a prompt)
 * Discord-UI, web smoke, and the service-level ON CONFLICT prompt fan-out are
 * intentionally deferred to the later coverage audit.
 */
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import { sql } from 'drizzle-orm';
import {
  resolvePostEventFollowupRecipients,
  findFollowupCandidateEvents,
} from './post-event-followup.helpers';

const MIN = 60 * 1000;
const HOUR = 60 * MIN;

// Monotonic, never-reset counter → unique (UNIQUE-constrained) discord_id per
// created user, even across truncate cycles.
let discordSeq = 0;

/** Insert a linked user with a real-snowflake-shaped discord_id by default. */
async function mkUser(
  testApp: TestApp,
  overrides: Partial<typeof schema.users.$inferInsert> = {},
) {
  discordSeq += 1;
  const [user] = await testApp.db
    .insert(schema.users)
    .values({
      discordId: `70000000000000${String(discordSeq).padStart(4, '0')}`,
      username: `u${discordSeq}`,
      role: 'member',
      ...overrides,
    })
    .returning();
  return user;
}

/** Insert an event. Defaults to a plain past event (not in the cron window). */
async function mkEvent(
  testApp: TestApp,
  creatorId: number,
  overrides: Partial<typeof schema.events.$inferInsert> = {},
) {
  const [event] = await testApp.db
    .insert(schema.events)
    .values({
      title: 'Ended Event',
      creatorId,
      duration: [new Date(Date.now() - 3 * HOUR), new Date(Date.now() - HOUR)],
      ...overrides,
    })
    .returning();
  return event;
}

/** duration whose upper bound (raw event end) sits inside the 14–16min window. */
function endedFifteenMinAgo(): [Date, Date] {
  return [new Date(Date.now() - 3 * HOUR), new Date(Date.now() - 15 * MIN)];
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

async function mkAnonSignup(
  testApp: TestApp,
  eventId: number,
  discordUserId: string,
) {
  await testApp.db.insert(schema.eventSignups).values({
    eventId,
    userId: null,
    discordUserId,
    status: 'signed_up',
  });
}

/** Opt a user out of post_event_followup Discord delivery (raw jsonb prefs). */
async function optOutFollowupDiscord(testApp: TestApp, userId: number) {
  await testApp.db.execute(sql`
    INSERT INTO user_notification_preferences (user_id, channel_prefs)
    VALUES (${userId}, ${'{"post_event_followup":{"inApp":true,"push":false,"discord":false}}'}::jsonb)
  `);
}

/** Stamp a dedup/single-fire row so the event is no longer a fresh candidate. */
async function markFollowupSent(testApp: TestApp, eventId: number) {
  await testApp.db.execute(
    sql`INSERT INTO post_event_followup_sent (event_id) VALUES (${eventId})`,
  );
}

const candidateIds = async (testApp: TestApp): Promise<number[]> =>
  (await findFollowupCandidateEvents(testApp.db)).map(
    (c: { id: number }) => c.id,
  );

describe('Post-event follow-up helpers (integration)', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await getTestApp();
  });

  afterEach(async () => {
    testApp.seed = await truncateAllTables(testApp.db);
  });

  // =================================================================
  // M1 — resolvePostEventFollowupRecipients
  // =================================================================
  describe('M1 recipient resolver', () => {
    it('M1-AC1: includes signed_up/tentative/roached_out/departed, excludes declined', async () => {
      const creator = await mkUser(testApp);
      const a = await mkUser(testApp);
      const b = await mkUser(testApp);
      const c = await mkUser(testApp);
      const d = await mkUser(testApp);
      const e = await mkUser(testApp);
      const ev = await mkEvent(testApp, creator.id);
      await mkSignup(testApp, ev.id, a.id, 'signed_up');
      await mkSignup(testApp, ev.id, b.id, 'tentative');
      await mkSignup(testApp, ev.id, c.id, 'declined');
      await mkSignup(testApp, ev.id, d.id, 'roached_out');
      await mkSignup(testApp, ev.id, e.id, 'departed');
      const result = await resolvePostEventFollowupRecipients(
        testApp.db,
        ev.id,
        creator.id,
      );
      expect([...result].sort((x, y) => x - y)).toEqual(
        [a.id, b.id, d.id, e.id].sort((x, y) => x - y),
      );
    });

    it('M1-AC2: the organizer (events.creatorId) is excluded even with a signup row', async () => {
      const creator = await mkUser(testApp);
      const a = await mkUser(testApp);
      const ev = await mkEvent(testApp, creator.id);
      await mkSignup(testApp, ev.id, creator.id, 'signed_up');
      await mkSignup(testApp, ev.id, a.id, 'signed_up');
      const result = await resolvePostEventFollowupRecipients(
        testApp.db,
        ev.id,
        creator.id,
      );
      expect(result).not.toContain(creator.id);
      expect(result).toContain(a.id);
    });

    it('M1-AC3: a banned recipient (banned_at set) is excluded — the dispatchMany gap', async () => {
      const creator = await mkUser(testApp);
      const banned = await mkUser(testApp, { bannedAt: new Date() });
      const ok = await mkUser(testApp);
      const ev = await mkEvent(testApp, creator.id);
      await mkSignup(testApp, ev.id, banned.id, 'signed_up');
      await mkSignup(testApp, ev.id, ok.id, 'signed_up');
      const result = await resolvePostEventFollowupRecipients(
        testApp.db,
        ev.id,
        creator.id,
      );
      expect(result).not.toContain(banned.id);
      expect(result).toContain(ok.id);
    });

    it('M1-AC4: a kicked recipient (kicked_at set) is excluded', async () => {
      const creator = await mkUser(testApp);
      const kicked = await mkUser(testApp, { kickedAt: new Date() });
      const ok = await mkUser(testApp);
      const ev = await mkEvent(testApp, creator.id);
      await mkSignup(testApp, ev.id, kicked.id, 'signed_up');
      await mkSignup(testApp, ev.id, ok.id, 'signed_up');
      const result = await resolvePostEventFollowupRecipients(
        testApp.db,
        ev.id,
        creator.id,
      );
      expect(result).not.toContain(kicked.id);
      expect(result).toContain(ok.id);
    });

    it('M1-AC5: a recipient who opted out of post_event_followup discord is excluded', async () => {
      const creator = await mkUser(testApp);
      const optedOut = await mkUser(testApp);
      const ok = await mkUser(testApp);
      const ev = await mkEvent(testApp, creator.id);
      await optOutFollowupDiscord(testApp, optedOut.id);
      await mkSignup(testApp, ev.id, optedOut.id, 'signed_up');
      await mkSignup(testApp, ev.id, ok.id, 'signed_up');
      const result = await resolvePostEventFollowupRecipients(
        testApp.db,
        ev.id,
        creator.id,
      );
      expect(result).not.toContain(optedOut.id);
      expect(result).toContain(ok.id);
    });

    it('M1-AC6: a recipient with discord_id NULL is excluded', async () => {
      const creator = await mkUser(testApp);
      const noDiscord = await mkUser(testApp, { discordId: null });
      const ok = await mkUser(testApp);
      const ev = await mkEvent(testApp, creator.id);
      await mkSignup(testApp, ev.id, noDiscord.id, 'signed_up');
      await mkSignup(testApp, ev.id, ok.id, 'signed_up');
      const result = await resolvePostEventFollowupRecipients(
        testApp.db,
        ev.id,
        creator.id,
      );
      expect(result).not.toContain(noDiscord.id);
      expect(result).toContain(ok.id);
    });

    it('M1-AC7: an anonymous signup (user_id NULL, discord_user_id set) is excluded', async () => {
      const creator = await mkUser(testApp);
      const linked = await mkUser(testApp);
      const ev = await mkEvent(testApp, creator.id);
      await mkAnonSignup(testApp, ev.id, '900000000000000123');
      await mkSignup(testApp, ev.id, linked.id, 'signed_up');
      const result = await resolvePostEventFollowupRecipients(
        testApp.db,
        ev.id,
        creator.id,
      );
      expect(result).toEqual([linked.id]);
    });

    it('M1-AC8: roached_out and departed are included; declined excluded (OQ-1 regression guard)', async () => {
      const creator = await mkUser(testApp);
      const roached = await mkUser(testApp);
      const departed = await mkUser(testApp);
      const declined = await mkUser(testApp);
      const ev = await mkEvent(testApp, creator.id);
      await mkSignup(testApp, ev.id, roached.id, 'roached_out');
      await mkSignup(testApp, ev.id, departed.id, 'departed');
      await mkSignup(testApp, ev.id, declined.id, 'declined');
      const result = await resolvePostEventFollowupRecipients(
        testApp.db,
        ev.id,
        creator.id,
      );
      expect([...result].sort((x, y) => x - y)).toEqual(
        [roached.id, departed.id].sort((x, y) => x - y),
      );
    });
  });

  // =================================================================
  // M2 — findFollowupCandidateEvents
  // =================================================================
  describe('M2 cron candidate detection', () => {
    it('M2-AC2: an event whose effective end was ~15min ago is a candidate', async () => {
      const ev = await mkEvent(testApp, testApp.seed.adminUser.id, {
        duration: endedFifteenMinAgo(),
      });
      expect(await candidateIds(testApp)).toContain(ev.id);
    });

    it('M2-AC1: auto-extended still-live event is NOT a candidate (COALESCE, not raw upper(duration))', async () => {
      // Raw upper(duration) sits INSIDE the window; extended_until is in the
      // future, so the event is still live. A raw-upper impl would wrongly
      // include it — COALESCE(extended_until, upper(duration)) keeps it out.
      const ev = await mkEvent(testApp, testApp.seed.adminUser.id, {
        duration: endedFifteenMinAgo(),
        extendedUntil: new Date(Date.now() + 2 * MIN),
      });
      expect(await candidateIds(testApp)).not.toContain(ev.id);
    });

    it('M2-AC2b: event extended past its raw end, extension ended ~15min ago, IS a candidate (COALESCE picks extended_until)', async () => {
      // Raw upper(duration) is 30min ago (OUT of window); the effective end
      // (extended_until) is 15min ago (IN window). A raw-upper impl would
      // wrongly exclude it.
      const ev = await mkEvent(testApp, testApp.seed.adminUser.id, {
        duration: [new Date(Date.now() - 3 * HOUR), new Date(Date.now() - 30 * MIN)],
        extendedUntil: new Date(Date.now() - 15 * MIN),
      });
      expect(await candidateIds(testApp)).toContain(ev.id);
    });

    it('M2-AC3a: a cancelled event is excluded (control candidate still returned)', async () => {
      const control = await mkEvent(testApp, testApp.seed.adminUser.id, {
        duration: endedFifteenMinAgo(),
      });
      const cancelled = await mkEvent(testApp, testApp.seed.adminUser.id, {
        duration: endedFifteenMinAgo(),
        cancelledAt: new Date(),
      });
      const ids = await candidateIds(testApp);
      expect(ids).toContain(control.id);
      expect(ids).not.toContain(cancelled.id);
    });

    it('M2-AC3b: an event with rescheduling_poll_id is excluded (control candidate still returned)', async () => {
      const control = await mkEvent(testApp, testApp.seed.adminUser.id, {
        duration: endedFifteenMinAgo(),
      });
      const rescheduling = await mkEvent(testApp, testApp.seed.adminUser.id, {
        duration: endedFifteenMinAgo(),
        reschedulingPollId: 999,
      });
      const ids = await candidateIds(testApp);
      expect(ids).toContain(control.id);
      expect(ids).not.toContain(rescheduling.id);
    });

    it('M2-AC3c: a recurring event (recurrence_group_id) is excluded (control candidate still returned)', async () => {
      const control = await mkEvent(testApp, testApp.seed.adminUser.id, {
        duration: endedFifteenMinAgo(),
      });
      const recurring = await mkEvent(testApp, testApp.seed.adminUser.id, {
        duration: endedFifteenMinAgo(),
        recurrenceGroupId: '00000000-0000-0000-0000-000000000001',
      });
      const ids = await candidateIds(testApp);
      expect(ids).toContain(control.id);
      expect(ids).not.toContain(recurring.id);
    });

    it('M2-AC3d: an ad-hoc / quick-play event (is_ad_hoc=true) is excluded (control candidate still returned)', async () => {
      const control = await mkEvent(testApp, testApp.seed.adminUser.id, {
        duration: endedFifteenMinAgo(),
      });
      const adHoc = await mkEvent(testApp, testApp.seed.adminUser.id, {
        duration: endedFifteenMinAgo(),
        isAdHoc: true,
      });
      const ids = await candidateIds(testApp);
      expect(ids).toContain(control.id);
      expect(ids).not.toContain(adHoc.id);
    });

    it('M2-dedup: an event already in post_event_followup_sent is excluded (idempotency — 2nd tick no-op)', async () => {
      const control = await mkEvent(testApp, testApp.seed.adminUser.id, {
        duration: endedFifteenMinAgo(),
      });
      const already = await mkEvent(testApp, testApp.seed.adminUser.id, {
        duration: endedFifteenMinAgo(),
      });
      await markFollowupSent(testApp, already.id);
      const ids = await candidateIds(testApp);
      expect(ids).toContain(control.id);
      expect(ids).not.toContain(already.id);
    });
  });
});
