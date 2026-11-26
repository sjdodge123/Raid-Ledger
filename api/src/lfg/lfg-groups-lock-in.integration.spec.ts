/**
 * ROK-2352 AC5 / AC6 / AC8 (lock-in half) — `POST /events` + `lfgGroupKey`
 * against a real DB, through HTTP.
 *
 * A stub `lfg-grouping` adapter owned by `blizzard` is registered on this
 * spec's own game slug (same pattern as `lfg-groups.integration.spec.ts`).
 * Its `buildLockInPatch` reads the member intents it is handed, so the spec
 * also proves core passes the right group's hands; the WoW roster shapes
 * themselves are pinned in `plugins/wow-common/lfg/wow-lfg-grouping.integration.spec.ts`.
 *
 * - AC5: only that group converts; the event carries the adapter's roster,
 *   instance and title; members sign up with the carried roles; the members'
 *   other `now` hands are cleared, `tonight`/`week` hands stay (Q1).
 * - AC6: two parallel Lock-ins of different groups sharing a `now` member —
 *   exactly one includes them (per-GAME advisory lock).
 * - AC8: plugin off → the Lock-in converts every live hand, generic roster.
 */
import { and, eq, inArray } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import { DEFAULT_ROSTER_SLOT_CONFIG } from '../events/event-roster-slots.helpers';
import { EXTENSION_POINTS } from '../plugins/plugin-host/extension-points';
import type { LfgGroupingAdapter } from '../plugins/plugin-host/lfg-grouping.adapter';
import { PluginRegistryService } from '../plugins/plugin-host/plugin-registry.service';
import {
  createGame,
  createMembers,
  type LfgMember,
} from './lfg.integration.spec-helpers';

const OWNER = 'blizzard';
const SLUG = 'rok2352-lfg-lock-in-spec';
const SHAPE = { type: 'mmo' as const, tank: 1, healer: 1, dps: 3 };
const KEYS = ['dungeon:1', 'dungeon:2', 'dungeon:3'];
type Urgency = 'now' | 'tonight' | 'week';

/** Stub adapter: three dungeons; every carried member is a healer. */
const stubAdapter: LfgGroupingAdapter = {
  behaviourId: 'rok2352-spec-grouping',
  listGroups: () => Promise.resolve([]),
  describeGroup: (_ctx, key) =>
    Promise.resolve(
      KEYS.includes(key) ? { key, label: key, kind: 'dungeon', size: 5 } : null,
    ),
  saveHandDetail: () => Promise.resolve(),
  readMemberDetails: () => Promise.resolve(new Map()),
  buildLockInPatch: async (tx, ctx) => {
    const ids = ctx.memberIntentIds.length > 0 ? ctx.memberIntentIds : [-1];
    const rows = await tx
      .select({ userId: schema.lfgIntents.userId })
      .from(schema.lfgIntents)
      .where(inArray(schema.lfgIntents.id, ids));
    const carry = rows.map((r) => [r.userId, { preferredRoles: ['healer'] }]);
    return {
      slotConfig: SHAPE,
      contentInstances: [{ id: ctx.groupKey, name: `Inst ${ctx.groupKey}` }],
      title: `Inst ${ctx.groupKey}`,
      carryover: new Map(carry as [number, { preferredRoles: ['healer'] }][]),
    };
  },
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
});

