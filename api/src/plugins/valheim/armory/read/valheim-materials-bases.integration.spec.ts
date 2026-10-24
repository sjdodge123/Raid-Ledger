/**
 * ROK-1859 L2 — bases on the Materials read routes against a real database.
 * Two shared bases 120 m apart (A: 3 chests + an attached cart, B: 2 chests),
 * a far cart (no base) and three private chests — one of them sits 59–61 m
 * from both bases, so a base built from private chests would merge them.
 * Containers go through the real snapshot → importer path.
 */
import { asc } from 'drizzle-orm';
import {
  ValheimContainerDetailSchema,
  ValheimContainerListResponseSchema,
  ValheimMaterialsResponseSchema,
  type ValheimCharacterMessage,
  type ValheimContainerSummary,
  type ValheimMaterialStack,
  type ValheimMaterialsResponse,
} from '@raid-ledger/contract';
import {
  signTestAccessToken,
  type TestAccessClaims,
} from '../../../../common/testing/sign-test-access-token';
import { getTestApp, type TestApp } from '../../../../common/testing/test-app';
import {
  loginAsAdmin,
  truncateAllTables,
} from '../../../../common/testing/integration-helpers';
import { nonEmpty } from '../../../../common/testing/narrow';
import * as schema from '../../../../drizzle/schema';
import { SettingsService } from '../../../../settings/settings.service';
import { PluginRegistryService } from '../../../plugin-host/plugin-registry.service';
import { PELICAN_PLUGIN_ID } from '../../../pelican/pelican.constants';
import { fakeServer } from '../../../pelican/testing/pelican-fixtures';
import { VALHEIM_GAME_SLUG, VALHEIM_PLUGIN_ID } from '../../valheim.constants';
import { loadValheimFixture } from '../../link/ingest/valheim-link-ingest.testing';
import { valheimSnapshotRow } from '../../link/ingest/valheim-link-snapshot.helpers';
import { containerPublicKey } from '../valheim-armory-containers.import';
import { ValheimArmoryImportService } from '../valheim-armory-import.service';
import { ensureFixtureHubId } from '../valheim-armory-map-hub.helpers';
import { cmp } from './valheim-base-clusters.helpers';

const PLUGINS = [PELICAN_PLUGIN_ID, VALHEIM_PLUGIN_ID];
const OWNER_PID = '1000000000000001';
const OTHER_PID = '1000000000000002';
const T0 = '2026-10-17T20:15:42Z';
const HEADER = loadValheimFixture('containers-basic');
const WORLD_UID = String(HEADER.worldUid);

type Box = {
  prefab: string;
  x: number;
  y: number;
  z: number;
  creatorPlayerId: string;
  privacy: 'public' | 'group' | 'private';
  vehicle: boolean;
  items: Array<{ prefab: string; quality: number; stack: number }>;
};
const item = (prefab: string, stack: number) => ({ prefab, quality: 1, stack });
const box = (over: Partial<Box>): Box => ({
  prefab: 'piece_chest',
  x: 0,
  y: 30,
  z: 0,
  creatorPlayerId: OWNER_PID,
  privacy: 'public',
  vehicle: false,
  items: [],
  ...over,
});

