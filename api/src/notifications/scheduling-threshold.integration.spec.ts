/**
 * Threshold DM for scheduling polls (integration, ROK-1632).
 *
 * The operator-reported bug: the creator of a LINEUP-attached poll never got
 * the "N of M members have voted" DM. Only the standalone-poll path writes
 * `min_vote_threshold`, so a lineup-born match carries NULL and the cron's
 * `IS NOT NULL` gate excluded it forever. Pinned here against a real Postgres
 * because the whole rule lives in one SQL statement — a mocked row cannot
 * prove which matches the query returns.
 *
 * Coverage:
 *   1. Lineup-born poll (NULL threshold), 3 members, 3 YES -> creator row +
 *      stamp, message reads "3 of 3"
 *   2. Same poll with only 2 of 3 YES -> nothing, column stays NULL
 *   3. NO answers pull it over the line (ROK-1617 still holds under COALESCE)
 *   4. An explicit standalone threshold is untouched by the fallback
 *   5. A memberless match never fires (effective threshold 0)
 *   6. AC2: a throwing send leaves the column NULL and the NEXT sweep delivers
 */
import { eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import { generatePublicSlug } from '../lineups/public-lineup-slug.helpers';
import { NotificationService } from './notification.service';
import { SchedulingThresholdService } from './scheduling-threshold.service';

const HOUR_MS = 60 * 60 * 1000;

interface PollSetup {
  lineupId: number;
  matchId: number;
  gameName: string;
  creatorId: number;
  memberIds: number[];
  slotId: number;
}

interface SeedOptions {
  /** Explicit `min_vote_threshold`. Default null = the lineup-born case. */
  minVoteThreshold?: number | null;
  /** Members attached to the match, creator included. Default 3. */
  members?: number;
}

function describeSchedulingThreshold(): void {
  let testApp: TestApp;
  let service: SchedulingThresholdService;
  let notificationService: NotificationService;
  let tag = 0;

  beforeAll(async () => {
    testApp = await getTestApp();
    service = testApp.app.get(SchedulingThresholdService);
    notificationService = testApp.app.get(NotificationService);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    testApp.seed = await truncateAllTables(testApp.db);
  });

  // ── helpers ────────────────────────────────────────────────────────

  async function createUser(label: string): Promise<number> {
    const suffix = `${label}-${++tag}`;
    const [user] = await testApp.db
      .insert(schema.users)
      .values({
        discordId: `discord:thresh-${suffix}`,
        username: `thresh-${suffix}`,
        role: 'member',
      })
      .returning();
    return user.id;
  }

  /**
   * Seed a scheduling poll exactly as the lineup path leaves it: a match with
   * members and one future slot, and `min_vote_threshold` NULL unless the
   * caller asks for the standalone-poll shape.
   */
  async function seedPoll(
    label: string,
    opts: SeedOptions = {},
  ): Promise<PollSetup> {
    const creatorId = await createUser(`${label}-creator`);
    const gameName = `Threshold Game ${label}-${++tag}`;
    const [game] = await testApp.db
      .insert(schema.games)
      .values({ name: gameName, slug: `thresh-${label}-${tag}` })
      .returning();
    const [lineup] = await testApp.db
      .insert(schema.communityLineups)
      .values({
        title: 'Threshold Scheduling Poll',
        status: 'decided',
        visibility: 'public',
        createdBy: creatorId,
        includeSchedulingPhase: true,
        publicSlug: generatePublicSlug(),
        publicShareEnabled: false,
      })
      .returning();
    const [match] = await testApp.db
      .insert(schema.communityLineupMatches)
      .values({
        lineupId: lineup.id,
        gameId: game.id,
        status: 'scheduling',
        thresholdMet: true,
        voteCount: 1,
        minVoteThreshold: opts.minVoteThreshold ?? null,
      })
      .returning();

    const memberIds = [creatorId];
    for (let i = 1; i < (opts.members ?? 3); i++) {
      memberIds.push(await createUser(`${label}-m${i}`));
    }
    if (memberIds.length > 0) {
      await testApp.db.insert(schema.communityLineupMatchMembers).values(
        memberIds.map((userId) => ({
          matchId: match.id,
          userId,
          source: 'voted' as const,
        })),
      );
    }
    const [slot] = await testApp.db
      .insert(schema.communityLineupScheduleSlots)
      .values({
        matchId: match.id,
        proposedTime: new Date(Date.now() + 72 * HOUR_MS),
        suggestedBy: 'user',
      })
      .returning();

    return {
      lineupId: lineup.id,
      matchId: match.id,
      gameName,
      creatorId,
      memberIds,
      slotId: slot.id,
    };
  }

  /** Remove every member row so the effective threshold resolves to 0. */
  async function clearMembers(matchId: number): Promise<void> {
    await testApp.db
      .delete(schema.communityLineupMatchMembers)
      .where(eq(schema.communityLineupMatchMembers.matchId, matchId));
  }

  async function vote(
    slotId: number,
    userIds: number[],
    stance: 'yes' | 'no' = 'yes',
  ): Promise<void> {
    await testApp.db
      .insert(schema.communityLineupScheduleVotes)
      .values(userIds.map((userId) => ({ slotId, userId, stance })));
  }

  /** Threshold-met notifications persisted for a user. */
  async function thresholdNotifsFor(
    userId: number,
  ): Promise<Array<{ message: string; payload: unknown }>> {
    const rows = await testApp.db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.userId, userId));
    return rows
      .filter(
        (r) =>
          (r.payload as { subtype?: string } | null)?.subtype ===
          'scheduling_poll_threshold_met',
      )
      .map((r) => ({ message: r.message, payload: r.payload }));
  }

  async function stampOf(matchId: number): Promise<Date | null> {
    const [row] = await testApp.db
      .select()
      .from(schema.communityLineupMatches)
      .where(eq(schema.communityLineupMatches.id, matchId));
    return row.thresholdNotifiedAt;
  }

  // ── 1. the incident: lineup-born poll, everyone answered ───────────

  it('DMs the creator of a NULL-threshold lineup poll once every member says yes', async () => {
    const poll = await seedPoll('lineup-born');
    await vote(poll.slotId, poll.memberIds);

    await service.checkThresholds();

    const dms = await thresholdNotifsFor(poll.creatorId);
    expect(dms).toHaveLength(1);
    expect(dms[0].message).toBe(
      `3 of 3 members have voted on your ${poll.gameName} poll`,
    );
    expect(dms[0].payload).toMatchObject({
      subtype: 'scheduling_poll_threshold_met',
      lineupId: poll.lineupId,
      matchId: poll.matchId,
      gameName: poll.gameName,
    });
    expect(await stampOf(poll.matchId)).toBeInstanceOf(Date);
  });

  // ── 2. short of the member count ───────────────────────────────────

  it('stays silent while only 2 of the 3 members have answered yes', async () => {
    const poll = await seedPoll('partial');
    await vote(poll.slotId, poll.memberIds.slice(0, 2));

    await service.checkThresholds();

    expect(await thresholdNotifsFor(poll.creatorId)).toHaveLength(0);
    expect(await stampOf(poll.matchId)).toBeNull();
  });

  // ── 3. ROK-1617 under the new COALESCE ─────────────────────────────

  it('does not count a NO answer toward the member-count threshold', async () => {
    const poll = await seedPoll('anti-vote');
    await vote(poll.slotId, poll.memberIds.slice(0, 2));
    await vote(poll.slotId, poll.memberIds.slice(2), 'no');

    await service.checkThresholds();

    expect(await thresholdNotifsFor(poll.creatorId)).toHaveLength(0);
  });

  // ── 4. standalone polls keep their explicit threshold ──────────────

  it('honours an explicit min_vote_threshold instead of the member count', async () => {
    const poll = await seedPoll('explicit', { minVoteThreshold: 2 });
    await vote(poll.slotId, poll.memberIds.slice(0, 2));

    await service.checkThresholds();

    const dms = await thresholdNotifsFor(poll.creatorId);
    expect(dms).toHaveLength(1);
    // 2 of 2 — the explicit threshold, not the 3 members on the match.
    expect(dms[0].message).toBe(
      `2 of 2 members have voted on your ${poll.gameName} poll`,
    );
  });

  // ── 5. a memberless match has no threshold to meet ─────────────────

  it('never fires for a match with no members (effective threshold 0)', async () => {
    const poll = await seedPoll('memberless');
    await clearMembers(poll.matchId);

    await service.checkThresholds();

    expect(await thresholdNotifsFor(poll.creatorId)).toHaveLength(0);
    expect(await stampOf(poll.matchId)).toBeNull();
  });

  // ── 6. AC2: a failed send is retried, not lost ─────────────────────

  it('leaves the stamp NULL when the send throws, and delivers on the next sweep', async () => {
    const poll = await seedPoll('retry');
    await vote(poll.slotId, poll.memberIds);
    const createSpy = jest
      .spyOn(notificationService, 'create')
      .mockRejectedValueOnce(new Error('Discord DM failed'));

    await service.checkThresholds();

    expect(await thresholdNotifsFor(poll.creatorId)).toHaveLength(0);
    expect(await stampOf(poll.matchId)).toBeNull();

    createSpy.mockRestore();
    await service.checkThresholds();

    expect(await thresholdNotifsFor(poll.creatorId)).toHaveLength(1);
    expect(await stampOf(poll.matchId)).toBeInstanceOf(Date);
  });
}

describe(
  'Scheduling poll threshold DM (integration, ROK-1632)',
  describeSchedulingThreshold,
);