afterEach(async () => {
  if (!registry.isActive(OWNER)) await registry.activate(OWNER);
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

function lockIn(m: LfgMember, gameId: number, lfgGroupKey?: string) {
  const start = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
  const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
  return testApp.request
    .post('/events')
    .set('Authorization', `Bearer ${m.token}`)
    .send({
      title: 'LFG Night',
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      gameId,
      lfgGameId: gameId,
      ...(lfgGroupKey === undefined ? {} : { lfgGroupKey }),
    });
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

async function signupRoles(
  eventId: number,
): Promise<Record<number, string[] | null>> {
  const rows = await testApp.db
    .select({
      userId: schema.eventSignups.userId,
      preferredRoles: schema.eventSignups.preferredRoles,
    })
    .from(schema.eventSignups)
    .where(eq(schema.eventSignups.eventId, eventId));
  return Object.fromEntries(rows.map((r) => [r.userId, r.preferredRoles]));
}

async function readEvent(eventId: number) {
  const [row] = await testApp.db
    .select({
      title: schema.events.title,
      slotConfig: schema.events.slotConfig,
      contentInstances: schema.events.contentInstances,
    })
    .from(schema.events)
    .where(eq(schema.events.id, eventId));
  if (!row) throw new Error(`event ${eventId} missing`);
  return row;
}

// ─── scenarios ───────────────────────────────────────────────────────────────

describe('LFG group Lock-in (ROK-2352)', () => {
  it('AC5: converts only that group, shapes the event, carries roles, clears now siblings only', async () => {
    const [a, b, c] = await createMembers(testApp, 'li-a', 'li-b', 'li-c');
    const game = await createGame(testApp, 'Lock-in Spec', { slug: SLUG });
    await hand(a, game.id, 'dungeon:1', 'week');
    await hand(b, game.id, 'dungeon:1', 'now');
    await hand(b, game.id, 'dungeon:2', 'now');
    await hand(b, game.id, 'dungeon:3', 'tonight');
    await hand(a, game.id, 'dungeon:3', 'week');
    await hand(c, game.id, 'dungeon:2', 'now');

    const res = await lockIn(a, game.id, 'dungeon:1');

    expect(res.status).toBe(201);
    const eventId = (res.body as { id: number }).id;
    expect(await readEvent(eventId)).toMatchObject({
      title: 'Inst dungeon:1',
      slotConfig: SHAPE,
      contentInstances: [{ id: 'dungeon:1', name: 'Inst dungeon:1' }],
    });
    expect(await signupRoles(eventId)).toEqual({
      [a.userId]: ['healer'],
      [b.userId]: ['healer'],
    });
    expect(await handStatuses(game.id)).toEqual({
      [`${a.userId}:dungeon:1`]: 'converted',
      [`${b.userId}:dungeon:1`]: 'converted',
      [`${b.userId}:dungeon:2`]: 'cleared',
      [`${b.userId}:dungeon:3`]: 'active',
      [`${a.userId}:dungeon:3`]: 'active',
      [`${c.userId}:dungeon:2`]: 'active',
    });
  });

  it('AC6: two parallel Lock-ins sharing a now member — exactly one includes them', async () => {
    const [a, b, s] = await createMembers(testApp, 'cc-a', 'cc-b', 'cc-s');
    const game = await createGame(testApp, 'Concurrent Spec', { slug: SLUG });
    await hand(a, game.id, 'dungeon:1', 'now');
    await hand(b, game.id, 'dungeon:2', 'now');
    await hand(s, game.id, 'dungeon:1', 'now');
    await hand(s, game.id, 'dungeon:2', 'now');

    const [r1, r2] = await Promise.all([
      lockIn(a, game.id, 'dungeon:1'),
      lockIn(b, game.id, 'dungeon:2'),
    ]);

    expect([r1.status, r2.status]).toEqual([201, 201]);
    const eventIds = [r1, r2].map((r) => (r.body as { id: number }).id);
    const sSignups = await testApp.db
      .select({ eventId: schema.eventSignups.eventId })
      .from(schema.eventSignups)
      .where(
        and(
          eq(schema.eventSignups.userId, s.userId),
          inArray(schema.eventSignups.eventId, eventIds),
        ),
      );
    expect(sSignups).toHaveLength(1);
    const statuses = await handStatuses(game.id);
    expect(
      [
        statuses[`${s.userId}:dungeon:1`],
        statuses[`${s.userId}:dungeon:2`],
      ].sort(),
    ).toEqual(['cleared', 'converted']);
  });

  it('400s an unknown group key and creates no event', async () => {
    const [a] = await createMembers(testApp, 'uk-a');
    const game = await createGame(testApp, 'Unknown Key Spec', { slug: SLUG });
    await hand(a, game.id, 'dungeon:1', 'week');

    const res = await lockIn(a, game.id, 'dungeon:99');

    expect(res.status).toBe(400);
    expect(await testApp.db.select().from(schema.events)).toHaveLength(0);
  });

  it('AC8: plugin off — every live hand converts, generic roster, no instance', async () => {
    const [a, b] = await createMembers(testApp, 'fo-a', 'fo-b');
    const game = await createGame(testApp, 'Fold Spec', { slug: SLUG });
    await hand(a, game.id, 'dungeon:1', 'week');
    await hand(b, game.id, 'dungeon:2', 'tonight');
    await registry.deactivate(OWNER);

    const res = await lockIn(a, game.id, 'dungeon:1');

    expect(res.status).toBe(201);
    const eventId = (res.body as { id: number }).id;
    const event = await readEvent(eventId);
    expect(event.slotConfig).toEqual(DEFAULT_ROSTER_SLOT_CONFIG);
    expect(event.contentInstances ?? []).toEqual([]);
    expect(Object.values(await handStatuses(game.id))).toEqual([
      'converted',
      'converted',
    ]);
  });
});
