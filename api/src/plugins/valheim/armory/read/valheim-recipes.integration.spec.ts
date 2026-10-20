/**
 * ROK-1854 L3 §2.6 R1–R14 — the recipe planner read routes against a real
 * database. Recipes, the items catalogue and chests are seeded through the
 * real snapshot → importer path (`drainOnce`); profiles/claims are direct
 * inserts, as in the Materials integration spec.
 */
import { JwtService } from '@nestjs/jwt';
import {
  ValheimRecipeCatalogResponseSchema,
  VALHEIM_PLAN_QUANTITY_MAX,
  ValheimRecipePlanResponseSchema,
  ValheimRecipeTreeResponseSchema,
  ValheimCharacterMessageSchema,
  ValheimLinkMessageSchema,
  type ValheimPlanNode,
  type ValheimRecipePlanResponse,
  type ValheimRecipeTreeResponse,
} from '@raid-ledger/contract';
import { getTestApp, type TestApp } from '../../../../common/testing/test-app';
import {
  loginAsAdmin,
  truncateAllTables,
} from '../../../../common/testing/integration-helpers';
import { nonEmpty } from '../../../../common/testing/narrow';
import * as schema from '../../../../drizzle/schema';
import { HUB_NOT_FOUND } from '../../../../guilds/hub-hidden.helpers';
import { SettingsService } from '../../../../settings/settings.service';
import { PluginRegistryService } from '../../../plugin-host/plugin-registry.service';
import { PELICAN_PLUGIN_ID } from '../../../pelican/pelican.constants';
import { fakeServer } from '../../../pelican/testing/pelican-fixtures';
import { VALHEIM_GAME_SLUG, VALHEIM_PLUGIN_ID } from '../../valheim.constants';
import { loadValheimFixture } from '../../link/ingest/valheim-link-ingest.testing';
import { valheimSnapshotRow } from '../../link/ingest/valheim-link-snapshot.helpers';
import { ValheimArmoryImportService } from '../valheim-armory-import.service';
import { ensureFixtureHubId } from '../valheim-armory-map-hub.helpers';
import {
  bronzeRecipes,
  recipeEntry,
  recipeRes,
} from '../valheim-recipes.testing';

const PLUGINS = [PELICAN_PLUGIN_ID, VALHEIM_PLUGIN_ID];
const OWNER_PID = '1000000000000001';
const OTHER_PID = '1000000000000002';
const T_SCAN = '2026-10-17T20:15:42Z';
const NOT_FOUND = 'Recipe not found';
let testApp: TestApp;
let gameId: number;
let server: number;
let hubId: number;
let admin: string;
let tokens: Record<'member' | 'owner' | 'operator', string>;

type Msg = Record<string, unknown>;
const registry = () => testApp.app.get(PluginRegistryService);
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const base = (s: number) => `/plugins/valheim/armory/servers/${s}/recipes`;
const get = (url: string, t: string) => testApp.request.get(url).set(auth(t));
const sign = (sub: number) =>
  testApp.app.get(JwtService).sign({ sub, username: `u${sub}` });

function must<T>(v: T | undefined, label: string): T {
  if (v === undefined) throw new Error(`missing ${label}`);
  return v;
}

async function makeUser(username: string, role: 'member' | 'operator') {
  const [u] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({ discordId: `local:${username}`, username, role })
      .returning({ id: schema.users.id }),
    `user ${username}`,
  );
  return u.id;
}

async function makeServer(n: number): Promise<number> {
  const s = fakeServer(n);
  const [row] = nonEmpty(
    await testApp.db
      .insert(schema.pelicanServers)
      .values({
        panelUuid: s.uuid,
        identifier: s.identifier,
        name: s.name,
        gameId,
      })
      .returning({ id: schema.pelicanServers.id }),
    'server',
  );
  return row.id;
}

/** Store (or replace) a message as ingest does, then drain it through the importer. */
async function importMsg(serverId: number, msg: Msg): Promise<void> {
  const row = valheimSnapshotRow(serverId, ValheimLinkMessageSchema.parse(msg));
  const S = schema.valheimLinkSnapshots;
  await testApp.db
    .insert(S)
    .values(row)
    .onConflictDoUpdate({
      target: [S.pelicanServerId, S.kind, S.snapshotKey],
      set: {
        capturedAt: row.capturedAt,
        payload: row.payload,
        blobRefs: row.blobRefs,
        status: 'pending',
      },
    });
  await testApp.app.get(ValheimArmoryImportService).drainOnce();
}

