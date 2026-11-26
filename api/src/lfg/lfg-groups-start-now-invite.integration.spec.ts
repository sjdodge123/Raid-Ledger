/**
 * ROK-2352 — the two exits that must stay inside ONE group of a WoW game,
 * against a real DB through HTTP:
 *
 * - Invites (spec Q2): the repeat block is per `(game, group_key)` — the same
 *   person invited to dungeon:1 is refused a second dungeon:1 invite, but a
 *   dungeon:2 invite is sent (`findLiveInviteFor(..., groupKey)`).
 * - Start now (§3.8): `POST /lfg/:gameId/start-now?group=<key>` converts only
 *   the starter's hand in that group, shapes the event with the adapter's
 *   lock-in patch, and invites only that group's members. Two `now` hands in a
 *   keyed group never auto-spawn a session (the threshold spawn is game-level
 *   "playing now", `''` only) — AC5/AC6 in `lfg-groups-lock-in` pin that too.
 *
 * A stub `lfg-grouping` adapter owned by `blizzard` is registered on this
 * spec's own slug (same pattern as `lfg-groups-lock-in.integration.spec.ts`).
 */
import { eq } from 'drizzle-orm';
import type { LfgInviteResponseDto } from '@raid-ledger/contract';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import { EXTENSION_POINTS } from '../plugins/plugin-host/extension-points';
import type { LfgGroupingAdapter } from '../plugins/plugin-host/lfg-grouping.adapter';
import { PluginRegistryService } from '../plugins/plugin-host/plugin-registry.service';
import { DiscordNotificationService } from '../notifications/discord-notification.service';
import {
  createGame,
  createMembers,
  type LfgMember,
} from './lfg.integration.spec-helpers';
import { LFG_INVITE_SKIP_REASON } from './lfg-invite.constants';

const OWNER = 'blizzard';
const SLUG = 'rok2352-lfg-start-now-spec';
const SHAPE = { type: 'mmo' as const, tank: 1, healer: 1, dps: 3 };
const KEYS = ['dungeon:1', 'dungeon:2'];
type Urgency = 'now' | 'tonight' | 'week';

const stubAdapter: LfgGroupingAdapter = {
  behaviourId: 'rok2352-start-now-spec-grouping',
  listGroups: () => Promise.resolve([]),
  describeGroup: (_ctx, key) =>
    Promise.resolve(
      KEYS.includes(key) ? { key, label: key, kind: 'dungeon', size: 5 } : null,
    ),
  saveHandDetail: () => Promise.resolve(),
  readMemberDetails: () => Promise.resolve(new Map()),
  buildLockInPatch: (_tx, ctx) =>
    Promise.resolve({
      slotConfig: SHAPE,
      contentInstances: [{ id: ctx.groupKey, name: `Inst ${ctx.groupKey}` }],
      title: `Inst ${ctx.groupKey}`,
      carryover: new Map(),
    }),
  buildCarryover: () => Promise.resolve(new Map()),
};

let testApp: TestApp;
let registry: PluginRegistryService;

beforeAll(async () => {
  testApp = await getTestApp();
  registry = testApp.app.get(PluginRegistryService);
});

beforeEach(async () => {
  await registry.ensureInstalled(OWNER);
  await registry.activate(OWNER);
  registry.registerAdapter(EXTENSION_POINTS.LFG_GROUPING, SLUG, stubAdapter, {
    ownerPluginId: OWNER,
  });
  // Invites dispatch a DM; the outcome under test is the invite row.
  jest
    .spyOn(testApp.app.get(DiscordNotificationService), 'dispatch')
    .mockResolvedValue(undefined as never);
});

afterEach(async () => {
  jest.restoreAllMocks();
  testApp.seed = await truncateAllTables(testApp.db);
});

// ─── helpers ────────────────────────────────────────────────────────────────

async function hand(
  m: LfgMember,
  gameId: number,
  key: string,
  urgency: Urgency,
) {
  const res = await testApp.request
    .post('/lfg')
    .set('Authorization', `Bearer ${m.token}`)
    .send({ gameId, groupKey: key, urgency });
  expect(res.status).toBe(201);
}

/** Give a member a real Discord snowflake (an unlinked recipient is skipped). */
async function link(m: LfgMember): Promise<void> {
  await testApp.db
    .update(schema.users)
    .set({ discordId: `${100_000_000_000_000_000n + BigInt(m.userId)}` })
    .where(eq(schema.users.id, m.userId));
}

async function invite(
  from: LfgMember,
  gameId: number,
  to: LfgMember,
  group: string,
) {
  const res = await testApp.request
    .post(`/lfg/${gameId}/invites`)
    .query({ group })
    .set('Authorization', `Bearer ${from.token}`)
    .send({ userId: to.userId });
  return `${res.status} ${JSON.stringify(res.body as LfgInviteResponseDto)}`;
}

function startNow(m: LfgMember, gameId: number, group: string) {
  return testApp.request
    .post(`/lfg/${gameId}/start-now`)
    .query({ group })
    .set('Authorization', `Bearer ${m.token}`)
    .send({});
}

