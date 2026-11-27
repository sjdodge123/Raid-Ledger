/**
 * ROK-2352 §3.2 — the once-only "your hand for X was withdrawn because you're
 * in Y now" notice, against a real DB through HTTP.
 *
 * - A Lock-in clears a member's other `now` hand with `cleared_reason` and the
 *   group they went into; `GET /lfg/:gameId/groups` carries exactly one
 *   notice for it, labelled by the grouping adapter.
 * - `POST /lfg/hands/notices/ack` hides it — but only when the OWNER acks.
 * - A user's own Withdraw (also `status = 'cleared'`) yields no notice.
 *
 * Same stub-adapter pattern as `lfg-groups-lock-in.integration.spec.ts`.
 */
import { and, eq } from 'drizzle-orm';
import type { LfgGroupListResponseDto } from '@raid-ledger/contract';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import { EXTENSION_POINTS } from '../plugins/plugin-host/extension-points';
import type { LfgGroupingAdapter } from '../plugins/plugin-host/lfg-grouping.adapter';
import { PluginRegistryService } from '../plugins/plugin-host/plugin-registry.service';
import {
  createGame,
  createMembers,
  type LfgMember,
} from './lfg.integration.spec-helpers';

const OWNER = 'blizzard';
const SLUG = 'rok2352-hand-notice-spec';
const KEYS = ['dungeon:1', 'dungeon:2', 'dungeon:3'];
const label = (key: string): string => `Inst ${key}`;

const stubAdapter: LfgGroupingAdapter = {
  behaviourId: 'rok2352-notice-spec-grouping',
  listGroups: () => Promise.resolve([]),
  describeGroup: (_ctx, key) =>
    Promise.resolve(
      KEYS.includes(key)
        ? { key, label: label(key), kind: 'dungeon', size: 5 }
        : null,
    ),
  saveHandDetail: () => Promise.resolve(),
  readMemberDetails: () => Promise.resolve(new Map()),
  buildLockInPatch: (_tx, ctx) =>
    Promise.resolve({
      slotConfig: { type: 'mmo', tank: 1, healer: 1, dps: 3 },
      title: label(ctx.groupKey),
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
});

afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
});

// ─── helpers ────────────────────────────────────────────────────────────────

async function hand(
  m: LfgMember,
  gameId: number,
  key: string,
  urgency: 'now' | 'week',
): Promise<number> {
  const res = await testApp.request
    .post('/lfg')
    .set('Authorization', `Bearer ${m.token}`)
    .send({ gameId, groupKey: key, urgency, handDetail: { roles: ['dps'] } });
  expect(res.status).toBe(201);
  const [row] = await testApp.db
    .select({ id: schema.lfgIntents.id })
    .from(schema.lfgIntents)
    .where(
      and(
        eq(schema.lfgIntents.userId, m.userId),
        eq(schema.lfgIntents.groupKey, key),
        eq(schema.lfgIntents.status, 'active'),
      ),
    );
  if (!row) throw new Error(`no live hand for ${m.username} in ${key}`);
  return row.id;
}

async function lockIn(m: LfgMember, gameId: number, key: string) {
  const start = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
  const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
  const res = await testApp.request
    .post('/events')
    .set('Authorization', `Bearer ${m.token}`)
    .send({
      title: 'LFG Night',
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      gameId,
      lfgGameId: gameId,
      lfgGroupKey: key,
    });
  expect(res.status).toBe(201);
}

async function notices(m: LfgMember, gameId: number) {
  const res = await testApp.request
    .get(`/lfg/${gameId}/groups`)
    .set('Authorization', `Bearer ${m.token}`);
  expect(res.status).toBe(200);
  return (res.body as LfgGroupListResponseDto).notices;
}

function ack(m: LfgMember, intentIds: number[]) {
  return testApp.request
    .post('/lfg/hands/notices/ack')
    .set('Authorization', `Bearer ${m.token}`)
    .send({ intentIds });
}

async function clearedRow(id: number) {
  const [row] = await testApp.db
    .select()
    .from(schema.lfgIntents)
    .where(eq(schema.lfgIntents.id, id));
  if (!row) throw new Error(`intent ${id} missing`);
  return row;
}

// ─── specs ──────────────────────────────────────────────────────────────────

describe('LFG "hand withdrawn" notice (ROK-2352 §3.2)', () => {
  it('a Lock-in clears a member now sibling with a reason; the notice shows once until the owner acks it', async () => {
    const [a, b] = await createMembers(testApp, 'hn-a', 'hn-b');
    const game = await createGame(testApp, 'Notice Spec', { slug: SLUG });
    await hand(a, game.id, 'dungeon:1', 'now');
    await hand(b, game.id, 'dungeon:1', 'now');
    const sibling = await hand(b, game.id, 'dungeon:2', 'now');
    await hand(b, game.id, 'dungeon:3', 'week');

    await lockIn(a, game.id, 'dungeon:1');

    const row = await clearedRow(sibling);
    expect(row).toMatchObject({
      status: 'cleared',
      clearedReason: 'sibling_locked_in',
      clearedIntoGroupKey: 'dungeon:1',
      clearedNoticeSeenAt: null,
    });
    expect(await notices(b, game.id)).toEqual([
      {
        intentId: sibling,
        fromGroupKey: 'dungeon:2',
        fromLabel: 'Inst dungeon:2',
        toGroupKey: 'dungeon:1',
        toLabel: 'Inst dungeon:1',
      },
    ]);
    expect(await notices(a, game.id)).toBeUndefined();

    // Owner-only: another user acking B's notice changes nothing.
    expect((await ack(a, [sibling])).status).toBe(204);
    expect(await notices(b, game.id)).toHaveLength(1);

    expect((await ack(b, [sibling])).status).toBe(204);
    expect(await notices(b, game.id)).toBeUndefined();
    expect((await clearedRow(sibling)).clearedNoticeSeenAt).not.toBeNull();
  });

  it("a user's own Withdraw clears the hand with no reason and no notice", async () => {
    const [b] = await createMembers(testApp, 'hn-w');
    const game = await createGame(testApp, 'Notice Withdraw', { slug: SLUG });
    const id = await hand(b, game.id, 'dungeon:2', 'now');

    const res = await testApp.request
      .delete(`/lfg/${game.id}?group=dungeon:2`)
      .set('Authorization', `Bearer ${b.token}`);
    expect(res.status).toBe(204);

    expect(await clearedRow(id)).toMatchObject({
      status: 'cleared',
      clearedReason: null,
      clearedIntoGroupKey: null,
    });
    expect(await notices(b, game.id)).toBeUndefined();
  });

  it('400s an ack with no intent ids', async () => {
    const [b] = await createMembers(testApp, 'hn-x');
    expect((await ack(b, [])).status).toBe(400);
  });
});