const ICON = { kind: 'atlas', x: 0, y: 0, w: 64, h: 64 };
const catItem = (prefab: string, name: string, maxQuality = 1) => ({
  prefab,
  name,
  category: 'Material',
  maxStack: 50,
  maxQuality,
  variants: 0,
  icon: ICON,
});
/** Items catalogue: Bronze/Copper/Wood (q1), SwordBronze (q4). */
const catalogMsg = (over: Msg = {}): Msg => ({
  ...loadValheimFixture('items-atlas'),
  items: [
    catItem('Bronze', 'Bronze'),
    catItem('Copper', 'Copper'),
    catItem('SwordBronze', 'Bronze sword', 4),
    catItem('Wood', 'Wood'),
  ],
  ...over,
});

const box = (over: Msg): Msg => ({
  prefab: 'piece_chest',
  x: 0,
  y: 30,
  z: 0,
  creatorPlayerId: OWNER_PID,
  privacy: 'public',
  vehicle: false,
  slots: 30,
  usedSlots: 1,
  unreadable: false,
  omittedEntries: 0,
  items: [],
  ...over,
});
const stack = (prefab: string, n: number) => ({
  prefab,
  quality: 1,
  stack: n,
});
const scanMsg = (containers: Msg[]): Msg => ({
  ...loadValheimFixture('containers-basic'),
  capturedAt: T_SCAN,
  containers,
});

async function claimProfile(playerId: string, by: number): Promise<void> {
  const ch = ValheimCharacterMessageSchema.parse(
    loadValheimFixture('character-vanilla'),
  );
  await testApp.db.insert(schema.valheimProfiles).values({
    pelicanServerId: server,
    steamId: `S_${playerId}`,
    playerId,
    worldUid: '1234567890123',
    worldName: 'W',
    name: `c${playerId.slice(-2)}`,
    gameVersion: '0.220.5',
    modVersion: '1.0.0',
    capturedAt: new Date(T_SCAN),
    equipment: ch.equipment,
    inventory: ch.inventory,
    skills: ch.skills,
    trophies: [],
    knownItems: [],
    knownRecipes: [],
    claimedBy: by,
    claimSource: 'auto',
    claimedAt: new Date(),
  });
}

async function tree(q: string, t = tokens.member) {
  const res = await get(`${base(server)}/${q}`, t);
  expect({ status: res.status, body: res.body as unknown }).toMatchObject({
    status: 200,
  });
  return ValheimRecipeTreeResponseSchema.parse(res.body);
}
async function plan(q: string, t = tokens.member) {
  const res = await get(`${base(server)}/plan?${q}`, t);
  expect({ status: res.status, body: res.body as unknown }).toMatchObject({
    status: 200,
  });
  return ValheimRecipePlanResponseSchema.parse(res.body);
}
async function catalogue(t = tokens.member, s = server) {
  const res = await get(base(s), t);
  expect(res.status).toBe(200);
  return ValheimRecipeCatalogResponseSchema.parse(res.body);
}

/** `id<parent prefab:via×quantity` — one line per node (as the unit spec). */
const shape = (nodes: ValheimPlanNode[]) =>
  nodes.map(
    (n) =>
      `${n.id}<${n.parentId ?? '-'} ${n.prefab}:${n.via.type}×${n.quantity}`,
  );
function nodeOf(
  body: ValheimRecipeTreeResponse | ValheimRecipePlanResponse,
  prefab: string,
  via?: ValheimPlanNode['via']['type'],
): ValheimPlanNode {
  return must(
    body.nodes.find(
      (n) => n.prefab === prefab && (via === undefined || n.via.type === via),
    ),
    `${prefab} ${via ?? ''} node`,
  );
}