const CHESTS = {
  a1: box({
    x: 0,
    items: [
      item('Wood', 50),
      item('Stone', 20),
      item('arrow_wood', 3),
      item('Barley', 2),
    ],
  }),
  a2: box({
    x: 30,
    privacy: 'group',
    creatorPlayerId: OTHER_PID,
    items: [item('Wood', 7)],
  }),
  a3: box({ prefab: 'piece_chest_wood', x: 60, items: [item('Stone', 5)] }),
  b1: box({ x: 180, items: [item('Wood', 10)] }),
  b2: box({ x: 200, items: [item('Resin', 4)] }),
  cartA: box({
    prefab: 'Cart',
    x: 70,
    vehicle: true,
    items: [item('Iron', 4)],
  }),
  cartFar: box({
    prefab: 'Cart',
    x: 1000,
    z: 1000,
    vehicle: true,
    items: [item('Iron', 2)],
  }),
  /** 61 m from A3, 59 m from B1 — attaches to B, must never bridge A–B. */
  pBridge: box({ x: 121, privacy: 'private', items: [item('Gold', 3)] }),
  pOwn: box({ x: 10, privacy: 'private', items: [item('Wood', 100)] }),
  pOther: box({
    x: 5,
    privacy: 'private',
    creatorPlayerId: OTHER_PID,
    items: [item('Silver', 9)],
  }),
};
type Name = keyof typeof CHESTS;
const KEY = Object.fromEntries(
  Object.entries(CHESTS).map(([n, b]) => [n, containerPublicKey(WORLD_UID, b)]),
) as Record<Name, string>;
const minKey = (...names: Name[]) =>
  names.map((n) => KEY[n]).sort(cmp)[0] ?? 'missing';
const BASE_A = minKey('a1', 'a2', 'a3');
const BASE_B = minKey('b1', 'b2');

let testApp: TestApp;
let server: number;
let tokens: Record<'admin' | 'member' | 'owner' | 'impersonated', string>;

const registry = () => testApp.app.get(PluginRegistryService);
const url = (path: string) =>
  `/plugins/valheim/armory/servers/${server}${path}`;
const sign = (sub: number, extra: Partial<TestAccessClaims> = {}) =>
  signTestAccessToken(testApp, { sub, username: `u${sub}`, ...extra });

async function getOk(path: string, token: string): Promise<unknown> {
  const res = await testApp.request
    .get(url(path))
    .set({ Authorization: `Bearer ${token}` });
  expect({ path, status: res.status }).toEqual({ path, status: 200 });
  return res.body;
}
async function materials(t: string, q = ''): Promise<ValheimMaterialsResponse> {
  return ValheimMaterialsResponseSchema.parse(await getOk(`/materials${q}`, t));
}
async function list(t: string, q = ''): Promise<ValheimContainerSummary[]> {
  const body = await getOk(`/containers${q}`, t);
  return ValheimContainerListResponseSchema.parse(body).containers;
}
/** name → "base:index" for the listed chests (names, never ids). */
async function places(t: string, q = ''): Promise<Record<string, string>> {
  const byKey = new Map(Object.entries(KEY).map(([n, k]) => [k, n]));
  const out: Record<string, string> = {};
  for (const c of await list(t, q)) {
    const base =
      c.base === BASE_A ? 'A' : c.base === BASE_B ? 'B' : String(c.base);
    out[byKey.get(c.key) ?? c.key] = `${base}:${c.index}`;
  }
  return out;
}
/** Σ by (prefab, quality) — totals compared as sums, order checked apart. */
function sum(lists: ReadonlyArray<readonly ValheimMaterialStack[]>) {
  const out: Record<string, number> = {};
  for (const l of lists) {
    for (const s of l)
      out[`${s.prefab}:${s.quality}`] =
        (out[`${s.prefab}:${s.quality}`] ?? 0) + s.total;
  }
  return out;
}
const ids = (l: readonly ValheimMaterialStack[]) =>
  l.map((s) => `${s.prefab}:${s.quality}`);

async function makeUser(name: string): Promise<number> {
  const [u] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({ discordId: `local:${name}`, username: name, role: 'member' })
      .returning({ id: schema.users.id }),
    `user ${name}`,
  );
  return u.id;
}

async function claimOwner(userId: number): Promise<void> {
  const ch = loadValheimFixture(
    'character-vanilla',
  ) as unknown as ValheimCharacterMessage;
  await testApp.db.insert(schema.valheimProfiles).values({
    pelicanServerId: server,
    steamId: 'S_OWNER',
    playerId: OWNER_PID,
    worldUid: WORLD_UID,
    worldName: 'W',
    name: 'owner',
    gameVersion: '0.220.5',
    modVersion: '1.0.0',
    capturedAt: new Date(T0),
    equipment: ch.equipment,
    inventory: ch.inventory,
    skills: ch.skills,
    trophies: [],
    knownItems: [],
    knownRecipes: [],
    claimedBy: userId,
    claimSource: 'auto',
    claimedAt: new Date(),
  });
}