/** `"<userId>:<groupKey>" → status` for every hand of the game. */
async function handStatuses(gameId: number): Promise<Record<string, string>> {
  const rows = await testApp.db
    .select({
      userId: schema.lfgIntents.userId,
      groupKey: schema.lfgIntents.groupKey,
      status: schema.lfgIntents.status,
    })
    .from(schema.lfgIntents)
    .where(eq(schema.lfgIntents.gameId, gameId));
  return Object.fromEntries(
    rows.map((r) => [`${r.userId}:${r.groupKey}`, r.status]),
  );
}

const SENT = `200 ${JSON.stringify({ status: 'sent', reason: null })}`;
const SKIPPED = `200 ${JSON.stringify({ status: 'skipped', reason: LFG_INVITE_SKIP_REASON })}`;

// ─── scenarios ───────────────────────────────────────────────────────────────

describe('LFG invites are per group (ROK-2352 Q2)', () => {
  it('repeat-blocks the same group, still sends to another group of the game', async () => {
    const [h, r] = await createMembers(testApp, 'inv-h', 'inv-r');
    await link(r);
    const game = await createGame(testApp, 'Invite Spec', { slug: SLUG });
    await hand(h, game.id, 'dungeon:1', 'week');
    await hand(h, game.id, 'dungeon:2', 'week');

    expect(await invite(h, game.id, r, 'dungeon:1')).toBe(SENT);
    expect(await invite(h, game.id, r, 'dungeon:1')).toBe(SKIPPED);
    expect(await invite(h, game.id, r, 'dungeon:2')).toBe(SENT);

    const rows = await testApp.db
      .select({ groupKey: schema.lfgInvites.groupKey })
      .from(schema.lfgInvites)
      .where(eq(schema.lfgInvites.recipientUserId, r.userId));
    expect(rows.map((x) => x.groupKey).sort()).toEqual([
      'dungeon:1',
      'dungeon:2',
    ]);
  });
});

describe('Start now by group (ROK-2352 §3.8)', () => {
  it('converts only the starter hand in that group, shapes the event, invites that group only', async () => {
    const [a, b, c] = await createMembers(testApp, 'sn-a', 'sn-b', 'sn-c');
    await link(b);
    await link(c);
    const game = await createGame(testApp, 'Start Now Spec', { slug: SLUG });
    await hand(a, game.id, 'dungeon:1', 'now');
    await hand(b, game.id, 'dungeon:1', 'now');
    await hand(a, game.id, 'dungeon:2', 'now');
    await hand(c, game.id, 'dungeon:2', 'now');

    const res = await startNow(a, game.id, 'dungeon:1');

    expect(
      `${res.status} spawned=${String((res.body as { spawned?: boolean }).spawned)} invited=${String((res.body as { invited?: number }).invited)}`,
    ).toBe('200 spawned=true invited=1');
    const eventId = (res.body as { eventId: number }).eventId;
    const [event] = await testApp.db
      .select({
        title: schema.events.title,
        slotConfig: schema.events.slotConfig,
        contentInstances: schema.events.contentInstances,
      })
      .from(schema.events)
      .where(eq(schema.events.id, eventId));
    expect(event).toMatchObject({
      title: 'Inst dungeon:1',
      slotConfig: SHAPE,
      contentInstances: [{ id: 'dungeon:1', name: 'Inst dungeon:1' }],
    });
    // Q1 (review MAJOR-2): the starter's OTHER `now` hand clears in the
    // same locked tx; nobody else's hand moves.
    expect(await handStatuses(game.id)).toEqual({
      [`${a.userId}:dungeon:1`]: 'converted',
      [`${b.userId}:dungeon:1`]: 'active',
      [`${a.userId}:dungeon:2`]: 'cleared',
      [`${c.userId}:dungeon:2`]: 'active',
    });
  });

  it("keeps the starter's week hand in another group (Q1: only now hands clear)", async () => {
    const [a, b] = await createMembers(testApp, 'snw-a', 'snw-b');
    await link(b);
    const game = await createGame(testApp, 'Start Now Week', { slug: SLUG });
    await hand(a, game.id, 'dungeon:1', 'now');
    await hand(b, game.id, 'dungeon:1', 'now');
    await hand(a, game.id, 'dungeon:2', 'week');

    const res = await startNow(a, game.id, 'dungeon:1');

    expect(res.status).toBe(200);
    expect(await handStatuses(game.id)).toEqual({
      [`${a.userId}:dungeon:1`]: 'converted',
      [`${b.userId}:dungeon:1`]: 'active',
      [`${a.userId}:dungeon:2`]: 'active',
    });
  });

  it('400s an unknown ?group and creates no event', async () => {
    const [a] = await createMembers(testApp, 'sn-x');
    const game = await createGame(testApp, 'Start Now Bad Key', { slug: SLUG });
    await hand(a, game.id, 'dungeon:1', 'now');

    const res = await startNow(a, game.id, 'dungeon:99');

    expect(res.status).toBe(400);
    const events = await testApp.db
      .select({ id: schema.events.id })
      .from(schema.events)
      .where(eq(schema.events.gameId, game.id));
    expect(events).toEqual([]);
  });
});