const BRONZE_SHAPE = [
  '0<- Bronze:recipe×1',
  '1<0 Copper:process×2',
  '2<1 CopperOre:gathered×2',
  '3<1 Coal:fuel×4',
  '4<3 Coal:process×4',
  '5<4 Wood:gathered×4',
  '6<0 Tin:process×1',
  '7<6 TinOre:gathered×1',
  '8<6 Coal:fuel×2',
  '9<8 Coal:process×2',
  '10<9 Wood:gathered×2',
];

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
  gameId = g.id;
  server = await makeServer(1);
  hubId = await ensureFixtureHubId(testApp.db, server, gameId);
  admin = await loginAsAdmin(testApp.request, testApp.seed);
  const ownerId = await makeUser('owner', 'member');
  await claimProfile(OWNER_PID, ownerId);
  tokens = {
    member: sign(await makeUser('member', 'member')),
    owner: sign(ownerId),
    operator: sign(await makeUser('operator', 'operator')),
  };
});

afterEach(async () => {
  for (const slug of PLUGINS) {
    if (registry().isActive(slug)) await registry().deactivate(slug);
  }
  testApp.app.get(SettingsService).invalidateCache(true);
});

describe('catalogue (R1/R2/R9)', () => {
  it('R1 member: items + pieces, names from the catalogue, prefab when missing', async () => {
    await importMsg(server, bronzeRecipes());
    await importMsg(server, catalogMsg());
    const r = await catalogue();
    expect({ v: r.gameVersion, fb: r.catalogFallback }).toEqual({
      v: '0.220.5',
      fb: false,
    });
    expect(
      r.entries.map((e) => `${e.kind}:${e.prefab}=${e.name}/q${e.maxQuality}`),
    ).toEqual([
      'item:Bronze=Bronze/q1',
      'item:Coal=Coal/q1',
      'item:Copper=Copper/q1',
      'item:SwordBronze=Bronze sword/q4',
      'item:Tin=Tin/q1',
      'piece:piece_chest=Chest/q1',
    ]);
    const coal = must(
      r.entries.find((e) => e.prefab === 'Coal'),
      'Coal entry',
    );
    expect(coal.sources).toEqual({ recipes: 0, processes: 1 });
    expect(r.stations.map((s) => s.prefab)).toEqual([
      'forge',
      'piece_workbench',
    ]);
    expect(r.itemAtlas).toMatchObject({ sha256: 'b'.repeat(64), ready: false });
    expect(r.recipeAtlas).toBeNull();
  });

  it('R2 no catalogue for the set version: newest one, catalogFallback true', async () => {
    await importMsg(server, bronzeRecipes());
    await importMsg(server, catalogMsg({ gameVersion: '0.219.0' }));
    const r = await catalogue();
    expect(r.catalogFallback).toBe(true);
    const sword = must(
      r.entries.find((e) => e.prefab === 'SwordBronze'),
      'SwordBronze entry',
    );
    expect({ name: sword.name, q: sword.maxQuality }).toEqual({
      name: 'Bronze sword',
      q: 4,
    });
  });

  it('no catalogue at all: prefab as name, maxQuality 1, no fallback', async () => {
    await importMsg(server, bronzeRecipes());
    const r = await catalogue();
    expect(r.catalogFallback).toBe(false);
    expect(r.itemAtlas).toBeNull();
    const sword = must(
      r.entries.find((e) => e.prefab === 'SwordBronze'),
      'SwordBronze entry',
    );
    expect({ name: sword.name, q: sword.maxQuality }).toEqual({
      name: 'SwordBronze',
      q: 1,
    });
  });

  it('R9 no set: empty catalogue, /tree 404, /plan echoes with stock none', async () => {
    expect(await catalogue()).toEqual({
      gameVersion: null,
      capturedAt: null,
      catalogFallback: false,
      entries: [],
      stations: [],
      itemAtlas: null,
      recipeAtlas: null,
    });
    const t = await get(`${base(server)}/Bronze/tree`, tokens.member);
    expect({ status: t.status, body: t.body as unknown }).toMatchObject({
      status: 404,
      body: { message: NOT_FOUND },
    });
    const p = await plan('targets=Bronze:1:2');
    expect(p).toMatchObject({ stock: 'none', nodes: [], shoppingList: [] });
    expect(p.targets).toEqual([
      { prefab: 'Bronze', quality: 1, amount: 2, fromQuality: 0 },
    ]);
  });
});

