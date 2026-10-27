/**
 * ROK-2024 — the OPEN lock-in of a community LINEUP match announces EVENT
 * CREATED in the lineup channel.
 *
 * The web poll page locks an open poll in with two calls ("⋯ Poll actions" →
 * "Lock this time" → "Create anyway" → the create form's "Create Event"):
 * `POST /events {schedulingMatchId}` then
 * `POST /scheduling-polls/:matchId/complete {eventId, startTime}`. Before the
 * fix, `complete` 404'd for a regular lineup match (only standalone polls were
 * found), the match stayed `scheduling` with no linked event, the yes-voters
 * were never signed up, and no EVENT CREATED card was posted — only the
 * expired lock-in (`POST …/create-event`, covered by
 * `event-created-group-count.test.ts`) fired one.
 *
 * Fixture: a real community lineup (not `POST /scheduling-polls`, which makes
 * a standalone poll) whose one nominated game is voted by the admin and
 * fixture users A + B, then decided — so the match's group is admin + A + B
 * (`source: 'voted'`). A slot is suggested on a per-run minute (auto-votes
 * the admin YES) and A votes YES; B never votes. `complete` signs up the
 * slot's YES voters, so the card's Players field is `(2)` and carries the
 * ROK-1863 short-roster group line.
 *
 * The card is found exactly as the ROK-1863 smoke finds it (lineup channel,
 * snapshot BEFORE the lock-in, `/events/<id>)` link + this run's `<t:<start>:`
 * stamp). Deterministic waits only — `awaitProcessing` + `pollForEmbed`.
 */
import { pollForEmbed, snapshotMessageIds } from '../../helpers/polling.js';
import { archiveOwnLeftoverLineups } from '../lineup-leftovers.js';
import { awaitProcessing, deleteEvent, seedFixtureUser } from '../fixtures.js';
import type { FixtureUser } from '../fixtures.js';
import type { SmokeTest, TestContext } from '../types.js';
import {
  PLAYERS_PREFIX,
  adminIsInGroup,
  assertPlayerCount,
  eventCardOf,
  voteYes,
  type Slot,
} from './event-created-group-count.test.js';
import {
  deleteLineup,
  loadSchedulingMatch,
  resolveLineupChannelId,
} from './lineup-scheduling-poll-card.test.js';

/** Same fixture slots as the ROK-1863 smoke; the runner is serial. */
const MEMBER_A_SLOT = 8;
const MEMBER_B_SLOT = 9;
const TITLE_PREFIX = 'Open Lockin ';
const OWN_TITLE_PREFIXES = [TITLE_PREFIX] as const;
const RUN_STARTED_AT = Date.now();
const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

/** A decided community lineup, its scheduling match and its group. */
interface LineupPoll {
  lineupId: number;
  matchId: number;
  gameId: number;
  base: string;
  memberA: FixtureUser;
  memberB: FixtureUser;
}

/** The poll page's view of the match after the lock-in. */
interface PollPage {
  match?: { status?: string; linkedEventId?: number | null };
}

async function firstConfiguredGameId(ctx: TestContext): Promise<number> {
  const res = await ctx.api.get<{ data: { id: number }[] }>('/games/configured');
  const id = res?.data?.[0]?.id;
  if (id === undefined) throw new Error('Need at least 1 configured game');
  return id;
}

/**
 * Build a community lineup whose single game is voted by admin + A + B, and
 * decide it so that game's match lands in `scheduling` with all three as
 * members.
 */
async function buildGroupLineupPoll(ctx: TestContext): Promise<LineupPoll> {
  const memberA = await seedFixtureUser(ctx.api, 3, MEMBER_A_SLOT);
  const memberB = await seedFixtureUser(ctx.api, 3, MEMBER_B_SLOT);
  const gameId = await firstConfiguredGameId(ctx);
  const lineup = await ctx.api.post<{ id: number }>('/lineups', {
    title: `${TITLE_PREFIX}${Date.now()}`,
    description: 'ROK-2024 open lock-in EVENT CREATED smoke',
    buildingDurationHours: 720,
    votingDurationHours: 720,
    decidedDurationHours: 720,
    matchThreshold: 10,
  });
  const lineupId = lineup.id;
  await ctx.api.post(`/lineups/${lineupId}/nominate`, { gameId });
  await ctx.api.patch(`/lineups/${lineupId}/status`, { status: 'voting' });
  for (const voter of [ctx.api, memberA.api, memberB.api]) {
    await voter.post(`/lineups/${lineupId}/vote`, { gameId });
  }
  await ctx.api.patch(`/lineups/${lineupId}/status`, {
    status: 'decided',
    decidedGameId: gameId,
  });
  await awaitProcessing(ctx.api);
  const match = await loadSchedulingMatch(ctx.api, lineupId);
  const base = `/lineups/${lineupId}/schedule/${match.id}`;
  return { lineupId, matchId: match.id, gameId, base, memberA, memberB };
}

