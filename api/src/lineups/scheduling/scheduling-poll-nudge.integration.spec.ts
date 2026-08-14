/**
 * Recurring 48h vote nudge for scheduling polls (integration).
 *
 * TDD gate for `SchedulingPollNudgeService`: every 48h, DM each *pending*
 * member of an active scheduling poll until they vote on a still-viable day
 * or the poll closes. "Pending" = no vote on ANY slot whose `proposed_time`
 * is still in the future, so members whose only votes are on days that have
 * since passed re-enter the audience automatically.
 *
 * Coverage (12 cases):
 *   1. Deadline-less standalone poll + zero-vote member older than 48h -> DM
 *   2. Member voted on a FUTURE slot -> not nudged
 *   3. Member voted ONLY on past slots -> nudged (the incident case)
 *   4. Match with zero future slots -> stalled copy variant
 *   5. Member added < 48h ago -> not nudged (and the tick is a no-op)
 *   6. `phase_deadline` inside 24h -> suppressed (deadline DMs own the window)
 *   7. `phase_deadline` already passed -> suppressed
 *   8. Dedup contract: key shape + 48h TTL in SECONDS; `true` -> no send
 *   9. Closed poll (match 'scheduled' / lineup 'archived') -> no candidates
 *  10. Deactivated member -> excluded
 *  11. NON-standalone decided lineup with a scheduling match -> also nudged
 *  12. Per-poll error isolation: poll A throwing does not starve poll B
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
const NUDGE_TTL_SECONDS = 48 * 3600;

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
  /** Age of every match-member row in hours. Default 72 (> the 48h grace). */
  memberAgeHours?: number;
  /** Hour offsets (from now) of the slots to seed. Default one future slot. */
  slotHours?: number[];
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
    // Default: nothing has been nudged yet in this 48h window.
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
        includeSchedulingPhase: true,
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

  // ── 5. member grace period ─────────────────────────────────────────

  it('does not nudge members added less than 48h ago (no-op tick)', async () => {
    await seedPoll('young', { memberAgeHours: 4 });

    const result = await nudgeService.runNudges();

    expect(createSpy).not.toHaveBeenCalled();
    // No-op ticks must return false so no execution row is recorded.
    expect(result).toBe(false);
  });

  // ── 6. deadline handoff (inside 24h) ───────────────────────────────

  it('suppresses the nudge when phase_deadline is inside the 24h handoff window', async () => {
    await seedPoll('handoff', { deadlineHours: 12 });

    await nudgeService.runNudges();

    expect(createSpy).not.toHaveBeenCalled();
  });

  // ── 7. deadline already passed ─────────────────────────────────────

  it('suppresses the nudge when phase_deadline has already passed', async () => {
    await seedPoll('expired', { deadlineHours: -6 });

    await nudgeService.runNudges();

    expect(createSpy).not.toHaveBeenCalled();
  });

  // ── 8. dedup contract ──────────────────────────────────────────────

  it('marks dedup with the sched-poll-nudge key and a 48h TTL in seconds', async () => {
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
}

describe(
  'Scheduling poll 48h vote nudge (integration)',
  describeSchedulingPollNudge,
);
