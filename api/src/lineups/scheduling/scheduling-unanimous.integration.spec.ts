/**
 * "Everyone picked this time" creator DM (integration, ROK-1632 AC3).
 *
 * The whole rule lives in ONE SQL statement plus a dedup claim, so a mocked
 * row cannot prove which matches it returns. Pinned against a real Postgres:
 *
 *   - a LINEUP-attached poll whose every member holds a `yes` on one future
 *     slot DMs the lineup's `created_by`, once, with that time in the copy;
 *   - a missing answer or a `no` on that slot keeps it silent (ROK-1617);
 *   - the claim is permanent — an un-vote/re-vote round trip sends nothing
 *     more, while a SECOND unanimous time on the same poll does send;
 *   - a throwing send gives the claim back, so the next pass delivers;
 *   - a passed time, a one-member match and a non-`scheduling` match are all
 *     excluded by the query, not by the caller;
 *   - `checkMatch(null)` (the cron's sweep) finds the same row the inline
 *     hook would have;
 *   - the creator casting the completing vote still gets their own DM (OQ4).
 *
 * `checkMatch` is awaited directly in every case but the last: the production
 * hook in `toggleVote` is deliberately un-awaited, so racing it would make
 * these assertions time-dependent. The final case drives the real HTTP vote
 * route and polls for the row with `waitFor` — never a sleep.
 */
import { and, eq } from 'drizzle-orm';
import * as bcrypt from 'bcrypt';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import {
  truncateAllTables,
  waitFor,
} from '../../common/testing/integration-helpers';
import * as schema from '../../drizzle/schema';
import { generatePublicSlug } from '../public-lineup-slug.helpers';
import { NotificationService } from '../../notifications/notification.service';
import { SchedulingUnanimousService } from './scheduling-unanimous.service';
import {
  UNANIMOUS_SUBTYPE,
  unanimousDedupKey,
} from './scheduling-unanimous.helpers';

const HOUR_MS = 60 * 60 * 1000;

type MatchStatus = 'suggested' | 'scheduling' | 'scheduled' | 'archived';

interface PollSetup {
  lineupId: number;
  matchId: number;
  gameName: string;
  creatorId: number;
  memberIds: number[];
  slotId: number;
}

interface SeedOptions {
  /** Members attached to the match, creator included. Default 3. */
  members?: number;
  /** Match lifecycle state. Default `scheduling` (the only live one). */
  status?: MatchStatus;
  /** Offset of the seeded slot. Negative = a time that has passed. */
  slotHours?: number;
}