describe('tree (R3/R4 + 404/400/clamp)', () => {
  beforeEach(async () => {
    await importMsg(server, bronzeRecipes());
    await importMsg(server, catalogMsg());
  });

  it('R3 Bronze q1: recipe → smelter + kiln Coal fuel → ores/Wood; have null', async () => {
    const r = await tree('Bronze/tree');
    expect(r.target).toEqual({ prefab: 'Bronze', quality: 1 });
    expect(shape(r.nodes)).toEqual(BRONZE_SHAPE);
    expect(r.nodes.filter((n) => n.have !== null || n.short !== null)).toEqual(
      [],
    );
    expect(nodeOf(r, 'Copper').via).toMatchObject({
      type: 'process',
      processor: 'smelter',
      fuel: 'Coal',
    });
    expect(r.truncated).toBe(false);
    // The catalogue subset rides along: Wood is a leaf in the catalogue.
    expect(r.items['Wood']).toEqual({
      name: 'Wood',
      category: 'Material',
      icon: expect.anything() as unknown,
    });
    expect(Object.keys(r.items).sort()).toEqual(['Bronze', 'Copper', 'Wood']);
    expect(r.itemAtlas).toMatchObject({ sha256: 'b'.repeat(64) });
    expect(r.recipeAtlas).toBeNull();
  });

  it('R4 SwordBronze q3: three steps, Σ amount(r,q), station level 3', async () => {
    const r = await tree('SwordBronze/tree?quality=3');
    expect(r.target).toEqual({ prefab: 'SwordBronze', quality: 3 });
    const root = nodeOf(r, 'SwordBronze');
    expect(root.crafts).toBe(3);
    expect(root.via).toMatchObject({
      type: 'recipe',
      recipeId: 'Recipe_SwordBronze',
      station: 'forge',
      stationLevel: 3,
      quality: 3,
    });
    const kids = r.nodes.filter((n) => n.parentId === root.id);
    expect(kids.map((n) => `${n.prefab}×${n.quantity}`)).toEqual([
      'Bronze×20',
      'Wood×5',
      'LeatherScraps×5',
    ]);
  });

  it('quality clamps to the stored catalogue maxQuality', async () => {
    expect((await tree('SwordBronze/tree?quality=10')).target.quality).toBe(4);
    expect((await tree('Bronze/tree?quality=3')).target.quality).toBe(1);
  });

  it('a piece builds from its resources; kind narrows the 404 rule', async () => {
    const r = await tree('piece_chest/tree');
    expect(shape(r.nodes)).toEqual([
      '0<- piece_chest:recipe×1',
      '1<0 Wood:gathered×10',
    ]);
    for (const q of [
      'Unknown/tree',
      'Bronze/tree?kind=piece',
      'piece_chest/tree?kind=item',
      'CopperOre/tree',
    ]) {
      const res = await get(`${base(server)}/${q}`, tokens.member);
      expect({
        q,
        status: res.status,
        body: res.body as unknown,
      }).toMatchObject({ q, status: 404, body: { message: NOT_FOUND } });
    }
  });

  it.each(['quality=11', 'quality=0', 'quality=x', 'kind=thing'])(
    '400 on ?%s',
    async (q) => {
      const res = await get(`${base(server)}/Bronze/tree?${q}`, tokens.member);
      expect(res.status).toBe(400);
    },
  );

  it('recipeAtlas.ready flips once the atlas blob is stored', async () => {
    const atlas = loadValheimFixture('recipes-processing')['atlas'];
    await importMsg(
      server,
      bronzeRecipes({ atlas, capturedAt: '2026-10-17T21:00:00Z' }),
    );
    expect((await tree('Bronze/tree')).recipeAtlas).toMatchObject({
      sha256: 'd'.repeat(64),
      ready: false,
    });
    await testApp.db.insert(schema.valheimLinkBlobs).values({
      pelicanServerId: server,
      sha256: 'd'.repeat(64),
      byteLength: 65536,
      contentType: 'image/png',
      width: 256,
      height: 256,
      storagePath: `${server}/atlas.png`,
    });
    expect((await tree('Bronze/tree')).recipeAtlas?.ready).toBe(true);
    expect((await catalogue()).recipeAtlas?.ready).toBe(true);
  });
});

