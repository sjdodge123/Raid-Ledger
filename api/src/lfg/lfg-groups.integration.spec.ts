/**
 * ROK-2352 AC3 / AC4 / AC8 — LFG groups against a real DB, through HTTP.
 *
 * A stub `lfg-grouping` adapter (seven `dungeon:<n>` groups) is registered on
 * this spec's own game slug, owned by the `blizzard` plugin, so the core seam
 * is exercised without the WoW catalogue. "Plugin off" = `deactivate('blizzard')`:
 * the registry suspends the owned adapter and the game folds to `''`.
 *
 * - AC3 (write): the per-user live-hand cap, two hands of one user in two
 *   groups, a same-group re-post upserting, an unknown key, the fold write.
 * - AC4 (read): `GET /lfg/:gameId/groups` ordering + counts (`?include=catalogue`),
 *   `GET /lfg/:gameId?group=` member scoping + `ownOtherGroups`.
 * - AC8 (fold): `/groups` is just `''` with distinct-user counts, `GET /lfg`
 *   `groupCount` 1, withdraw semantics, and re-activation restoring the split.
 */
import { and, asc, eq } from 'drizzle-orm';
import type {
  LfgGroupDetailDto,
  LfgGroupListItemDto,
  LfgGroupListResponseDto,
  LfgGroupSummaryDto,
} from '@raid-ledger/contract';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import { EXTENSION_POINTS } from '../plugins/plugin-host/extension-points';
import type {
  LfgGroupDescriptor,
  LfgGroupingAdapter,
} from '../plugins/plugin-host/lfg-grouping.adapter';
import { PluginRegistryService } from '../plugins/plugin-host/plugin-registry.service';
import { LFG_MAX_HANDS_PER_GAME } from './lfg.constants';
import {
  createGame,
  createMembers,
  type LfgMember,
} from './lfg.integration.spec-helpers';

const OWNER = 'blizzard';
const SLUG = 'rok2352-lfg-groups-spec';

const CATALOGUE: LfgGroupDescriptor[] = Array.from({ length: 7 }, (_, i) => ({
  key: `dungeon:${i + 1}`,
  label: `Dungeon ${i + 1}`,
  kind: 'dungeon',
  size: 5,
}));

/** Stub adapter: knows the seven catalogue keys, stores no detail. */
const stubAdapter: LfgGroupingAdapter = {
  behaviourId: 'rok2352-spec-grouping',
  listGroups: () => Promise.resolve(CATALOGUE),
  describeGroup: (_ctx, key) =>
    Promise.resolve(CATALOGUE.find((d) => d.key === key) ?? null),
  saveHandDetail: () => Promise.resolve(),
  readMemberDetails: () => Promise.resolve(new Map()),
  buildLockInPatch: () => Promise.resolve({ carryover: new Map() }),
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
  // Re-register every time: after a truncate `ensureInstalled` re-inserts the
  // row as active, so `activate` returns early and never restores a suspended
  // adapter. Registration is idempotent on the key.
  registry.registerAdapter(EXTENSION_POINTS.LFG_GROUPING, SLUG, stubAdapter, {
    ownerPluginId: OWNER,
  });
});

afterEach(async () => {
  // Re-activate BEFORE the truncate (the plugins row must still exist), so a
  // fold case never leaves `blizzard` off — and its WoW adapters
  // removed — for the next spec in this worker.
  if (!registry.isActive(OWNER)) await registry.activate(OWNER);
  testApp.seed = await truncateAllTables(testApp.db);
});

// ─── helpers ────────────────────────────────────────────────────────────────

function groupsGame() {
  return createGame(testApp, 'LFG Groups Spec', { slug: SLUG });
}

function post(m: LfgMember, gameId: number, groupKey?: string) {
  return testApp.request
    .post('/lfg')
    .set('Authorization', `Bearer ${m.token}`)
    .send({ gameId, ...(groupKey !== undefined ? { groupKey } : {}) });
}

async function postOk(m: LfgMember, gameId: number, groupKey?: string) {
  const res = await post(m, gameId, groupKey);
  expect(res.status).toBe(201);
}

function withdraw(m: LfgMember, gameId: number, group?: string) {
  const req = testApp.request
    .delete(`/lfg/${gameId}`)
    .set('Authorization', `Bearer ${m.token}`);
  return group === undefined ? req : req.query({ group });
}

async function readGroups(
  m: LfgMember,
  gameId: number,
  catalogue = false,
): Promise<LfgGroupListResponseDto> {
  const req = testApp.request
    .get(`/lfg/${gameId}/groups`)
    .set('Authorization', `Bearer ${m.token}`);
  const res = await (catalogue ? req.query({ include: 'catalogue' }) : req);
  expect(res.status).toBe(200);
  return res.body as LfgGroupListResponseDto;
}

