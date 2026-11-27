/**
 * ROK-2352 Codex P1-1..P1-4 — a keyed Start now session stays inside its
 * group, against a real DB:
 *
 * - P1-1: a voice join converts only the session group's hand.
 * - P1-2: a keyed Start now signs the starter up role-aware (carryover).
 * - P1-3: its invites carry the group key.
 * - P1-4 (ruled "attach"): a late keyed `now` hand attaches to that group's
 *   already-started session; an Any change never touches it.
 *
 * Stub `lfg-grouping` adapter owned by `blizzard` on this spec's own slug
 * (same pattern as `lfg-groups-start-now-invite.integration.spec.ts`).
 */
import { and, eq } from 'drizzle-orm';
import type { CreateSignupDto } from '@raid-ledger/contract';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import { EXTENSION_POINTS } from '../plugins/plugin-host/extension-points';
import type { LfgGroupingAdapter } from '../plugins/plugin-host/lfg-grouping.adapter';
import { PluginRegistryService } from '../plugins/plugin-host/plugin-registry.service';
import { DiscordNotificationService } from '../notifications/discord-notification.service';
import { LfgNowSpawnService } from '../discord-bot/lfg-now/lfg-now-spawn.service';
import { LfgQuickPlayListener } from './lfg-quickplay.listener';
import {
  createGame,
  createMembers,
  type LfgMember,
} from './lfg.integration.spec-helpers';

const OWNER = 'blizzard';
const SLUG = 'rok2352-lfg-start-now-session-spec';
const SHAPE = { type: 'mmo' as const, tank: 1, healer: 1, dps: 3 };
const KEYS = ['dungeon:1', 'dungeon:2'];
type Urgency = 'now' | 'tonight' | 'week';

/** userId → carried signup; set per test before Start now. */
let carryover = new Map<number, CreateSignupDto>();

const stubAdapter: LfgGroupingAdapter = {
  behaviourId: 'rok2352-start-now-session-spec-grouping',
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
      carryover: new Map(carryover),
    }),
  buildCarryover: () => Promise.resolve(new Map(carryover)),
};

let testApp: TestApp;
let registry: PluginRegistryService;

beforeAll(async () => {
  testApp = await getTestApp();
  registry = testApp.app.get(PluginRegistryService);
});

beforeEach(async () => {
  carryover = new Map();
  await registry.ensureInstalled(OWNER);
  await registry.activate(OWNER);
  registry.registerAdapter(EXTENSION_POINTS.LFG_GROUPING, SLUG, stubAdapter, {
    ownerPluginId: OWNER,
  });
  jest
    .spyOn(testApp.app.get(DiscordNotificationService), 'dispatch')
    .mockResolvedValue(undefined as never);
});

afterEach(async () => {
  jest.restoreAllMocks();
  testApp.seed = await truncateAllTables(testApp.db);
});

async function hand(m: LfgMember, gameId: number, key: string, u: Urgency) {
  const res = await testApp.request
    .post('/lfg')
    .set('Authorization', `Bearer ${m.token}`)
    .send({
      gameId,
      groupKey: key,
      urgency: u,
      handDetail: { roles: ['dps'] },
    });
  expect(res.status).toBe(201);
}

async function link(m: LfgMember): Promise<void> {
  await testApp.db
    .update(schema.users)
    .set({ discordId: `${200_000_000_000_000_000n + BigInt(m.userId)}` })
    .where(eq(schema.users.id, m.userId));
}

async function startNow(m: LfgMember, gameId: number, group: string) {
  const res = await testApp.request
    .post(`/lfg/${gameId}/start-now`)
    .query({ group })
    .set('Authorization', `Bearer ${m.token}`)
    .send({});
  expect(res.status).toBe(200);
  return (res.body as { eventId: number }).eventId;
}

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

/** `role` of the user's roster slot on the event, or 'none'. */
async function rosterRole(eventId: number, userId: number): Promise<string> {
  const [row] = await testApp.db
    .select({ role: schema.rosterAssignments.role })
    .from(schema.rosterAssignments)
    .innerJoin(
      schema.eventSignups,
      eq(schema.eventSignups.id, schema.rosterAssignments.signupId),
    )
    .where(
      and(
        eq(schema.rosterAssignments.eventId, eventId),
        eq(schema.eventSignups.userId, userId),
      ),
    );
  return row?.role ?? 'none';
}

function voiceJoin(eventId: number, userId: number) {
  return testApp.app
    .get(LfgQuickPlayListener)
    .onParticipantJoined({ eventId, userId });
}