describe('plan (R5–R8, R13)', () => {
  beforeEach(async () => {
    await importMsg(server, bronzeRecipes());
    await importMsg(server, catalogMsg());
  });

  const haveOf = (r: ValheimRecipePlanResponse, prefab: string) =>
    r.shoppingList.find((l) => l.prefab === prefab)?.have ?? null;

  it('R5 shared stock: Copper covered → no CopperOre node', async () => {
    await importMsg(server, scanMsg([box({ items: [stack('Copper', 40)] })]));
    const r = await plan('targets=Bronze:1:20');
    expect({ stock: r.stock, at: r.capturedAt }).toEqual({
      stock: 'scan',
      at: '2026-10-17T20:15:00.000Z',
    });
    const copper = nodeOf(r, 'Copper');
    expect({
      have: copper.have,
      short: copper.short,
      crafts: copper.crafts,
    }).toEqual({ have: 40, short: 0, crafts: 0 });
    expect(r.nodes.some((n) => n.prefab === 'CopperOre')).toBe(false);
    expect(r.shoppingList).toEqual([
      { prefab: 'TinOre', need: 20, have: 0, short: 20 },
      { prefab: 'Wood', need: 40, have: 0, short: 40 },
    ]);
  });

  it('R6 includePersonal: owner adds own private chest, never another’s; member unchanged', async () => {
    await importMsg(
      server,
      scanMsg([
        box({ x: 0, items: [stack('TinOre', 3)] }),
        box({ x: 1, privacy: 'private', items: [stack('TinOre', 20)] }),
        box({
          x: 2,
          privacy: 'private',
          creatorPlayerId: OTHER_PID,
          items: [stack('TinOre', 500)],
        }),
      ]),
    );
    const q = 'targets=Bronze:1:30';
    expect(haveOf(await plan(q, tokens.owner), 'TinOre')).toBe(3);
    const mine = await plan(`${q}&includePersonal=true`, tokens.owner);
    expect(haveOf(mine, 'TinOre')).toBe(23);
    const asMember = await plan(`${q}&includePersonal=true`, tokens.member);
    expect(asMember).toEqual(await plan(q, tokens.member));
    expect(haveOf(asMember, 'TinOre')).toBe(3);
    // A site admin (no claimed character) nets their OWN private chests
    // only — never the owner's 20 or the other player's 500.
    const asAdmin = await plan(`${q}&includePersonal=true`, admin);
    expect(haveOf(asAdmin, 'TinOre')).toBe(3);
  });

  it('includeVehicles=false drops cart stock', async () => {
    await importMsg(
      server,
      scanMsg([
        box({ prefab: 'Cart', vehicle: true, items: [stack('Copper', 40)] }),
      ]),
    );
    const q = 'targets=Bronze:1:20';
    expect(nodeOf(await plan(q), 'Copper').have).toBe(40);
    const noCart = await plan(`${q}&includeVehicles=false`);
    expect(nodeOf(noCart, 'Copper').have).toBe(0);
    expect(noCart.nodes.some((n) => n.prefab === 'CopperOre')).toBe(true);
  });

  it('R7 two targets sharing Copper draw from ONE ledger', async () => {
    await importMsg(server, scanMsg([box({ items: [stack('Copper', 3)] })]));
    const r = await plan('targets=Bronze:1:1,Bronze:1:1');
    const coppers = r.nodes.filter((n) => n.prefab === 'Copper');
    // have = the ledger stock available before each take: 3, then 1 left.
    expect(coppers.map((n) => [n.have, n.short])).toEqual([
      [3, 0],
      [1, 1],
    ]);
  });

  it('a newer same-version re-import replaces a warm cached graph', async () => {
    const swordVia = async () =>
      nodeOf(await plan('targets=SwordBronze:1:1'), 'SwordBronze').via.type;
    expect(await swordVia()).toBe('recipe'); // warms the graph cache
    expect((await catalogue()).entries.map((e) => e.prefab)).toContain(
      'SwordBronze',
    );
    await importMsg(
      server,
      bronzeRecipes({
        capturedAt: '2026-10-18T09:00:00Z',
        recipes: [
          recipeEntry('Recipe_Bronze', 'Bronze', [
            recipeRes('Copper', 2),
            recipeRes('Tin', 1),
          ]),
        ],
      }),
    );
    expect(await swordVia()).toBe('gathered');
    expect((await catalogue()).entries.map((e) => e.prefab)).not.toContain(
      'SwordBronze',
    );
  });

  it('R8 no scan: stock none, have/short null, need still priced', async () => {
    const r = await plan('targets=Bronze:1:1');
    expect({ stock: r.stock, at: r.capturedAt }).toEqual({
      stock: 'none',
      at: null,
    });
    expect(r.nodes.filter((n) => n.have !== null || n.short !== null)).toEqual(
      [],
    );
    expect(r.shoppingList).toEqual([
      { prefab: 'CopperOre', need: 2, have: null, short: null },
      { prefab: 'Wood', need: 6, have: null, short: null },
      { prefab: 'TinOre', need: 1, have: null, short: null },
    ]);
    expect(Object.keys(r.items).sort()).toEqual(['Bronze', 'Copper', 'Wood']);
  });

  it('plan targets clamp to the catalogue maxQuality', async () => {
    const r = await plan('targets=SwordBronze:10:1,Bronze:5:1');
    expect(r.targets.map((t) => `${t.prefab}:${t.quality}`)).toEqual([
      'SwordBronze:4',
      'Bronze:1',
    ]);
  });

  it.each([
    ['21 targets', Array.from({ length: 21 }, () => 'Bronze:1:1').join(',')],
    ['n = 0', 'Bronze:1:0'],
    ['n > 10 000', 'Bronze:1:10001'],
    ['bad prefab', 'no%20way:1:1'],
    ['quality 11', 'Bronze:11:1'],
    ['two fields', 'Bronze:1'],
    ['empty', ''],
  ])('R13 400 on %s', async (_label, targets) => {
    const res = await get(
      `${base(server)}/plan?targets=${targets}`,
      tokens.member,
    );
    expect({ status: res.status }).toEqual({ status: 400 });
  });

  it('R13 20 targets is the cap, not an error', async () => {
    const twenty = Array.from({ length: 20 }, () => 'Bronze:1:1').join(',');
    expect((await plan(`targets=${twenty}`)).targets).toHaveLength(20);
  });
});