async function readDetail(
  m: LfgMember,
  gameId: number,
  group?: string,
): Promise<LfgGroupDetailDto> {
  const req = testApp.request
    .get(`/lfg/${gameId}`)
    .set('Authorization', `Bearer ${m.token}`);
  const res = await (group === undefined ? req : req.query({ group }));
  expect(res.status).toBe(200);
  return res.body as LfgGroupDetailDto;
}

async function readGameRow(
  m: LfgMember,
  gameId: number,
): Promise<LfgGroupSummaryDto> {
  const res = await testApp.request
    .get('/lfg')
    .set('Authorization', `Bearer ${m.token}`);
  expect(res.status).toBe(200);
  const rows = res.body as LfgGroupSummaryDto[];
  const row = rows.find((r) => r.gameId === gameId);
  if (!row) throw new Error(`GET /lfg has no row for game ${gameId}`);
  return row;
}

/** Group keys of the caller's ACTIVE rows in a game, sorted. */
async function activeKeys(userId: number, gameId: number): Promise<string[]> {
  const t = schema.lfgIntents;
  const rows = await testApp.db
    .select({ groupKey: t.groupKey })
    .from(t)
    .where(
      and(eq(t.userId, userId), eq(t.gameId, gameId), eq(t.status, 'active')),
    )
    .orderBy(asc(t.groupKey));
  return rows.map((r) => r.groupKey);
}

function keysOf(list: LfgGroupListResponseDto): string[] {
  return list.groups.map((g) => g.groupKey);
}

function itemOf(
  list: LfgGroupListResponseDto,
  key: string,
): LfgGroupListItemDto {
  const item = list.groups.find((g) => g.groupKey === key);
  if (!item) throw new Error(`group list has no "${key}" entry`);
  return item;
}

function sortedIds(rows: { userId: number }[]): number[] {
  return rows.map((r) => r.userId).sort((a, b) => a - b);
}

// ─── AC3 — the write path ───────────────────────────────────────────────────

describe('POST /lfg with an active grouping adapter (AC3)', () => {
  it(`refuses the user's ${LFG_MAX_HANDS_PER_GAME + 1}th live hand with 409, '' counting as a group`, async () => {
    const [alice] = await createMembers(testApp, 'alice');
    const game = await groupsGame();
    await postOk(alice, game.id);
    for (const key of ['dungeon:1', 'dungeon:2', 'dungeon:3', 'dungeon:4']) {
      await postOk(alice, game.id, key);
    }

    // NOTE: spec AC3 says 400; the implementation (L3) chose 409 Conflict
    // (`assertHandCap` → ConflictException). Pinned as 409 — flagged to Lead.
    const sixth = await post(alice, game.id, 'dungeon:5');

    expect(sixth.status).toBe(409);
    expect(await activeKeys(alice.userId, game.id)).toEqual([
      '',
      'dungeon:1',
      'dungeon:2',
      'dungeon:3',
      'dungeon:4',
    ]);
  });

  it('re-posting into a held group at the cap upserts instead of refusing', async () => {
    const [alice] = await createMembers(testApp, 'alice');
    const game = await groupsGame();
    const held = ['dungeon:1', 'dungeon:2', 'dungeon:3', 'dungeon:4', 'dungeon:5'];
    for (const key of held) await postOk(alice, game.id, key);

    const again = await post(alice, game.id, 'dungeon:1');

    expect(again.status).toBe(201);
    expect(await activeKeys(alice.userId, game.id)).toEqual(held);
  });

  it("keeps one user's hands in two groups side by side", async () => {
    const [alice] = await createMembers(testApp, 'alice');
    const game = await groupsGame();

    await postOk(alice, game.id, 'dungeon:1');
    await postOk(alice, game.id, 'dungeon:2');

    expect(await activeKeys(alice.userId, game.id)).toEqual([
      'dungeon:1',
      'dungeon:2',
    ]);
  });

  it('rejects a key the adapter does not know with 400 and writes nothing', async () => {
    const [alice] = await createMembers(testApp, 'alice');
    const game = await groupsGame();

    const res = await post(alice, game.id, 'dungeon:999');

    expect(res.status).toBe(400);
    expect(await activeKeys(alice.userId, game.id)).toEqual([]);
  });

  it("folds a keyed write to '' when the owner plugin is off", async () => {
    const [alice] = await createMembers(testApp, 'alice');
    const game = await groupsGame();
    await registry.deactivate(OWNER);

    const res = await post(alice, game.id, 'dungeon:1');

    expect(res.status).toBe(201);
    expect(await activeKeys(alice.userId, game.id)).toEqual(['']);
  });
});
