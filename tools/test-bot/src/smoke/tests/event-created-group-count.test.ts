/**
 * ROK-1863 — the lineup channel's EVENT CREATED card says how much of the
 * group made the roster: under `👥 Players (N)` the field value ends with
 * `\n*<n> of <m> from the group signed up*` (italics — Discord does not
 * render `-#` subtext inside an embed field) when the roster is short, and
 * carries no such line when everyone in the group signed up.
 *
 * Where the numbers come from (api `resolveEventRosterCard`):
 *   - M = the poll's match members with a Discord id and not deactivated
 *     (`findMatchMemberUsers`). The creator is always inserted as a member.
 *   - N = members of that group with an active signup on the created event.
 *     The lock-in signs up the locked slot's YES voters only (ROK-1617).
 *
 * The smoke admin's Discord link is environment-dependent, so it is read
 * from `/auth/me` rather than assumed: a linked admin is in M (and N, since
 * suggesting a slot auto-votes them YES); an unlinked one is in neither.
 *
 * The lock-in goes through `POST …/create-event`, the only path that fires
 * the EVENT CREATED card (`scheduling-event.helpers.ts` → `fireEventCreated`).
 * The card is posted to the LINEUP channel (`resolveLineupChannelId`: admin
 * lineup channel, else the default channel). It is found by its
 * `/events/<id>)` link AND the `<t:<start>:` timestamp of this run's slot —
 * event ids restart on every env reset, so another env sharing the guild can
 * post a card with the same id, but not with the same per-run start minute.
 * The channel is snapshotted BEFORE the lock-in so an earlier card can never
 * satisfy the probe.
 *
 * NOT covered: `0 of M` (only a non-member organiser rostered). The creator
 * is always a member here, so that card cannot be staged from the API; the
 * api unit spec covers it.
 *
 * Deterministic waits only — `awaitProcessing` + `pollForEmbed`.
 */
import { pollForEmbed, snapshotMessageIds } from '../../helpers/polling.js';
import type { SimpleEmbed, SimpleMessage } from '../../helpers/messages.js';
import { awaitProcessing, deleteEvent, seedFixtureUser } from '../fixtures.js';
import type { FixtureUser } from '../fixtures.js';
import type { SmokeTest, TestContext } from '../types.js';
import { resolveLineupChannelId } from './lineup-scheduling-poll-card.test.js';

/**
 * Fixture slots 8 + 9, shared with the ROK-1874 / unanimous-DM poll smokes.
 * Votes are per poll and the card is keyed on THIS run's event id, so the
 * shared users cannot cross-contaminate.
 */
const MEMBER_A_SLOT = 8;
const MEMBER_B_SLOT = 9;
const PLAYERS_PREFIX = '\u{1F465} Players (';
const GROUP_LINE_MARK = 'from the group';

interface CreatePollResponse {
  id: number;
  lineupId: number;
}

/** One poll under test and the two members it was created with. */
interface GroupPoll {
  poll: CreatePollResponse;
  base: string;
  memberA: FixtureUser;
  memberB: FixtureUser;
}