describe('Keyed Start now session (ROK-2352 Codex lane A)', () => {
  it('P1-2: signs the starter into the role slot their carryover names', async () => {
    const [a, b] = await createMembers(testApp, 'p12-a', 'p12-b');
    const game = await createGame(testApp, 'P12', { slug: SLUG });
    await hand(a, game.id, 'dungeon:1', 'now');
    await hand(b, game.id, 'dungeon:1', 'now');
    carryover = new Map([[a.userId, { preferredRoles: ['tank'] }]]);

    const eventId = await startNow(a, game.id, 'dungeon:1');

    // MUTATION: route keyed hands back through signupNowHands → 'player'.
    expect(await rosterRole(eventId, a.userId)).toBe('tank');
  });

  it('P1-3: the invite names the started group', async () => {
    const [a, b] = await createMembers(testApp, 'p13-a', 'p13-b');
    await link(b);
    const game = await createGame(testApp, 'P13', { slug: SLUG });
    await hand(a, game.id, 'dungeon:1', 'now');
    await hand(b, game.id, 'dungeon:1', 'now');

    await startNow(a, game.id, 'dungeon:1');

    const rows = await testApp.db
      .select({ payload: schema.notifications.payload })
      .from(schema.notifications)
      .where(eq(schema.notifications.userId, b.userId));
    expect(rows.map((r) => r.payload)).toEqual([
      expect.objectContaining({ groupKey: 'dungeon:1' }),
    ]);
  });

  it("P1-4: a keyed change attaches the group's late now hand; an Any change does not", async () => {
    const [a, b] = await createMembers(testApp, 'p14-a', 'p14-b');
    const game = await createGame(testApp, 'P14', { slug: SLUG });
    await hand(a, game.id, 'dungeon:1', 'now');
    await hand(b, game.id, 'dungeon:1', 'now');
    const eventId = await startNow(a, game.id, 'dungeon:1');
    const spawn = testApp.app.get(LfgNowSpawnService);

    await spawn.onGroupChanged({ gameId: game.id, reason: 'joined' });
    expect((await handStatuses(game.id))[`${b.userId}:dungeon:1`]).toBe(
      'active',
    );

    await spawn.onGroupChanged({
      gameId: game.id,
      reason: 'joined',
      groupKey: 'dungeon:1',
    });
    expect((await handStatuses(game.id))[`${b.userId}:dungeon:1`]).toBe(
      'converted',
    );
    expect(await rosterRole(eventId, b.userId)).not.toBe('none');
  });

  it("delta MAJOR 2: a keyed attach leaves the group's tonight/week hands live", async () => {
    const [a, b, c, d] = await createMembers(testApp, 'm2-a', 'm2-b', 'c', 'd');
    const game = await createGame(testApp, 'M2', { slug: SLUG });
    await hand(a, game.id, 'dungeon:1', 'now');
    await hand(b, game.id, 'dungeon:1', 'now');
    await hand(c, game.id, 'dungeon:1', 'week');
    await hand(d, game.id, 'dungeon:1', 'tonight');
    const eventId = await startNow(a, game.id, 'dungeon:1');

    await testApp.app.get(LfgNowSpawnService).onGroupChanged({
      gameId: game.id,
      reason: 'joined',
      groupKey: 'dungeon:1',
    });

    // MUTATION: attach via convertGroup (whole group) and c/d read 'converted'.
    const s = await handStatuses(game.id);
    expect({
      b: s[`${b.userId}:dungeon:1`],
      c: s[`${c.userId}:dungeon:1`],
      d: s[`${d.userId}:dungeon:1`],
    }).toEqual({ b: 'converted', c: 'active', d: 'active' });
    expect(await rosterRole(eventId, c.userId)).toBe('none');
  });

  it("P1-1: joining a keyed session's voice converts only that group's hand", async () => {
    const [a, b] = await createMembers(testApp, 'p11-a', 'p11-b');
    const game = await createGame(testApp, 'P11', { slug: SLUG });
    await hand(a, game.id, 'dungeon:1', 'now');
    await hand(b, game.id, 'dungeon:1', 'now');
    await hand(b, game.id, 'dungeon:2', 'week');
    const eventId = await startNow(a, game.id, 'dungeon:1');

    await voiceJoin(eventId, b.userId);

    // MUTATION: restore convertHolderIntent (whole game) and dungeon:2 reads
    // 'converted'.
    expect(await handStatuses(game.id)).toEqual({
      [`${a.userId}:dungeon:1`]: 'converted',
      [`${b.userId}:dungeon:1`]: 'converted',
      [`${b.userId}:dungeon:2`]: 'active',
    });
  });

  it("P1-1: joining the Any session's voice leaves the joiner's keyed hands", async () => {
    const [a, b, c] = await createMembers(testApp, 'p11b-a', 'p11b-b', 'c');
    const game = await createGame(testApp, 'P11 Any', { slug: SLUG });
    await hand(a, game.id, '', 'now');
    await hand(b, game.id, '', 'now');
    await testApp.app
      .get(LfgNowSpawnService)
      .onGroupChanged({ gameId: game.id, reason: 'joined' });
    const [any] = await testApp.db
      .select({ eventId: schema.lfgIntents.convertedToEventId })
      .from(schema.lfgIntents)
      .where(eq(schema.lfgIntents.userId, a.userId));
    const eventId = any?.eventId ?? null;
    expect(eventId).not.toBeNull();
    await hand(c, game.id, 'dungeon:1', 'week');
    await hand(c, game.id, 'dungeon:2', 'tonight');

    await voiceJoin(eventId ?? 0, c.userId);

    const s = await handStatuses(game.id);
    expect([s[`${c.userId}:dungeon:1`], s[`${c.userId}:dungeon:2`]]).toEqual([
      'active',
      'active',
    ]);
  });
});
