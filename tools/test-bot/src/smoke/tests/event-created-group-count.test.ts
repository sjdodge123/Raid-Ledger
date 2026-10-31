/**
 * ROK-1863 — the lineup channel's EVENT CREATED card says how much of the
 * group made the roster: under `👥 Players (N)` the field value ends with
 * `\n*<n> of <m> from the group signed up*` (italics — Discord does not
 * render `-#` subtext inside an embed field) when the roster is short, and
 * carries no such line when everyone in the group signed up.
 *
 * Fixture: a decided community LINEUP (not `POST /scheduling-polls`). Since
 * ROK-2054 a standalone poll's lock-in posts no lineup-channel card (the poll
 * card's LOCKED IN state is its announcement), so only a lineup match can
 * carry the group line. The lineup's one nominated game is voted by the admin
 * and fixture users A + B, then decided, so the match's group is admin + A +
 * B (`source: 'voted'`) — the same set the old standalone poll was created
 * with.
 *
 * Where the numbers come from (api `resolveEventRosterCard`):
 *   - M = the match members with a Discord id and not deactivated
 *     (`findMatchMemberUsers`).
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
import { archiveOwnLeftoverLineups } from '../lineup-leftovers.js';
import { awaitProcessing, deleteEvent, seedFixtureUser } from '../fixtures.js';
import type { FixtureUser } from '../fixtures.js';
import type { SmokeTest, TestContext } from '../types.js';
import {
  deleteLineup,
  loadSchedulingMatch,
  resolveLineupChannelId,
} from './lineup-scheduling-poll-card.test.js';

/**
 * Fixture slots 8 + 9, shared with the ROK-1874 / unanimous-DM poll smokes.
 * Votes are per poll and the card is keyed on THIS run's event id, so the
 * shared users cannot cross-contaminate.
 */
const MEMBER_A_SLOT = 8;
const MEMBER_B_SLOT = 9;
export const PLAYERS_PREFIX = '\u{1F465} Players (';
const GROUP_LINE_MARK = 'from the group';
const TITLE_PREFIX = 'Group Count ';
const OWN_TITLE_PREFIXES = [TITLE_PREFIX] as const;
const RUN_STARTED_AT = Date.now();

/** One decided lineup's scheduling match and the two members it voted with. */
interface GroupPoll {
  lineupId: number;
  base: string;
  memberA: FixtureUser;
  memberB: FixtureUser;
}

/** A suggested slot and its start instant (the card's `<t:<sec>:` stamp). */
export interface Slot {
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
export async function adminIsInGroup(ctx: TestContext): Promise<boolean> {
  const me = await ctx.api.get<{ discordId?: string | null }>('/auth/me');
  return typeof me?.discordId === 'string' && me.discordId.length > 0;
}

/**
 * A decided community lineup whose scheduling match's group is the admin +
 * fixture A + B (all three vote its one nominated game). `onLineupId` claims
 * the lineup id before any later call can throw, so cleanup never leaks it.
 */
async function createGroupPoll(
  ctx: TestContext,
  onLineupId: (id: number) => void,
): Promise<GroupPoll> {
  const memberA = await seedFixtureUser(ctx.api, 3, MEMBER_A_SLOT);
  const memberB = await seedFixtureUser(ctx.api, 3, MEMBER_B_SLOT);
  const gameId = await resolveGameId(ctx);
  const { id: lineupId } = await ctx.api.post<{ id: number }>('/lineups', {
    title: `${TITLE_PREFIX}${Date.now()}`,
    description: 'ROK-1863 EVENT CREATED group-count smoke',
    buildingDurationHours: 720,
    votingDurationHours: 720,
    decidedDurationHours: 720,
    matchThreshold: 10,
  });
  onLineupId(lineupId);
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
  return { lineupId, base, memberA, memberB };
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
export async function voteYes(member: FixtureUser, base: string, slotId: number) {
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
export function eventCardOf(
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

/** Shared guild — never leave the lineup or the event behind. */
async function cleanup(
  ctx: TestContext,
  lineupId: number | undefined,
  eventId: number | undefined,
): Promise<void> {
  if (eventId !== undefined) await deleteEvent(ctx.api, eventId);
  if (lineupId !== undefined) await deleteLineup(ctx.api, lineupId);
}

/** Assert the Players field names `count` players (the `(N)` in its name). */
export function assertPlayerCount(field: { name: string }, count: number): void {
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
    let lineupId: number | undefined;
    let eventId: number | undefined;
    await archiveOwnLeftoverLineups(ctx.api, OWN_TITLE_PREFIXES, RUN_STARTED_AT);
    try {
      const adminInGroup = await adminIsInGroup(ctx);
      const gp = await createGroupPoll(ctx, (id) => {
        lineupId = id;
      });
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
      await cleanup(ctx, lineupId, eventId);
    }
  },
};

const fullRosterHasNoGroupLine: SmokeTest = {
  name: 'ROK-1863: EVENT CREATED card has no group line when the whole group signed up',
  category: 'embed',
  async run(ctx: TestContext) {
    let lineupId: number | undefined;
    let eventId: number | undefined;
    await archiveOwnLeftoverLineups(ctx.api, OWN_TITLE_PREFIXES, RUN_STARTED_AT);
    try {
      const gp = await createGroupPoll(ctx, (id) => {
        lineupId = id;
      });
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
      await cleanup(ctx, lineupId, eventId);
    }
  },
};

export const eventCreatedGroupCountTests: SmokeTest[] = [
  shortRosterShowsGroupLine,
  fullRosterHasNoGroupLine,
];