describe('hub + headers (R10/R11/R12)', () => {
  const PATHS = ['', '/Bronze/tree', '/plan?targets=Bronze:1:1'];
  beforeEach(() => importMsg(server, bronzeRecipes()));

  it('R10 hidden hub: member 404 HUB_NOT_FOUND on all three; admin + operator 200', async () => {
    const hide = await testApp.request
      .patch(`/guilds/${hubId}/hidden`)
      .set(auth(admin))
      .send({ hidden: true });
    expect(hide.status).toBe(200);
    for (const path of PATHS) {
      const res = await get(`${base(server)}${path}`, tokens.member);
      expect({
        path,
        status: res.status,
        body: res.body as unknown,
      }).toMatchObject({ path, status: 404, body: { message: HUB_NOT_FOUND } });
      for (const t of [admin, tokens.operator]) {
        const ok = await get(`${base(server)}${path}`, t);
        expect({ path, status: ok.status }).toEqual({ path, status: 200 });
      }
    }
  });

  it('R11 a server without a hub: 404 on all three', async () => {
    const bare = await makeServer(3);
    await importMsg(bare, bronzeRecipes());
    for (const path of PATHS) {
      const res = await get(`${base(bare)}${path}`, admin);
      expect({ path, status: res.status }).toEqual({ path, status: 404 });
    }
  });

  it('R12 Cache-Control private, no-store on all three', async () => {
    for (const path of PATHS) {
      const res = await get(`${base(server)}${path}`, tokens.member);
      expect({
        path,
        status: res.status,
        cc: res.headers['cache-control'],
      }).toEqual({ path, status: 200, cc: 'private, no-store' });
    }
  });
});

