/**
 * Recurring 24h vote nudge for scheduling polls (integration).
 *
 * TDD gate for `SchedulingPollNudgeService`: every 24h, DM each *pending*
 * member of an active scheduling poll until they vote on a still-viable day
 * or the poll closes. "Pending" = no vote on ANY slot whose `proposed_time`
 * is still in the future, so members whose only votes are on days that have
 * since passed re-enter the audience automatically.
 *
 * Coverage (17 cases):
 *   1. Deadline-less standalone poll + zero-vote member older than 24h -> DM
 *   2. Member voted on a FUTURE slot -> not nudged
 *   3. Member voted ONLY on past slots -> nudged (the incident case)
 *   4. Match whose slots have all passed -> stalled copy variant
 *   5. Match that never had slots -> no-times-proposed copy variant
 *   6. Member added < 24h ago -> not nudged (and the tick is a no-op);
 *      a member aged between the old 48h grace and the new 24h one IS
 *      nudged (the ROK cadence cut — would have been silent before)
 *   7. `phase_deadline` inside 24h -> zero-vote members handed off to the
 *      deadline DMs, but STALE voters (invisible to those) are still nudged
 *   8. `phase_deadline` already passed -> suppressed
 *   9. Dedup contract: key shape + 24h TTL in SECONDS; `true` -> no send
 *  10. Closed poll (match 'scheduled' / lineup 'archived') -> no candidates
 *  11. Lineup that opted out of the scheduling phase -> excluded
 *  12. Deactivated member -> excluded
 *  13. NON-standalone decided lineup with a scheduling match -> also nudged
 *  14. Per-poll error isolation: poll A throwing does not starve poll B
 *  15. All-polls-failed tick records a DEGRADED execution (not a no-op)
 */
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import { truncateAllTables } from '../../common/testing/integration-helpers';
import * as schema from '../../drizzle/schema';
import { generatePublicSlug } from '../public-lineup-slug.helpers';
import { NotificationService } from '../../notifications/notification.service';
import { NotificationDedupService } from '../../notifications/notification-dedup.service';
import { SchedulingPollNudgeService } from './scheduling-poll-nudge.service';

const HOUR_MS = 60 * 60 * 1000;
/** Mirrors POLL_NUDGE_TTL_SECONDS — asserted verbatim so a ms/s slip fails. */
const NUDGE_TTL_SECONDS = 24 * 3600;

interface PollSetup {
  lineupId: number;
  matchId: number;
  gameId: number;
  gameName: string;
  creatorId: number;
  memberIds: number[];
}

interface SeedOptions {
  /** ROK-977 standalone marker on the parent lineup. Default true. */
  standalone?: boolean;
  lineupStatus?: 'decided' | 'archived';
  matchStatus?: 'scheduling' | 'scheduled';
  /** Hours until `phase_deadline` (negative = past). Default null = none. */
  deadlineHours?: number | null;
  /** Extra members beyond the creator. Default 1. */
  members?: number;
  /** Age of every match-member row in hours. Default 72 (> the 24h grace). */
  memberAgeHours?: number;
  /** Hour offsets (from now) of the slots to seed. Default one future slot. */
  slotHours?: number[];
  /** ROK-1302 scheduling-phase opt-out on the parent lineup. Default true. */
  includeSchedulingPhase?: boolean;
}