async function importWorld(): Promise<void> {
  const containers = Object.values(CHESTS).map((b) => ({
    ...b,
    slots: 30,
    usedSlots: b.items.length,
    unreadable: false,
    omittedEntries: 0,
  }));
  const msg = {
    ...HEADER,
    capturedAt: T0,
    omittedShared: 0,
    omittedPrivate: 0,
    containers,
  };
  await testApp.db
    .insert(schema.valheimLinkSnapshots)
    .values(valheimSnapshotRow(server, msg as never));
  await testApp.app.get(ValheimArmoryImportService).drainOnce();
}

beforeAll(async () => {
  testApp = await getTestApp();
});

beforeEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
  for (const slug of PLUGINS) {
    await registry().ensureInstalled(slug);
    await registry().activate(slug);
  }
  const [g] = nonEmpty(
    await testApp.db
      .insert(schema.games)
      .values({ name: 'Valheim', slug: VALHEIM_GAME_SLUG })
      .returning({ id: schema.games.id }),
    'game',
  );
  const s = fakeServer(1);
  const [row] = nonEmpty(
    await testApp.db
      .insert(schema.pelicanServers)
      .values({
        panelUuid: s.uuid,
        identifier: s.identifier,
        name: s.name,
        gameId: g.id,
      })
      .returning({ id: schema.pelicanServers.id }),
    'server',
  );
  server = row.id;
  await ensureFixtureHubId(testApp.db, server, g.id);
  const ownerId = await makeUser('owner');
  await claimOwner(ownerId);
  tokens = {
    admin: await loginAsAdmin(testApp.request, testApp.seed),
    member: await sign(await makeUser('member')),
    owner: await sign(ownerId),
    impersonated: await sign(ownerId, {
      impersonatedBy: testApp.seed.adminUser.id,
    }),
  };
  await importWorld();
});

afterEach(async () => {
  for (const slug of PLUGINS) {
    if (registry().isActive(slug)) await registry().deactivate(slug);
  }
  testApp.app.get(SettingsService).invalidateCache(true);
});