describe('modded cycle (R14)', () => {
  it('A needs B, B needs A: a cycle leaf, no hang, not truncated', async () => {
    await importMsg(
      server,
      bronzeRecipes({
        recipes: [
          recipeEntry('Recipe_A', 'ModA', [recipeRes('ModB', 1)]),
          recipeEntry('Recipe_B', 'ModB', [recipeRes('ModA', 1)]),
        ],
      }),
    );
    const t = await tree('ModA/tree');
    expect(shape(t.nodes)).toEqual([
      '0<- ModA:recipe×1',
      '1<0 ModB:recipe×1',
      '2<1 ModA:cycle×1',
    ]);
    expect(t.truncated).toBe(false);
    const p = await plan('targets=ModA:1:1');
    expect({ truncated: p.truncated, list: p.shoppingList }).toEqual({
      truncated: false,
      list: [{ prefab: 'ModA', need: 1, have: null, short: null }],
    });
  });
});

describe('modded quantity overflow', () => {
  it('a 10 000 × 10 000 × 10 000 chain is 200 + truncated, never a 500', async () => {
    await importMsg(
      server,
      bronzeRecipes({
        recipes: [
          recipeEntry('Recipe_HugeA', 'HugeA', [recipeRes('HugeB', 10_000)]),
          recipeEntry('Recipe_HugeB', 'HugeB', [recipeRes('HugeC', 10_000)]),
          recipeEntry('Recipe_HugeC', 'HugeC', [recipeRes('HugeD', 10_000)]),
        ],
      }),
    );
    const p = await plan('targets=HugeA:1:10000');
    expect({ truncated: p.truncated, nodes: shape(p.nodes) }).toEqual({
      truncated: true,
      nodes: [
        '0<- HugeA:recipe×10000',
        '1<0 HugeB:recipe×100000000',
        `2<1 HugeC:recipe×${VALHEIM_PLAN_QUANTITY_MAX}`,
      ],
    });
  });
});

describe('plan — Codex r3 (pieces, batch surplus, list cap)', () => {
  it('a piece target never nets a same-prefab chest item', async () => {
    await importMsg(server, bronzeRecipes());
    await importMsg(
      server,
      scanMsg([box({ items: [stack('piece_chest', 1)] })]),
    );
    const p = await plan('targets=piece_chest:1:1:0:piece');
    expect(p.shoppingList).toEqual([
      { prefab: 'Wood', need: 10, have: 0, short: 10 },
    ]);
  });

  it('two targets share one batch: 20 nails per Bronze → one Bronze', async () => {
    await importMsg(
      server,
      bronzeRecipes({
        recipes: [
          recipeEntry('Recipe_Nails', 'BronzeNails', [recipeRes('Bronze', 1)], {
            amount: 20,
          }),
          recipeEntry('Recipe_WallA', 'ModWallA', [
            recipeRes('BronzeNails', 4),
          ]),
          recipeEntry('Recipe_WallB', 'ModWallB', [
            recipeRes('BronzeNails', 4),
          ]),
        ],
      }),
    );
    const p = await plan('targets=ModWallA:1:1,ModWallB:1:1');
    const nails = p.nodes.filter((n) => n.prefab === 'BronzeNails');
    expect(nails.map((n) => n.crafts)).toEqual([1, 0]);
    expect(p.shoppingList).toEqual([
      { prefab: 'Bronze', need: 1, have: null, short: null },
    ]);
  });

  it('20 targets × 100 M Wood: the capped list total flags truncated', async () => {
    await importMsg(
      server,
      bronzeRecipes({
        recipes: [
          recipeEntry('Recipe_ModW', 'ModW', [recipeRes('Wood', 10_000)]),
        ],
      }),
    );
    const twenty = Array.from({ length: 20 }, () => 'ModW:1:10000').join(',');
    const p = await plan(`targets=${twenty}`);
    expect({ truncated: p.truncated, list: p.shoppingList }).toEqual({
      truncated: true,
      list: [
        {
          prefab: 'Wood',
          need: VALHEIM_PLAN_QUANTITY_MAX,
          have: null,
          short: null,
        },
      ],
    });
  });
});
