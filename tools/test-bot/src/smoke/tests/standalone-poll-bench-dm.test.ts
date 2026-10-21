/**
 * ROK-1874 — "On the bench" DM for a voter auto-benched by a poll lock-in.
 *
 * Locking a scheduling slot creates the event (POST /events signs the
 * creator up first) and then completes the poll, which signs up every
 * yes-voter on the chosen slot. Past the roster cap the signup lands on the
 * bench, and that voter now gets `On the bench` instead of `Auto-signed up`.
 *
 * Shape: a 2-spot generic roster (`slotConfig.player = 2`, `maxAttendees =
 * 2`), the admin (creator) + fixture members A and B all voting YES on one
 * slot ⇒ rostered 3, cap 2, exactly ONE of A/B benched. Which one is NOT
 * deterministic (spec "Bench order today"), so the assertion is "exactly one
 * of A/B got `On the bench`, the other got `Auto-signed up`, nobody got both".
 *
 * Bot DM rationale: the companion bot cannot receive a DM from another bot
 * (Discord API 50007) and the fixture members are not real Discord accounts,
 * so the in-app `notifications` row (read via the DEMO_MODE
 * `/admin/test/notifications` endpoint) is the canonical proof of dispatch —
 * the same tier as `scheduling-unanimous-dm.test.ts`. Rows are scoped to THIS
 * run by `payload.eventId`, so a reused fixture slot cannot leak an earlier
 * run's DM into the count.
 *
 * Deterministic waits only — `pollForCondition` + `awaitProcessing`, never a
 * fixed timer (`npm run lint:no-sleep`).
 */
import { pollForCondition } from '../../helpers/polling.js';
import { awaitProcessing, deleteEvent, seedFixtureUser } from '../fixtures.js';
import type { FixtureUser } from '../fixtures.js';
import type { SmokeTest, TestContext } from '../types.js';
import type { ApiClient } from '../api.js';

/**
 * Fixture slots 8 + 9, shared with `scheduling-unanimous-dm.test.ts`. Votes
 * are per poll and every notification read below is keyed on this run's
 * `eventId`, so sharing the users cannot cross-contaminate either test.
 */
const MEMBER_A_SLOT = 8;
const MEMBER_B_SLOT = 9;
const ROSTER_CAP = 2;
const TWO_HOURS_MS = 2 * 3_600_000;

const BENCH_TITLE = 'On the bench';
const BENCH_MESSAGE_RE = /roster was full/i;
/** Gap between the two equal reads that prove the DM total stopped moving. */
const STABLE_GAP_MS = 2_000;
const AUTO_TITLE = 'Auto-signed up';
const AUTO_MESSAGE_RE = /automatically signed up/i;

interface CreatePollResponse {
  id: number;
  lineupId: number;
}

interface TestNotification {
  id: number;
  title?: string;
  message?: string;
  payload?: { subtype?: string; eventId?: number } | null;
}

interface RosterRow {
  userId?: number;
  slot?: string | null;
}

/** Resolve a configured gameId (MMO binding → /games/configured). */
async function resolveGameId(ctx: TestContext): Promise<number> {
  const fromCtx = ctx.games[0]?.id ?? ctx.mmoGameId;
  if (fromCtx) return fromCtx;
  const res = await ctx.api.get<{ data: { id: number }[] }>('/games/configured');
  const id = res?.data?.[0]?.id;
  if (!id) throw new Error('Need at least one configured game for the poll');
  return id;
}

/** `userId`'s community_lineup notifications for THIS event only. */
async function notesForEvent(
  api: ApiClient,
  userId: number,
  eventId: number,
): Promise<TestNotification[]> {
  const res = await api
    .get<TestNotification[]>(
      `/admin/test/notifications?userId=${userId}&type=community_lineup&limit=50`,
    )
    .catch(() => [] as TestNotification[]);
  const list = Array.isArray(res) ? res : [];
  return list.filter((n) => Number(n.payload?.eventId) === eventId);
}

/** Vote YES on `slotId` as `member`, asserting the toggle landed ON. */
async function voteYes(
  member: FixtureUser,
  base: string,
  slotId: number,
): Promise<void> {
  const res = await member.api.post<{ voted: boolean }>(`${base}/vote`, {
    slotId,
  });
  if (res.voted !== true) {
    throw new Error(
      `Expected user ${member.userId}'s vote on slot ${slotId} to be YES, ` +
        `got ${JSON.stringify(res)}`,
    );
  }
}