describe('materials bases (ROK-1859)', () => {
  it('two bases from shared stationary chests; every viewer gets the same ones', async () => {
    const member = await materials(tokens.member);
    expect(
      member.bases?.map((b) => [b.key, b.chestCount, b.vehicleCount, b.x, b.z]),
    ).toEqual([
      [BASE_A, 3, 1, 30, 0],
      [BASE_B, 2, 0, 190, 0],
    ]);
    for (const who of ['admin', 'owner', 'impersonated'] as const) {
      expect({ who, bases: (await materials(tokens[who])).bases }).toEqual({
        who,
        bases: member.bases,
      });
    }
    const noCarts = await materials(tokens.member, '?includeVehicles=false');
    expect(noCarts.bases?.map((b) => [b.key, b.vehicleCount])).toEqual([
      [BASE_A, 0],
      [BASE_B, 0],
    ]);
  });

  it('Σ bases.totals = shared.totals (vehicles off); + the far cart (on); same order', async () => {
    const off = await materials(tokens.member, '?includeVehicles=false');
    expect(sum((off.bases ?? []).map((b) => b.totals))).toEqual(
      sum([off.shared.totals]),
    );
    const on = await materials(tokens.member);
    expect(
      sum([
        ...(on.bases ?? []).map((b) => b.totals),
        [{ prefab: 'Iron', quality: 1, total: 2, chests: 1 }],
      ]),
    ).toEqual(sum([on.shared.totals]));
    for (const b of on.bases ?? []) {
      const order = ids(on.shared.totals).filter((id) =>
        ids(b.totals).includes(id),
      );
      expect({ base: b.key, order: ids(b.totals) }).toEqual({
        base: b.key,
        order,
      });
    }
  });

  it('mixed-case prefabs list in the database ORDER BY order, not JS default order', async () => {
    const stacks = schema.valheimContainerStacks;
    const rows = await testApp.db
      .selectDistinct({ prefab: stacks.prefab })
      .from(stacks)
      .orderBy(asc(stacks.prefab));
    const sqlOrder = rows.map((r) => r.prefab);
    const on = await materials(tokens.member);
    const prefabsOf = (l: readonly ValheimMaterialStack[]) => [
      ...new Set(l.map((s) => s.prefab)),
    ];
    expect(prefabsOf(on.shared.totals)).toEqual(
      sqlOrder.filter((p) => prefabsOf(on.shared.totals).includes(p)),
    );
    const baseA = on.bases?.find((b) => b.key === BASE_A);
    expect(baseA && prefabsOf(baseA.totals)).toEqual(
      sqlOrder.filter((p) => baseA && prefabsOf(baseA.totals).includes(p)),
    );
    expect(prefabsOf(baseA?.totals ?? [])).toContain('arrow_wood');
  });

  it('same scan read twice → deep-equal bases, byBase and chest places', async () => {
    expect(await materials(tokens.admin)).toEqual(
      await materials(tokens.admin),
    );
    expect(await list(tokens.admin)).toEqual(await list(tokens.admin));
  });

  it('a member never sees a private chest, its base or its number', async () => {
    const m = await materials(tokens.member);
    expect(m.personal).toBeNull();
    expect(await places(tokens.member)).toEqual({
      a1: 'A:1',
      a2: 'A:2',
      a3: 'A:1',
      b1: 'B:1',
      b2: 'B:2',
      cartA: 'A:1',
      cartFar: 'null:1',
    });
    const json = JSON.stringify([m, await list(tokens.member)]);
    for (const n of ['pBridge', 'pOwn', 'pOther'] as const) {
      expect({ n, leaked: json.includes(KEY[n]) }).toEqual({
        n,
        leaked: false,
      });
    }
  });

  it('personal chests are numbered apart, over the viewer’s own visible set', async () => {
    const owner = await places(tokens.owner);
    expect({
      pOwn: owner.pOwn,
      pBridge: owner.pBridge,
      a1: owner.a1,
      a2: owner.a2,
    }).toEqual({ pOwn: 'A:1', pBridge: 'B:1', a1: 'A:1', a2: 'A:2' });
    expect(owner.pOther).toBeUndefined();
    const admin = await places(tokens.admin);
    expect({
      pOther: admin.pOther,
      pOwn: admin.pOwn,
      a1: admin.a1,
      a2: admin.a2,
    }).toEqual({ pOther: 'A:1', pOwn: 'A:2', a1: 'A:1', a2: 'A:2' });
  });

  it('personal.byBase: own chests by base, totals per base', async () => {
    const o = await materials(tokens.owner);
    expect(
      o.personal?.byBase?.map((b) => [b.base, b.chestCount, ids(b.totals)]),
    ).toEqual([
      [BASE_A, 1, ['Wood:1']],
      [BASE_B, 1, ['Gold:1']],
    ]);
    expect((await materials(tokens.impersonated)).personal).toBeNull();
  });

  it('?prefab= keeps every chest’s index; the detail route carries the same place', async () => {
    const all = await places(tokens.owner);
    const stone = await places(tokens.owner, '?prefab=Stone');
    expect(stone).toEqual({ a1: all.a1, a3: all.a3 });
    const detail = ValheimContainerDetailSchema.parse(
      await getOk(`/containers/${KEY.pBridge}`, tokens.owner),
    );
    expect([detail.base, detail.index]).toEqual([BASE_B, 1]);
  });
});