/** A suggested slot and its start instant (the card's `<t:<sec>:` stamp). */
interface Slot {
  id: number;
  startSec: number;
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

/** True when the smoke admin is Discord-linked, i.e. counted in M. */
async function adminIsInGroup(ctx: TestContext): Promise<boolean> {
  const me = await ctx.api.get<{ discordId?: string | null }>('/auth/me');
  return typeof me?.discordId === 'string' && me.discordId.length > 0;
}

/** A public standalone poll whose group is the admin + fixture A + B. */
async function createGroupPoll(ctx: TestContext): Promise<GroupPoll> {
  const memberA = await seedFixtureUser(ctx.api, 3, MEMBER_A_SLOT);
  const memberB = await seedFixtureUser(ctx.api, 3, MEMBER_B_SLOT);
  const poll = await ctx.api.post<CreatePollResponse>('/scheduling-polls', {
    gameId: await resolveGameId(ctx),
    durationHours: 24,
    memberUserIds: [memberA.userId, memberB.userId],
  });
  const base = `/lineups/${poll.lineupId}/schedule/${poll.id}`;
  return { poll, base, memberA, memberB };
}

/**
 * Suggest a slot `daysOut` days ahead on a per-run minute (auto-votes the
 * admin YES) so a previous run's event cannot share this instant.
 */
async function suggestSlot(
  gp: GroupPoll,
  ctx: TestContext,
  daysOut: number,
): Promise<Slot> {
  const start = new Date(
    Date.now() + daysOut * 86_400_000 + (Date.now() % 600) * 60_000,
  );
  start.setSeconds(0, 0);
  const { id } = await ctx.api.post<{ id: number }>(`${gp.base}/suggest`, {
    proposedTime: start.toISOString(),
  });
  return { id, startSec: Math.floor(start.getTime() / 1000) };
}

/** Vote YES on `slotId` as `member`, asserting the toggle landed ON. */
async function voteYes(member: FixtureUser, base: string, slotId: number) {
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

/**
 * THIS run's EVENT CREATED embed, if this message has it: it links
 * `/events/<eventId>` and stamps this run's slot start.
 */
function eventCardOf(
  m: SimpleMessage,
  eventId: number,
  slot: Slot,
): SimpleEmbed | undefined {
  const link = `/events/${eventId})`;
  const stamp = `<t:${slot.startSec}:`;
  return m.embeds.find((e) => {
    const d = e.description ?? '';
    return d.includes(link) && d.includes(stamp);
  });
}

/**
 * Lock the slot in via `create-event` and wait for THIS event's card in the
 * lineup channel. Returns the event id (claimed before any assertion) and
 * the card's Players field.
 */
async function lockInAndReadPlayers(
  ctx: TestContext,
  gp: GroupPoll,
  slot: Slot,
  onEventId: (id: number) => void,
): Promise<{ name: string; value: string }> {
  const channelId = await resolveLineupChannelId(ctx.api, ctx.defaultChannelId);
  const ghostIds = await snapshotMessageIds(channelId);
  const { eventId } = await ctx.api.post<{ eventId: number }>(
    `${gp.base}/create-event`,
    { slotId: slot.id },
  );
  onEventId(eventId);
  await awaitProcessing(ctx.api);
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

/** Shared guild — never leave the poll or the event behind. */
async function cleanup(
  ctx: TestContext,
  gp: GroupPoll | undefined,
  eventId: number | undefined,
): Promise<void> {
  if (gp) {
    await ctx.api
      .post(`${gp.base}/cancel`, { reason: 'smoke cleanup ROK-1863' })
      .catch(() => null);
    await ctx.api
      .patch(`/lineups/${gp.poll.lineupId}/status`, { status: 'archived' })
      .catch(() => null);
  }
  if (eventId !== undefined) await deleteEvent(ctx.api, eventId);
}

/** Assert the Players field names `count` players (the `(N)` in its name). */
function assertPlayerCount(field: { name: string }, count: number): void {
  const expected = `${PLAYERS_PREFIX}${count})`;
  if (field.name !== expected) {
    throw new Error(
      `Expected the Players field name "${expected}", got "${field.name}"`,
    );
  }
}

const shortRosterShowsGroupLine: SmokeTest = {
  name: 'ROK-1863: EVENT CREATED card says "N of M from the group signed up"',
  category: 'embed',
  async run(ctx: TestContext) {
    let gp: GroupPoll | undefined;
    let eventId: number | undefined;
    try {
      const adminInGroup = await adminIsInGroup(ctx);
      gp = await createGroupPoll(ctx);
      const slot = await suggestSlot(gp, ctx, 10);
      await voteYes(gp.memberA, gp.base, slot.id); // B never votes
      await awaitProcessing(ctx.api);

      const players = await lockInAndReadPlayers(ctx, gp, slot, (id) => {
        eventId = id;
      });
      // Rostered: admin + A. Group: A + B, plus the admin when linked.
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
      await cleanup(ctx, gp, eventId);
    }
  },
};

const fullRosterHasNoGroupLine: SmokeTest = {
  name: 'ROK-1863: EVENT CREATED card has no group line when the whole group signed up',
  category: 'embed',
  async run(ctx: TestContext) {
    let gp: GroupPoll | undefined;
    let eventId: number | undefined;
    try {
      gp = await createGroupPoll(ctx);
      const slot = await suggestSlot(gp, ctx, 11);
      await voteYes(gp.memberA, gp.base, slot.id);
      await voteYes(gp.memberB, gp.base, slot.id);
      await awaitProcessing(ctx.api);

      const players = await lockInAndReadPlayers(ctx, gp, slot, (id) => {
        eventId = id;
      });
      assertPlayerCount(players, 3); // admin + A + B
      if (players.value.includes(GROUP_LINE_MARK) || players.value.includes('-#')) {
        throw new Error(
          'Expected no "from the group" subtext when every member is rostered, ' +
            `got ${JSON.stringify(players.value)}`,
        );
      }
    } finally {
      await cleanup(ctx, gp, eventId);
    }
  },
};

export const eventCreatedGroupCountTests: SmokeTest[] = [
  shortRosterShowsGroupLine,
  fullRosterHasNoGroupLine,
];