/** Every user's notifications for the event, keyed by user id. */
async function readNotes(
  ctx: TestContext,
  userIds: number[],
  eventId: number,
): Promise<Map<number, TestNotification[]>> {
  const seen = new Map<number, TestNotification[]>();
  for (const uid of userIds) {
    seen.set(uid, await notesForEvent(ctx.api, uid, eventId));
  }
  return seen;
}

const totalNotes = (notes: Map<number, TestNotification[]>): number =>
  [...notes.values()].reduce((sum, n) => sum + n.length, 0);

/**
 * Re-read until the DM total is the same on two reads STABLE_GAP_MS apart, so
 * a late second DM (fire-and-forget) lands before the "exactly one" checks.
 */
async function waitForStableNotes(
  ctx: TestContext,
  userIds: number[],
  eventId: number,
): Promise<Map<number, TestNotification[]>> {
  let lastTotal = -1;
  return pollForCondition(
    async () => {
      const notes = await readNotes(ctx, userIds, eventId);
      const prev = lastTotal;
      lastTotal = totalNotes(notes);
      return lastTotal === prev ? notes : null;
    },
    ctx.config.timeoutMs,
    { intervalMs: STABLE_GAP_MS, backoff: false },
  );
}

/** Poll until every user in `userIds` holds a notification for the event. */
async function waitForEveryoneNotified(
  ctx: TestContext,
  userIds: number[],
  eventId: number,
): Promise<Map<number, TestNotification[]>> {
  let seen = new Map<number, TestNotification[]>();
  return pollForCondition(
    async () => {
      seen = await readNotes(ctx, userIds, eventId);
      const all = [...seen.values()].every((notes) => notes.length > 0);
      return all ? seen : null;
    },
    ctx.config.timeoutMs,
    { intervalMs: 1500 },
  ).catch(() => {
    const got = [...seen.entries()].map(
      ([uid, notes]) => `${uid}:[${notes.map((n) => n.title).join('|')}]`,
    );
    throw new Error(
      `Not every voter got a lock-in notification for event ${eventId}; ` +
        `received ${got.join(', ')}`,
    );
  });
}

/** Who sits on the bench of the event's roster (API side of AC5). */
async function benchedUserIds(api: ApiClient, eventId: number): Promise<number[]> {
  const roster = await api.get<{ assignments?: RosterRow[]; pool?: RosterRow[] }>(
    `/events/${eventId}/roster/assignments`,
  );
  const rows = [...(roster?.assignments ?? []), ...(roster?.pool ?? [])];
  return rows
    .filter(
      (r): r is RosterRow & { userId: number } =>
        r.slot === 'bench' && typeof r.userId === 'number',
    )
    .map((r) => r.userId);
}

/** One voter's notes must be exactly one DM matching `kind`. */
function assertSingleDm(
  uid: number,
  notes: TestNotification[],
  kind: 'bench' | 'auto',
): void {
  if (notes.length !== 1) {
    throw new Error(
      `User ${uid} should get exactly one lock-in DM, got ` +
        `[${notes.map((n) => n.title).join(' | ')}]`,
    );
  }
  const [note] = notes;
  const title = note?.title ?? '';
  const message = note?.message ?? '';
  const ok = kind === 'bench'
    ? title === BENCH_TITLE && BENCH_MESSAGE_RE.test(message)
    : title === AUTO_TITLE && AUTO_MESSAGE_RE.test(message);
  if (!ok) {
    throw new Error(
      `User ${uid} expected the ${kind} DM, got title ` +
        `${JSON.stringify(title)} message ${JSON.stringify(message)}`,
    );
  }
}

/** AC5: exactly one of A/B benched; the other + the creator auto-signed up. */
function assertBenchSplit(
  notes: Map<number, TestNotification[]>,
  creatorId: number,
  memberIds: number[],
): number {
  const isBench = (uid: number) =>
    (notes.get(uid) ?? []).some((n) => n.title === BENCH_TITLE);
  const benched = memberIds.filter(isBench);
  if (benched.length !== 1) {
    throw new Error(
      `Expected exactly one of [${memberIds.join(', ')}] to get "On the ` +
        `bench" on a ${ROSTER_CAP}-spot roster, got [${benched.join(', ')}]`,
    );
  }
  const [benchedId] = benched;
  if (benchedId === undefined) throw new Error('No benched voter after the length check');
  for (const uid of [creatorId, ...memberIds]) {
    assertSingleDm(uid, notes.get(uid) ?? [], uid === benchedId ? 'bench' : 'auto');
  }
  return benchedId;
}

