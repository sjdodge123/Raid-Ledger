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
import { LFG_HAND_CAP_CODE, LFG_MAX_HANDS_PER_GAME } from './lfg.constants';
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
  // A missing key must fail the ordering assertion loudly, not read as ''.
  return list.groups.map((g) => g.groupKey ?? '<missing groupKey>');
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
  it(`refuses the user's ${LFG_MAX_HANDS_PER_GAME + 1}th live hand with 400, '' counting as a group`, async () => {
    const [alice] = await createMembers(testApp, 'alice');
    const game = await groupsGame();
    await postOk(alice, game.id);
    for (const key of ['dungeon:1', 'dungeon:2', 'dungeon:3', 'dungeon:4']) {
      await postOk(alice, game.id, key);
    }

    // Spec AC3: 400 with a stable code (review MINOR-6; was 409).
    const sixth = await post(alice, game.id, 'dungeon:5');

    expect(sixth.status).toBe(400);
    expect(sixth.body).toMatchObject({ code: LFG_HAND_CAP_CODE });
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
    const held = [
      'dungeon:1',
      'dungeon:2',
      'dungeon:3',
      'dungeon:4',
      'dungeon:5',
    ];
    for (const key of held) await postOk(alice, game.id, key);

    const again = await post(alice, game.id, 'dungeon:1');

    expect(again.status).toBe(200);
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

// ─── AC4 — the per-group reads ──────────────────────────────────────────────

/**
 * alice: dungeon:1 + dungeon:2 · bob: dungeon:2 · carol: '' — three distinct
 * users, four hands, three live groups (busiest: dungeon:2).
 */
async function seedSplit() {
  const [alice, bob, carol] = await createMembers(
    testApp,
    'alice',
    'bob',
    'carol',
  );
  const game = await groupsGame();
  await postOk(alice, game.id, 'dungeon:1');
  await postOk(alice, game.id, 'dungeon:2');
  await postOk(bob, game.id, 'dungeon:2');
  await postOk(carol, game.id);
  return { alice, bob, carol, gameId: game.id };
}

describe('GET /lfg/:gameId/groups (AC4)', () => {
  it("lists '' first, then live groups busiest first, with adapter labels", async () => {
    const { alice, gameId } = await seedSplit();

    const list = await readGroups(alice, gameId);

    expect(list.gameId).toBe(gameId);
    expect(keysOf(list)).toEqual(['', 'dungeon:2', 'dungeon:1']);
    const any = itemOf(list, '');
    expect(any).toMatchObject({ kind: 'any', groupLabel: null });
    expect(any.activeCount).toBe(1);
    expect(any.hasOwnIntent).toBe(false);
    expect(itemOf(list, 'dungeon:2')).toMatchObject({
      groupLabel: 'Dungeon 2',
      kind: 'dungeon',
      size: 5,
      activeCount: 2,
      hasOwnIntent: true,
    });
    expect(itemOf(list, 'dungeon:1').activeCount).toBe(1);
  });

  it('adds the empty catalogue groups after the live ones with include=catalogue', async () => {
    const { alice, gameId } = await seedSplit();

    const list = await readGroups(alice, gameId, true);

    expect(keysOf(list)).toEqual([
      '',
      'dungeon:2',
      'dungeon:1',
      'dungeon:3',
      'dungeon:4',
      'dungeon:5',
      'dungeon:6',
      'dungeon:7',
    ]);
    expect(itemOf(list, 'dungeon:7')).toMatchObject({
      groupLabel: 'Dungeon 7',
      activeCount: 0,
      hasOwnIntent: false,
    });
  });

  it('drops a live group whose key the adapter does not list', async () => {
    const { alice, gameId } = await seedSplit();
    const [dave] = await createMembers(testApp, 'dave');
    await testApp.db.insert(schema.lfgIntents).values({
      userId: dave.userId,
      gameId,
      groupKey: 'raid:retired',
      expiresAt: new Date(Date.now() + 86_400_000),
    });

    const list = await readGroups(alice, gameId);

    expect(keysOf(list)).toEqual(['', 'dungeon:2', 'dungeon:1']);
  });
});

describe('GET /lfg/:gameId?group= (AC4)', () => {
  it("shows only that group's members and the caller's other groups", async () => {
    const { alice, bob, gameId } = await seedSplit();

    const detail = await readDetail(alice, gameId, 'dungeon:2');

    expect(detail.groupKey).toBe('dungeon:2');
    expect(detail.groupLabel).toBe('Dungeon 2');
    expect(detail.activeCount).toBe(2);
    expect(sortedIds(detail.members)).toEqual(
      [alice.userId, bob.userId].sort((a, b) => a - b),
    );
    expect(detail.ownIntent?.groupKey).toBe('dungeon:2');
    expect(detail.ownOtherGroups).toEqual([
      { groupKey: 'dungeon:1', groupLabel: 'Dungeon 1' },
    ]);
  });

  it("defaults to '' and lists every keyed hand of the caller as another group", async () => {
    const { alice, carol, gameId } = await seedSplit();

    const detail = await readDetail(alice, gameId);

    expect(detail.groupKey).toBe('');
    expect(detail.groupLabel).toBeNull();
    expect(sortedIds(detail.members)).toEqual([carol.userId]);
    expect(detail.ownIntent).toBeNull();
    const others = [...(detail.ownOtherGroups ?? [])].sort((a, b) =>
      a.groupKey.localeCompare(b.groupKey),
    );
    expect(others).toEqual([
      { groupKey: 'dungeon:1', groupLabel: 'Dungeon 1' },
      { groupKey: 'dungeon:2', groupLabel: 'Dungeon 2' },
    ]);
  });

  it('rejects a key the adapter does not know with 400', async () => {
    const { alice, gameId } = await seedSplit();

    const res = await testApp.request
      .get(`/lfg/${gameId}`)
      .set('Authorization', `Bearer ${alice.token}`)
      .query({ group: 'dungeon:999' });

    expect(res.status).toBe(400);
  });
});

// ─── AC8 — the fold (owner plugin off) ──────────────────────────────────────

describe('plugin off — the game folds to one group (AC8)', () => {
  it("/groups returns only '' counting distinct users, catalogue or not", async () => {
    const { alice, gameId } = await seedSplit();
    await registry.deactivate(OWNER);

    for (const catalogue of [false, true]) {
      const list = await readGroups(alice, gameId, catalogue);
      expect(keysOf(list)).toEqual(['']);
      // alice's two hands count once: alice, bob, carol.
      expect(itemOf(list, '').activeCount).toBe(3);
      expect(itemOf(list, '').hasOwnIntent).toBe(true);
    }
  });

  it('the detail shows every user once and no other groups', async () => {
    const { alice, bob, carol, gameId } = await seedSplit();
    await registry.deactivate(OWNER);

    const detail = await readDetail(alice, gameId, 'dungeon:1');

    expect(detail.groupKey).toBe('');
    expect(detail.activeCount).toBe(3);
    expect(sortedIds(detail.members)).toEqual(
      [alice.userId, bob.userId, carol.userId].sort((a, b) => a - b),
    );
    expect(detail.ownOtherGroups).toBeUndefined();
  });

  it('GET /lfg reports groupCount 3 while split and 1 once folded', async () => {
    const { alice, gameId } = await seedSplit();

    const split = await readGameRow(alice, gameId);
    expect(split.activeCount).toBe(3);
    expect(split.groupCount).toBe(3);

    await registry.deactivate(OWNER);
    const folded = await readGameRow(alice, gameId);
    expect(folded.activeCount).toBe(3);
    expect(folded.groupCount).toBe(1);
  });

  it('re-activating the plugin restores the split', async () => {
    const { alice, gameId } = await seedSplit();
    await registry.deactivate(OWNER);
    expect(keysOf(await readGroups(alice, gameId))).toEqual(['']);

    await registry.activate(OWNER);

    expect(keysOf(await readGroups(alice, gameId))).toEqual([
      '',
      'dungeon:2',
      'dungeon:1',
    ]);
  });
});

describe('DELETE /lfg/:gameId?group= (AC8)', () => {
  it("clears every one of the caller's hands in a folded game", async () => {
    const { alice, bob, gameId } = await seedSplit();
    await registry.deactivate(OWNER);

    // L4 decision: a folded withdraw clears EVERY hand (spec §3.7 reads
    // "?group=x treated as ''"); the viewer sees one group, so it must empty.
    const res = await withdraw(alice, gameId);

    expect(res.status).toBe(204);
    expect(await activeKeys(alice.userId, gameId)).toEqual([]);
    expect(await activeKeys(bob.userId, gameId)).toEqual(['dungeon:2']);
  });

  it("?group=* clears every one of the caller's hands in a split game", async () => {
    const { alice, bob, gameId } = await seedSplit();

    const res = await withdraw(alice, gameId, '*');

    expect(res.status).toBe(204);
    expect(await activeKeys(alice.userId, gameId)).toEqual([]);
    expect(await activeKeys(bob.userId, gameId)).toEqual(['dungeon:2']);
  });

  it('?group=<key> clears only that group in a split game', async () => {
    const { alice, gameId } = await seedSplit();

    const res = await withdraw(alice, gameId, 'dungeon:1');

    expect(res.status).toBe(204);
    expect(await activeKeys(alice.userId, gameId)).toEqual(['dungeon:2']);
  });

  it("no ?group in a split game targets '' only — 404 when the caller holds none there", async () => {
    const { alice, gameId } = await seedSplit();

    const res = await withdraw(alice, gameId);

    expect(res.status).toBe(404);
    expect(await activeKeys(alice.userId, gameId)).toEqual([
      'dungeon:1',
      'dungeon:2',
    ]);
  });
});