function describeUnanimous(): void {
  let testApp: TestApp;
  let service: SchedulingUnanimousService;
  let notificationService: NotificationService;
  let tag = 0;

  beforeAll(async () => {
    testApp = await getTestApp();
    service = testApp.app.get(SchedulingUnanimousService, { strict: false });
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
        discordId: `discord:unan-${suffix}`,
        username: `unan-${suffix}`,
        role: 'member',
      })
      .returning();
    return user.id;
  }

  /** A user who can actually call the vote route (local creds + a JWT). */
  async function createUserWithToken(
    label: string,
  ): Promise<{ id: number; token: string }> {
    const id = await createUser(label);
    const email = `unan-${label}-${tag}@test.local`;
    await testApp.db.insert(schema.localCredentials).values({
      email,
      passwordHash: await bcrypt.hash('UnanPass1!', 4),
      userId: id,
    });
    const res = await testApp.request
      .post('/auth/local')
      .send({ email, password: 'UnanPass1!' });
    return { id, token: res.body.access_token as string };
  }

  /** The lineup + match pair, exactly as the lineup scheduling phase leaves it. */
  async function seedLineupMatch(
    label: string,
    creatorId: number,
    status: MatchStatus,
  ): Promise<{ lineupId: number; matchId: number; gameName: string }> {
    const gameName = `Unanimous Game ${label}-${++tag}`;
    const [game] = await testApp.db
      .insert(schema.games)
      .values({ name: gameName, slug: `unan-${label}-${tag}` })
      .returning();
    const [lineup] = await testApp.db
      .insert(schema.communityLineups)
      .values({
        title: 'Unanimous Scheduling Poll',
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
        status,
        thresholdMet: true,
        voteCount: 1,
      })
      .returning();
    return { lineupId: lineup.id, matchId: match.id, gameName };
  }

  /** A live poll: N members (creator first) and one slot. */
  async function seedPoll(
    label: string,
    opts: SeedOptions = {},
  ): Promise<PollSetup> {
    const creatorId = await createUser(`${label}-creator`);
    const { lineupId, matchId, gameName } = await seedLineupMatch(
      label,
      creatorId,
      opts.status ?? 'scheduling',
    );
    const memberIds = [creatorId];
    for (let i = 1; i < (opts.members ?? 3); i++) {
      memberIds.push(await createUser(`${label}-m${i}`));
    }
    for (const userId of memberIds) await addMember(matchId, userId);
    const slotId = await addSlot(matchId, opts.slotHours ?? 72);
    return { lineupId, matchId, gameName, creatorId, memberIds, slotId };
  }

  async function addMember(matchId: number, userId: number): Promise<void> {
    await testApp.db
      .insert(schema.communityLineupMatchMembers)
      .values({ matchId, userId, source: 'voted' as const });
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

  async function castVote(
    slotId: number,
    userIds: number[],
    stance: 'yes' | 'no' = 'yes',
  ): Promise<void> {
    await testApp.db
      .insert(schema.communityLineupScheduleVotes)
      .values(userIds.map((userId) => ({ slotId, userId, stance })));
  }

  async function clearVote(slotId: number, userId: number): Promise<void> {
    await testApp.db
      .delete(schema.communityLineupScheduleVotes)
      .where(
        and(
          eq(schema.communityLineupScheduleVotes.slotId, slotId),
          eq(schema.communityLineupScheduleVotes.userId, userId),
        ),
      );
  }

  /** The unanimous DMs persisted for a user (this subtype only). */
  async function unanimousDmsFor(userId: number) {
    const rows = await testApp.db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.userId, userId));
    return rows.filter(
      (r) =>
        (r.payload as { subtype?: string } | null)?.subtype ===
        UNANIMOUS_SUBTYPE,
    );
  }

  /** Whether the permanent claim for this poll+time is held in either layer. */
  async function claimed(matchId: number, slotId: number): Promise<boolean> {
    const key = unanimousDedupKey(matchId, slotId);
    if (testApp.redisMock.store.has(key)) return true;
    const rows = await testApp.db
      .select()
      .from(schema.notificationDedup)
      .where(eq(schema.notificationDedup.dedupKey, key));
    return rows.length > 0;
  }

  /** The instant a slot actually holds, read through a typed select. */
  async function slotEpochSeconds(slotId: number): Promise<number> {
    const [slot] = await testApp.db
      .select()
      .from(schema.communityLineupScheduleSlots)
      .where(eq(schema.communityLineupScheduleSlots.id, slotId));
    return Math.floor(new Date(slot.proposedTime).getTime() / 1000);
  }

  // ── the AC: one time, every member, one DM ─────────────────────────

  it('DMs the creator once when every member says yes to one time', async () => {
    const poll = await seedPoll('unanimous');
    await castVote(poll.slotId, poll.memberIds);

    expect(await service.checkMatch(poll.matchId)).toBe(1);

    const dms = await unanimousDmsFor(poll.creatorId);
    expect(dms).toHaveLength(1);
    expect(dms[0].type).toBe('community_lineup');
    expect(dms[0].title).toBe(`Everyone's in for ${poll.gameName}`);
    expect(dms[0].payload).toMatchObject({
      subtype: UNANIMOUS_SUBTYPE,
      reminderWindow: `unanimous-${poll.matchId}-${poll.slotId}`,
      lineupId: poll.lineupId,
      matchId: poll.matchId,
      slotId: poll.slotId,
      gameName: poll.gameName,
    });
    expect(await claimed(poll.matchId, poll.slotId)).toBe(true);
  });

  it('names the unanimous time as the instant the slot holds', async () => {
    const poll = await seedPoll('copy');
    await castVote(poll.slotId, poll.memberIds);

    expect(await service.checkMatch(poll.matchId)).toBe(1);

    const [dm] = await unanimousDmsFor(poll.creatorId);
    expect(dm).toBeDefined();
    // "All 3 members said yes to <t:…:f>. Lock it in." — the member count is
    // the match's, and the stamp is the SLOT's instant, not the local wall
    // clock of whichever host ran this (`proposed_time` is zone-less UTC).
    const copy = /^All 3 members said yes to <t:(\d{9,11}):f>\. Lock it in\.$/;
    const stamp = copy.exec(dm.message ?? '');
    expect(stamp).not.toBeNull();
    expect(Number(stamp?.[1])).toBe(await slotEpochSeconds(poll.slotId));
  });

  // ── strict 100%: a missing answer and a NO both block it ───────────

  it('stays silent while one member has not answered the time', async () => {
    const poll = await seedPoll('partial');
    await castVote(poll.slotId, poll.memberIds.slice(0, 2));

    expect(await service.checkMatch(poll.matchId)).toBe(0);

    expect(await unanimousDmsFor(poll.creatorId)).toHaveLength(0);
    expect(await claimed(poll.matchId, poll.slotId)).toBe(false);
  });

  it('stays silent while one member holds a NO on the time', async () => {
    const poll = await seedPoll('anti-vote');
    await castVote(poll.slotId, poll.memberIds.slice(0, 2));
    // ROK-1617: a `no` is a row on the slot, and it is not a yes.
    await castVote(poll.slotId, poll.memberIds.slice(2), 'no');

    expect(await service.checkMatch(poll.matchId)).toBe(0);

    expect(await unanimousDmsFor(poll.creatorId)).toHaveLength(0);
    expect(await claimed(poll.matchId, poll.slotId)).toBe(false);
  });

  // ── once per poll per time, across an un-vote round trip ───────────

  it('sends nothing more after a member un-votes and votes yes again', async () => {
    const poll = await seedPoll('round-trip');
    await castVote(poll.slotId, poll.memberIds);
    expect(await service.checkMatch(poll.matchId)).toBe(1);

    const [flipper] = poll.memberIds.slice(2);
    await clearVote(poll.slotId, flipper);
    // Below 100% again: nothing to announce, and the claim is NOT given back.
    expect(await service.checkMatch(poll.matchId)).toBe(0);
    await castVote(poll.slotId, [flipper]);
    // Unanimous a second time — but this time was already announced.
    expect(await service.checkMatch(poll.matchId)).toBe(0);

    expect(await unanimousDmsFor(poll.creatorId)).toHaveLength(1);
  });

  it('announces a SECOND time on the same poll that also goes unanimous', async () => {
    const poll = await seedPoll('two-times');
    const slotB = await addSlot(poll.matchId, 96);
    await castVote(poll.slotId, poll.memberIds);
    expect(await service.checkMatch(poll.matchId)).toBe(1);

    await castVote(slotB, poll.memberIds);
    // "Once per poll per TIME" — the claim is keyed on the slot, so the
    // second time is its own announcement rather than a duplicate.
    expect(await service.checkMatch(poll.matchId)).toBe(1);

    const dms = await unanimousDmsFor(poll.creatorId);
    expect(dms).toHaveLength(2);
    const slotIds = dms
      .map((d) => (d.payload as { slotId?: number } | null)?.slotId)
      .sort((a, b) => Number(a) - Number(b));
    expect(slotIds).toEqual([poll.slotId, slotB].sort((a, b) => a - b));
    expect(await claimed(poll.matchId, slotB)).toBe(true);
  });

  // ── a failed send is retried, not lost ─────────────────────────────

  it('releases the claim when the send throws, and the next check delivers', async () => {
    const poll = await seedPoll('retry');
    await castVote(poll.slotId, poll.memberIds);
    const createSpy = jest
      .spyOn(notificationService, 'create')
      .mockRejectedValueOnce(new Error('Discord DM failed'));

    expect(await service.checkMatch(poll.matchId)).toBe(0);

    expect(await unanimousDmsFor(poll.creatorId)).toHaveLength(0);
    // The claim must be back, or every retry would be swallowed forever.
    expect(await claimed(poll.matchId, poll.slotId)).toBe(false);

    createSpy.mockRestore();
    expect(await service.checkMatch(poll.matchId)).toBe(1);

    expect(await unanimousDmsFor(poll.creatorId)).toHaveLength(1);
    expect(await claimed(poll.matchId, poll.slotId)).toBe(true);
  });

  // ── query-level exclusions ─────────────────────────────────────────

  it('never announces a time that has already passed', async () => {
    // Seeded directly: `toggleVote` refuses to answer a passed slot, so this
    // state is only reachable by the clock moving past an answered time.
    const poll = await seedPoll('past', { slotHours: -48 });
    await castVote(poll.slotId, poll.memberIds);

    expect(await service.checkMatch(poll.matchId)).toBe(0);
    expect(await service.checkMatch(null)).toBe(0);

    expect(await unanimousDmsFor(poll.creatorId)).toHaveLength(0);
    expect(await claimed(poll.matchId, poll.slotId)).toBe(false);
  });

  it('never announces a one-member match', async () => {
    // A solo poll's suggester auto-votes yes, so the creator would be DM'ing
    // themselves the moment they created the poll (Lead override of OQ-A).
    const poll = await seedPoll('solo', { members: 1 });
    await castVote(poll.slotId, poll.memberIds);
    expect(poll.memberIds).toHaveLength(1);

    expect(await service.checkMatch(poll.matchId)).toBe(0);
    expect(await service.checkMatch(null)).toBe(0);

    expect(await unanimousDmsFor(poll.creatorId)).toHaveLength(0);
    expect(await claimed(poll.matchId, poll.slotId)).toBe(false);
  });

  it('never announces a match that is no longer scheduling', async () => {
    const poll = await seedPoll('locked', { status: 'scheduled' });
    await castVote(poll.slotId, poll.memberIds);

    expect(await service.checkMatch(poll.matchId)).toBe(0);
    expect(await service.checkMatch(null)).toBe(0);

    expect(await unanimousDmsFor(poll.creatorId)).toHaveLength(0);
    expect(await claimed(poll.matchId, poll.slotId)).toBe(false);
  });

  // ── the cron sweep and the creator's own vote ──────────────────────

  it('finds the unanimous time in an unscoped sweep', async () => {
    const poll = await seedPoll('sweep');
    await castVote(poll.slotId, poll.memberIds);

    // The cron's call shape: no matchId, because the completing change can be
    // a member being REMOVED, which fires no vote hook at all.
    expect(await service.checkMatch(null)).toBe(1);

    const dms = await unanimousDmsFor(poll.creatorId);
    expect(dms).toHaveLength(1);
    expect(dms[0].payload).toMatchObject({ matchId: poll.matchId });
  });

  it('notifies the creator even when the creator cast the completing vote', async () => {
    const poll = await seedPoll('self');
    // Everyone but the creator has answered — the poll's owner is the one
    // still missing, so their own tap is what completes the set (OQ4).
    await castVote(poll.slotId, poll.memberIds.slice(1));
    expect(await service.checkMatch(poll.matchId)).toBe(0);

    await castVote(poll.slotId, [poll.creatorId]);
    expect(await service.checkMatch(poll.matchId)).toBe(1);

    expect(await unanimousDmsFor(poll.creatorId)).toHaveLength(1);
  });

  // ── the real vote route, through the un-awaited hook ───────────────

  it('announces the time when the completing vote arrives on the vote route', async () => {
    const voter = await createUserWithToken('route-voter');
    const poll = await seedPoll('route');
    await addMember(poll.matchId, voter.id);
    await castVote(poll.slotId, poll.memberIds);

    const res = await testApp.request
      .post(`/lineups/${poll.lineupId}/schedule/${poll.matchId}/vote`)
      .set('Authorization', `Bearer ${voter.token}`)
      .send({ slotId: poll.slotId });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ voted: true, stance: 'yes' });

    // `toggleVote` fires the check post-commit and does NOT await it, so the
    // row lands shortly after the response — polled, never slept on.
    await waitFor(async () => {
      const dms = await unanimousDmsFor(poll.creatorId);
      expect(dms).toHaveLength(1);
      expect(dms[0].payload).toMatchObject({ slotId: poll.slotId });
    });
    // All four members answered, so the copy counts four, not the seeded three.
    const [dm] = await unanimousDmsFor(poll.creatorId);
    expect(dm.message).toContain('All 4 members said yes to');
  });
}

describe(
  "Scheduling poll 'everyone picked this time' DM (integration, ROK-1632)",
  describeUnanimous,
);