/**
 * "Lock this time", as the web does it: POST /events on a 2-spot generic
 * roster with `schedulingMatchId` (signs the creator up first), then complete
 * the poll, which auto-signs-up the slot's yes-voters and sends their DMs.
 */
async function lockIn(
  api: ApiClient,
  gameId: number,
  matchId: number,
  start: Date,
): Promise<number> {
  const event = await api.post<{ id: number }>('/events', {
    title: `smoke-bench-dm-${matchId}`,
    startTime: start.toISOString(),
    endTime: new Date(start.getTime() + TWO_HOURS_MS).toISOString(),
    gameId,
    slotConfig: { type: 'generic', player: ROSTER_CAP },
    maxAttendees: ROSTER_CAP,
    schedulingMatchId: matchId,
  });
  await api.post(`/scheduling-polls/${matchId}/complete`, {
    eventId: event.id,
    startTime: start.toISOString(),
  });
  await awaitProcessing(api);
  return event.id;
}

const benchDmForOverCapVoter: SmokeTest = {
  name: 'ROK-1874: a voter benched by an over-cap poll lock-in gets "On the bench"',
  category: 'dm',
  async run(ctx: TestContext) {
    const gameId = await resolveGameId(ctx);
    const memberA = await seedFixtureUser(ctx.api, 3, MEMBER_A_SLOT);
    const memberB = await seedFixtureUser(ctx.api, 3, MEMBER_B_SLOT);
    const poll = await ctx.api.post<CreatePollResponse>('/scheduling-polls', {
      gameId,
      durationHours: 24,
      memberUserIds: [memberA.userId, memberB.userId],
    });
    const base = `/lineups/${poll.lineupId}/schedule/${poll.id}`;
    let eventId: number | null = null;

    try {
      // A unique minute per run so a parallel/previous run's event can't
      // collide with this slot's instant.
      const start = new Date(
        Date.now() + 9 * 86_400_000 + (Date.now() % 600) * 60_000,
      );
      start.setSeconds(0, 0);
      // Suggesting auto-votes the admin YES — the creator votes too.
      const { id: slotId } = await ctx.api.post<{ id: number }>(
        `${base}/suggest`,
        { proposedTime: start.toISOString() },
      );
      await voteYes(memberA, base, slotId);
      await voteYes(memberB, base, slotId);
      await awaitProcessing(ctx.api);

      eventId = await lockIn(ctx.api, gameId, poll.id, start);

      const memberIds = [memberA.userId, memberB.userId];
      const voterIds = [ctx.testUserId, ...memberIds];
      await waitForEveryoneNotified(ctx, voterIds, eventId);
      // No voter gets both DMs: assert one each only once the total settles.
      const notes = await waitForStableNotes(ctx, voterIds, eventId);
      const benchedId = assertBenchSplit(notes, ctx.testUserId, memberIds);

      // The DM must agree with the roster: the benched voter IS on the bench.
      const bench = await benchedUserIds(ctx.api, eventId);
      if (bench.length !== 1 || bench[0] !== benchedId) {
        throw new Error(
          `"On the bench" went to ${benchedId}, but the roster's bench is ` +
            `[${bench.join(', ')}]`,
        );
      }
    } finally {
      // Shared guild — never leave the poll or the event behind. After a
      // lock-in the poll is completed, so cancel no-ops; archive + delete clean up.
      await ctx.api
        .post(`${base}/cancel`, { reason: 'smoke cleanup ROK-1874' })
        .catch(() => null);
      await ctx.api
        .patch(`/lineups/${poll.lineupId}/status`, { status: 'archived' })
        .catch(() => null);
      if (eventId !== null) await deleteEvent(ctx.api, eventId).catch(() => null);
    }
  },
};

export const standalonePollBenchDmTests: SmokeTest[] = [benchDmForOverCapVoter];