function describeSchedulingPollNudge(): void {
  let testApp: TestApp;
  let nudgeService: SchedulingPollNudgeService;
  let notificationService: NotificationService;
  let dedup: NotificationDedupService;
  let createSpy: jest.SpyInstance;
  let dedupSpy: jest.SpyInstance;
  let tag = 0;

  beforeAll(async () => {
    testApp = await getTestApp();
    nudgeService = testApp.app.get(SchedulingPollNudgeService);
    notificationService = testApp.app.get(NotificationService);
    dedup = testApp.app.get(NotificationDedupService);
  });

  beforeEach(() => {
    createSpy = jest
      .spyOn(notificationService, 'create')
      .mockResolvedValue({ id: 'mock-notif' } as never);
    // Default: nothing has been nudged yet in this 24h window.
    dedupSpy = jest.spyOn(dedup, 'checkAndMarkSent').mockResolvedValue(false);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    testApp.seed = await truncateAllTables(testApp.db);
  });

  // ── helpers ────────────────────────────────────────────────────────

  async function createUser(
    label: string,
    opts: { deactivated?: boolean } = {},
  ): Promise<number> {
    const suffix = `${label}-${++tag}`;
    const [user] = await testApp.db
      .insert(schema.users)
      .values({
        discordId: `discord:nudge-${suffix}`,
        username: `nudge-${suffix}`,
        role: 'member',
        deactivatedAt: opts.deactivated ? new Date() : null,
      })
      .returning();
    return user.id;
  }

  async function createGame(
    label: string,
  ): Promise<{ id: number; name: string }> {
    const name = `Nudge Game ${label}-${++tag}`;
    const [game] = await testApp.db
      .insert(schema.games)
      .values({ name, slug: `nudge-${label}-${tag}` })
      .returning();
    return { id: game.id, name: game.name };
  }

  /** Insert the parent lineup row for a poll. */
  async function insertLineup(
    creatorId: number,
    opts: SeedOptions,
  ): Promise<number> {
    const deadlineHours = opts.deadlineHours ?? null;
    const [lineup] = await testApp.db
      .insert(schema.communityLineups)
      .values({
        title: 'Nudge Scheduling Poll',
        status: opts.lineupStatus ?? 'decided',
        visibility: 'public',
        createdBy: creatorId,
        includeSchedulingPhase: opts.includeSchedulingPhase ?? true,
        phaseDeadline:
          deadlineHours === null
            ? null
            : new Date(Date.now() + deadlineHours * HOUR_MS),
        phaseDurationOverride:
          (opts.standalone ?? true) ? { standalone: true } : null,
        publicSlug: generatePublicSlug(),
        publicShareEnabled: false,
      })
      .returning();
    return lineup.id;
  }

  /**
   * Seed a full scheduling poll: lineup + match + members (creator plus
   * `members` extras, all stamped `memberAgeHours` old) + slots.
   */
  async function seedPoll(
    label: string,
    opts: SeedOptions = {},
  ): Promise<PollSetup> {
    const creatorId = await createUser(`${label}-creator`);
    const game = await createGame(label);
    const lineupId = await insertLineup(creatorId, opts);
    const [match] = await testApp.db
      .insert(schema.communityLineupMatches)
      .values({
        lineupId,
        gameId: game.id,
        status: opts.matchStatus ?? 'scheduling',
        thresholdMet: true,
        voteCount: 1,
      })
      .returning();

    const memberIds: number[] = [];
    for (let i = 0; i < (opts.members ?? 1); i++) {
      memberIds.push(await createUser(`${label}-m${i}`));
    }
    await addMembers(match.id, [creatorId, ...memberIds], opts.memberAgeHours);
    for (const hours of opts.slotHours ?? [72]) {
      await addSlot(match.id, hours);
    }
    return {
      lineupId,
      matchId: match.id,
      gameId: game.id,
      gameName: game.name,
      creatorId,
      memberIds,
    };
  }

  /** Attach members to a match with an explicit `created_at` age. */
  async function addMembers(
    matchId: number,
    userIds: number[],
    ageHours = 72,
  ): Promise<void> {
    const createdAt = new Date(Date.now() - ageHours * HOUR_MS);
    await testApp.db.insert(schema.communityLineupMatchMembers).values(
      userIds.map((userId) => ({
        matchId,
        userId,
        source: 'voted' as const,
        createdAt,
      })),
    );
  }

  /** Insert a slot `hoursFromNow` away (negative = already passed). */
  async function addSlot(
    matchId: number,
    hoursFromNow: number,
  ): Promise<number> {
    const [slot] = await testApp.db
      .insert(schema.communityLineupScheduleSlots)
      .values({
        matchId,
        proposedTime: new Date(Date.now() + hoursFromNow * HOUR_MS),
        suggestedBy: 'user',
      })
      .returning();
    return slot.id;
  }

  async function castVote(slotId: number, userId: number): Promise<void> {
    await testApp.db
      .insert(schema.communityLineupScheduleVotes)
      .values({ slotId, userId });
  }

  /** Every `NotificationService.create` payload sent to `userId`. */
  function dmsForUser(userId: number): Array<Record<string, any>> {
    return createSpy.mock.calls
      .map((c) => c[0] as Record<string, any>)
      .filter((arg) => arg.userId === userId);
  }

  // ── 1. baseline nudge ──────────────────────────────────────────────

  it('nudges a zero-vote member of a deadline-less standalone poll', async () => {
    const poll = await seedPoll('baseline');
    const member = poll.memberIds[0];

    await nudgeService.runNudges();

    const dms = dmsForUser(member);
    expect(dms.length).toBe(1);
    expect(dms[0]).toMatchObject({
      type: 'community_lineup',
      title: 'Scheduling poll waiting on you',
      message: expect.stringContaining(poll.gameName),
      payload: expect.objectContaining({
        subtype: 'scheduling_poll_nudge',
        reminderWindow: `poll-${poll.matchId}`,
        lineupId: poll.lineupId,
        matchId: poll.matchId,
        gameName: poll.gameName,
      }),
    });
    // The creator is a member too — no vote means no exemption.
    expect(dmsForUser(poll.creatorId).length).toBe(1);
  });

  // ── 2. voted on a future slot ──────────────────────────────────────

  it('does NOT nudge a member who voted on a still-future slot', async () => {
    const poll = await seedPoll('future-vote', { members: 2 });
    const [voter, nonVoter] = poll.memberIds;
    const futureSlot = await addSlot(poll.matchId, 96);
    await castVote(futureSlot, voter);

    await nudgeService.runNudges();

    expect(dmsForUser(voter).length).toBe(0);
    expect(dmsForUser(nonVoter).length).toBe(1);
  });

  // ── 3. voted only on past slots (the incident) ─────────────────────

  it('nudges a member whose only votes are on slots that have passed', async () => {
    const poll = await seedPoll('stale-vote', { members: 1, slotHours: [] });
    const member = poll.memberIds[0];
    const pastSlot = await addSlot(poll.matchId, -48);
    await addSlot(poll.matchId, 72);
    await castVote(pastSlot, member);

    await nudgeService.runNudges();

    const dms = dmsForUser(member);
    expect(dms.length).toBe(1);
    // A future slot still exists -> normal copy, not the stalled variant.
    expect(dms[0].title).toBe('Scheduling poll waiting on you');
  });

  // ── 4. stalled poll copy variant ───────────────────────────────────

  it('sends the stalled copy variant when the match has zero future slots', async () => {
    const poll = await seedPoll('stalled', { slotHours: [-72, -12] });
    const member = poll.memberIds[0];

    await nudgeService.runNudges();

    const dms = dmsForUser(member);
    expect(dms.length).toBe(1);
    expect(dms[0]).toMatchObject({
      type: 'community_lineup',
      title: 'Scheduling poll needs new times',
      message: expect.stringContaining('suggest a new time'),
      payload: expect.objectContaining({
        subtype: 'scheduling_poll_nudge',
        matchId: poll.matchId,
      }),
    });
    expect(dms[0].message).toContain(poll.gameName);
  });

  // ── 4b. never-had-slots copy variant ───────────────────────────────

  it('sends the no-times-proposed variant when the poll never had slots', async () => {
    const poll = await seedPoll('slotless', { slotHours: [] });
    const member = poll.memberIds[0];

    await nudgeService.runNudges();

    const dms = dmsForUser(member);
    expect(dms.length).toBe(1);
    expect(dms[0]).toMatchObject({
      title: 'Scheduling poll needs times',
      message: expect.stringContaining('No days have been proposed'),
    });
    expect(dms[0].message).toContain(poll.gameName);
  });

  // ── 5. member grace period ─────────────────────────────────────────

  it('does not nudge members added less than 24h ago (no-op tick)', async () => {
    await seedPoll('young', { memberAgeHours: 4 });

    const result = await nudgeService.runNudges();

    expect(createSpy).not.toHaveBeenCalled();
    // No-op ticks must return false so no execution row is recorded.
    expect(result).toBe(false);
  });

  it('nudges a member aged between the old 48h grace and the new 24h one', async () => {
    // 36h sits inside the retired 48h grace: before the cadence cut this
    // member was silent for another half-day. Pins the new boundary so a
    // revert to 48 fails here rather than only in prod DM volume.
    const poll = await seedPoll('grace-boundary', { memberAgeHours: 36 });

    await nudgeService.runNudges();

    expect(dmsForUser(poll.memberIds[0]).length).toBe(1);
  });

  // ── 6. deadline handoff (inside 24h) ───────────────────────────────

  it('hands zero-vote members to the deadline DMs inside the 24h window', async () => {
    await seedPoll('handoff', { deadlineHours: 12 });

    await nudgeService.runNudges();

    // Every member is zero-vote: the 24h/1h deadline reminders cover them,
    // so the nudge stays silent for this poll.
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('still nudges STALE voters inside the 24h window (deadline DMs skip them)', async () => {
    const poll = await seedPoll('handoff-stale', {
      deadlineHours: 12,
      slotHours: [-72, 12],
    });
    const staleVoter = poll.memberIds[0];
    const pastSlot = await addSlot(poll.matchId, -48);
    await castVote(pastSlot, staleVoter);

    await nudgeService.runNudges();

    // The stale voter has a vote row, so the deadline reminders' any-vote
    // check skips them — the nudge is their only coverage in the final day.
    expect(dmsForUser(staleVoter).length).toBe(1);
    // The zero-vote creator is left to the deadline reminders.
    expect(dmsForUser(poll.creatorId).length).toBe(0);
  });

  // ── 7. deadline already passed ─────────────────────────────────────

  it('suppresses the nudge when phase_deadline has already passed', async () => {
    await seedPoll('expired', { deadlineHours: -6 });

    await nudgeService.runNudges();

    expect(createSpy).not.toHaveBeenCalled();
  });

  // ── 8. dedup contract ──────────────────────────────────────────────

  it('marks dedup with the sched-poll-nudge key and a 24h TTL in seconds', async () => {
    const poll = await seedPoll('dedup');
    const member = poll.memberIds[0];

    await nudgeService.runNudges();

    expect(dedupSpy).toHaveBeenCalledWith(
      expect.stringMatching(/^sched-poll-nudge:\d+:\d+$/),
      NUDGE_TTL_SECONDS,
    );
    expect(dedupSpy).toHaveBeenCalledWith(
      `sched-poll-nudge:${poll.matchId}:${member}`,
      NUDGE_TTL_SECONDS,
    );
    const firstRun = createSpy.mock.calls.length;
    expect(firstRun).toBeGreaterThan(0);

    // Second tick inside the same window: dedup reports "already sent".
    dedupSpy.mockResolvedValue(true);
    await nudgeService.runNudges();

    expect(createSpy.mock.calls.length).toBe(firstRun);
  });

  // ── 9. closed polls ────────────────────────────────────────────────

  it('ignores closed polls (match scheduled, or lineup archived)', async () => {
    await seedPoll('scheduled-match', { matchStatus: 'scheduled' });
    await seedPoll('archived-lineup', { lineupStatus: 'archived' });

    await nudgeService.runNudges();

    expect(createSpy).not.toHaveBeenCalled();
  });

  // ── 9b. scheduling-phase opt-out ───────────────────────────────────

  it('excludes lineups that opted out of the scheduling phase', async () => {
    await seedPoll('optout', { includeSchedulingPhase: false });

    await nudgeService.runNudges();

    expect(createSpy).not.toHaveBeenCalled();
  });

  // ── 10. deactivated members ────────────────────────────────────────

  it('excludes deactivated members from the nudge audience', async () => {
    const poll = await seedPoll('deactivated');
    const goneMember = await createUser('gone', { deactivated: true });
    await addMembers(poll.matchId, [goneMember]);

    await nudgeService.runNudges();

    expect(dmsForUser(goneMember).length).toBe(0);
    expect(dmsForUser(poll.memberIds[0]).length).toBe(1);
  });

  // ── 11. non-standalone lineups are in scope ────────────────────────

  it('nudges members of a NON-standalone decided lineup in scheduling', async () => {
    const poll = await seedPoll('regular', { standalone: false });
    const member = poll.memberIds[0];

    await nudgeService.runNudges();

    expect(dmsForUser(member).length).toBe(1);
    expect(dmsForUser(member)[0]).toMatchObject({
      payload: expect.objectContaining({
        subtype: 'scheduling_poll_nudge',
        lineupId: poll.lineupId,
      }),
    });
  });

  // ── 12. per-poll error isolation ───────────────────────────────────

  it('keeps processing later polls when one poll throws', async () => {
    const failing = await seedPoll('boom');
    const healthy = await seedPoll('healthy');
    createSpy.mockImplementation((input: Record<string, any>) => {
      if (input.payload?.matchId === failing.matchId) {
        return Promise.reject(new Error('dispatch exploded'));
      }
      return Promise.resolve({ id: 'mock-notif' } as never);
    });

    // Must not reject: the failing poll is isolated by a per-poll try/catch.
    await nudgeService.runNudges();

    expect(dmsForUser(healthy.memberIds[0]).length).toBe(1);
    expect(dmsForUser(healthy.creatorId).length).toBe(1);
  });

  // ── 15. failed ticks are not silent no-ops ─────────────────────────

  it('records a DEGRADED execution when every poll fails', async () => {
    await seedPoll('allfail');
    createSpy.mockRejectedValue(new Error('dispatch exploded'));

    const result = await nudgeService.runNudges();

    // `false` would suppress the execution row and hide the outage from the
    // admin cron panel — a failing tick must surface as degraded (ROK-1197).
    expect(result).toEqual({ degraded: true });
  });
}

describe(
  'Scheduling poll 24h vote nudge (integration)',
  describeSchedulingPollNudge,
);