/** Suggest a slot `daysOut` ahead on a per-run minute (auto-votes admin). */
async function suggestSlot(
  ctx: TestContext,
  lp: LineupPoll,
  daysOut: number,
): Promise<Slot & { iso: string }> {
  const start = new Date(
    Date.now() + daysOut * 86_400_000 + (Date.now() % 600) * 60_000,
  );
  start.setSeconds(0, 0);
  const iso = start.toISOString();
  const { id } = await ctx.api.post<{ id: number }>(`${lp.base}/suggest`, {
    proposedTime: iso,
  });
  return { id, startSec: Math.floor(start.getTime() / 1000), iso };
}

/**
 * The web form's open lock-in, call for call: create the event stamped with
 * the poll, then complete the poll with the event and the slot's instant.
 * `complete` must answer 200 — the ROK-2024 bug was a 404 here.
 */
async function openLockIn(
  ctx: TestContext,
  lp: LineupPoll,
  slot: Slot & { iso: string },
  onEventId: (id: number) => void,
): Promise<number> {
  const end = new Date(new Date(slot.iso).getTime() + TWO_HOURS_MS);
  const event = await ctx.api.post<{ id: number }>('/events', {
    title: `ROK-2024 open lock-in ${slot.startSec}`,
    startTime: slot.iso,
    endTime: end.toISOString(),
    gameId: lp.gameId,
    schedulingMatchId: lp.matchId,
  });
  onEventId(event.id);
  const done = await ctx.api.post<{ ok?: boolean }>(
    `/scheduling-polls/${lp.matchId}/complete`,
    { eventId: event.id, startTime: slot.iso },
  );
  if (done?.ok !== true) {
    throw new Error(
      `ROK-2024: complete on lineup match ${lp.matchId} must answer ` +
        `{ ok: true }, got ${JSON.stringify(done)}`,
    );
  }
  return event.id;
}

/** The match must now be `scheduled` and linked to the created event. */
async function assertMatchScheduled(
  ctx: TestContext,
  lp: LineupPoll,
  eventId: number,
): Promise<void> {
  const page = await ctx.api.get<PollPage>(lp.base);
  const status = page?.match?.status;
  const linked = page?.match?.linkedEventId;
  if (status !== 'scheduled' || linked !== eventId) {
    throw new Error(
      `ROK-2024: expected match ${lp.matchId} scheduled + linked to event ` +
        `${eventId}, got status=${String(status)} linkedEventId=${String(linked)}`,
    );
  }
}

/** Wait for THIS event's EVENT CREATED card; return its Players field. */
async function readPlayersField(
  ctx: TestContext,
  channelId: string,
  ghostIds: Set<string>,
  eventId: number,
  slot: Slot,
): Promise<{ name: string; value: string }> {
  const msg = await pollForEmbed(
    channelId,
    (m) => eventCardOf(m, eventId, slot) !== undefined,
    ctx.config.timeoutMs,
    { excludeIds: ghostIds },
  );
  const card = eventCardOf(msg, eventId, slot);
  if (!card) throw new Error(`EVENT CREATED card for event ${eventId} vanished`);
  const players = card.fields.find((f) => f.name.startsWith(PLAYERS_PREFIX));
  if (!players) {
    throw new Error(
      `Expected a "${PLAYERS_PREFIX}…" field on event ${eventId}'s card, got ` +
        JSON.stringify(card.fields.map((f) => f.name)),
    );
  }
  return players;
}

const openLockInPostsEventCreated: SmokeTest = {
  name: 'ROK-2024: open lock-in of a lineup poll posts EVENT CREATED with the group line',
  category: 'embed',
  async run(ctx: TestContext) {
    await archiveOwnLeftoverLineups(ctx.api, OWN_TITLE_PREFIXES, RUN_STARTED_AT);
    let lp: LineupPoll | undefined;
    let eventId: number | undefined;
    try {
      const adminInGroup = await adminIsInGroup(ctx);
      lp = await buildGroupLineupPoll(ctx);
      const slot = await suggestSlot(ctx, lp, 12);
      await voteYes(lp.memberA, lp.base, slot.id); // B never votes
      await awaitProcessing(ctx.api);

      const channelId = await resolveLineupChannelId(
        ctx.api,
        ctx.defaultChannelId,
      );
      const ghostIds = await snapshotMessageIds(channelId);
      const id = await openLockIn(ctx, lp, slot, (created) => {
        eventId = created;
      });
      await awaitProcessing(ctx.api);
      await assertMatchScheduled(ctx, lp, id);

      const players = await readPlayersField(ctx, channelId, ghostIds, id, slot);
      // Rostered by `complete`: the slot's YES voters, admin + A.
      assertPlayerCount(players, 2);
      const n = adminInGroup ? 2 : 1;
      const m = adminInGroup ? 3 : 2;
      const line = `\n*${n} of ${m} from the group signed up*`;
      if (!players.value.endsWith(line)) {
        throw new Error(
          `Expected the Players field to end with ${JSON.stringify(line)} ` +
            `(admin in group: ${adminInGroup}), got ${JSON.stringify(players.value)}`,
        );
      }
    } finally {
      if (eventId !== undefined) await deleteEvent(ctx.api, eventId);
      if (lp) await deleteLineup(ctx.api, lp.lineupId);
    }
  },
};

export const eventCreatedOpenLockInTests: SmokeTest[] = [
  openLockInPostsEventCreated,
];
