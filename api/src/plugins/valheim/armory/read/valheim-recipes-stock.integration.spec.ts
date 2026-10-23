/**
 * ROK-1899 §6 — `GET …/recipes/stock` (the crafting window's affordability
 * totals) and the catalogue's `craft` / `upgrades` / `ingredients`, against a
 * real database. Stock must be exactly the ledger `/plan` nets against (D7
 * scope), and a catalogue upgrade step exactly the plan's cost for that step.
 * Setup mirrors `valheim-recipes.integration.spec.ts` (split: that file is
 * at its size limit).
 */
import {
  ValheimCharacterMessageSchema,
  ValheimLinkMessageSchema,
  ValheimRecipeCatalogResponseSchema,
  ValheimRecipePlanResponseSchema,
  ValheimRecipeStockResponseSchema,
  type ValheimRecipePlanResponse,
} from '@raid-ledger/contract';
import { signTestAccessToken } from '../../../../common/testing/sign-test-access-token';
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
import { bronzeRecipes } from '../valheim-recipes.testing';

const PLUGINS = [PELICAN_PLUGIN_ID, VALHEIM_PLUGIN_ID];
const OWNER_PID = '1000000000000001';
const OTHER_PID = '1000000000000002';
const T_SCAN = '2026-10-17T20:15:42Z';
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
  signTestAccessToken(testApp, { sub, username: `u${sub}` });

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
/** Items catalogue: Bronze/Copper/Tin/Wood (q1), SwordBronze (q4). */
const catalogMsg = (over: Msg = {}): Msg => ({
  ...loadValheimFixture('items-atlas'),
  items: [
    catItem('Bronze', 'Bronze'),
    catItem('Copper', 'Copper'),
    catItem('SwordBronze', 'Bronze sword', 4),
    catItem('Tin', 'Tin'),
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

async function stock(q = '', t = tokens.member, s = server) {
  const res = await get(`${base(s)}/stock${q ? `?${q}` : ''}`, t);
  expect({ status: res.status, body: res.body as unknown }).toMatchObject({
    status: 200,
  });
  return ValheimRecipeStockResponseSchema.parse(res.body);
}
async function plan(q: string, t = tokens.member) {
  const res = await get(`${base(server)}/plan?${q}`, t);
  expect({ status: res.status, body: res.body as unknown }).toMatchObject({
    status: 200,
  });
  return ValheimRecipePlanResponseSchema.parse(res.body);
}
async function catalogue(t = tokens.member) {
  const res = await get(base(server), t);
  expect(res.status).toBe(200);
  return ValheimRecipeCatalogResponseSchema.parse(res.body);
}
const haveOf = (r: ValheimRecipePlanResponse, prefab: string) =>
  must(
    r.nodes.find((n) => n.prefab === prefab),
    `${prefab} node`,
  ).have;

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
    member: await sign(await makeUser('member', 'member')),
    owner: await sign(ownerId),
    operator: await sign(await makeUser('operator', 'operator')),
  };
});

afterEach(async () => {
  for (const slug of PLUGINS) {
    if (registry().isActive(slug)) await registry().deactivate(slug);
  }
  testApp.app.get(SettingsService).invalidateCache(true);
});

describe('GET recipes/stock (ROK-1899 AC15)', () => {
  beforeEach(() => importMsg(server, bronzeRecipes()));

  it('no scan: stock none, no capturedAt, empty totals', async () => {
    expect(await stock()).toEqual({
      stock: 'none',
      capturedAt: null,
      totals: {},
    });
  });

  it('totals equal the /plan Copper have, summed across qualities', async () => {
    await importMsg(
      server,
      scanMsg([
        box({ x: 0, items: [stack('Copper', 25), stack('Wood', 4)] }),
        box({ x: 1, items: [{ prefab: 'Copper', quality: 2, stack: 15 }] }),
      ]),
    );
    const s = await stock();
    expect(s).toEqual({
      stock: 'scan',
      capturedAt: '2026-10-17T20:15:00.000Z',
      totals: { Copper: 40, Wood: 4 },
    });
    const p = await plan('targets=Bronze:1:20');
    expect({ copper: s.totals.Copper, capturedAt: s.capturedAt }).toEqual({
      copper: haveOf(p, 'Copper'),
      capturedAt: p.capturedAt,
    });
  });

  it('includePersonal: own private chests only — member and admin never see another’s', async () => {
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
    const tin = async (q: string, t: string) =>
      (await stock(q, t)).totals.TinOre;
    expect(await tin('', tokens.owner)).toBe(3);
    expect(await tin('includePersonal=true', tokens.owner)).toBe(23);
    expect(await tin('includePersonal=true', tokens.member)).toBe(3);
    expect(await tin('includePersonal=true', admin)).toBe(3);
    const mine = await plan(
      'targets=Bronze:1:30&includePersonal=true',
      tokens.owner,
    );
    expect(haveOf(mine, 'TinOre')).toBe(23);
  });

  it('includeVehicles=false drops cart stock', async () => {
    await importMsg(
      server,
      scanMsg([
        box({ prefab: 'Cart', vehicle: true, items: [stack('Copper', 40)] }),
      ]),
    );
    expect((await stock()).totals.Copper).toBe(40);
    expect(
      (await stock('includeVehicles=false')).totals.Copper,
    ).toBeUndefined();
  });

  it('/plan includeVehicles=false drops cart stock (moved from valheim-recipes.integration.spec)', async () => {
    await importMsg(
      server,
      scanMsg([
        box({ prefab: 'Cart', vehicle: true, items: [stack('Copper', 40)] }),
      ]),
    );
    const q = 'targets=Bronze:1:20';
    expect(haveOf(await plan(q), 'Copper')).toBe(40);
    const noCart = await plan(`${q}&includeVehicles=false`);
    expect(haveOf(noCart, 'Copper')).toBe(0);
    expect(noCart.nodes.some((n) => n.prefab === 'CopperOre')).toBe(true);
  });

  it('hidden hub: member 404 HUB_NOT_FOUND, admin 200; private, no-store', async () => {
    const ok = await get(`${base(server)}/stock`, tokens.member);
    expect(ok.headers['cache-control']).toBe('private, no-store');
    const hide = await testApp.request
      .patch(`/guilds/${hubId}/hidden`)
      .set(auth(admin))
      .send({ hidden: true });
    expect(hide.status).toBe(200);
    const res = await get(`${base(server)}/stock`, tokens.member);
    expect({ status: res.status, body: res.body as unknown }).toMatchObject({
      status: 404,
      body: { message: HUB_NOT_FOUND },
    });
    expect((await get(`${base(server)}/stock`, admin)).status).toBe(200);
  });

  it('a server without a hub: 404', async () => {
    const bare = await makeServer(3);
    const res = await get(`${base(bare)}/stock`, admin);
    expect(res.status).toBe(404);
  });
});

describe('catalogue craft / upgrades / ingredients (ROK-1899 AC16)', () => {
  beforeEach(async () => {
    await importMsg(server, bronzeRecipes());
    await importMsg(server, catalogMsg());
  });

  it('Bronze crafts at the forge from Copper 2 + Tin 1; ingredients name Tin', async () => {
    const r = await catalogue();
    const bronze = must(
      r.entries.find((e) => e.prefab === 'Bronze'),
      'Bronze entry',
    );
    expect(bronze.craft).toEqual({
      via: 'recipe',
      station: 'forge',
      stationLevel: 1,
      anyOneOf: false,
      resources: [
        { prefab: 'Copper', amount: 2 },
        { prefab: 'Tin', amount: 1 },
      ],
      amount: 1,
    });
    expect(bronze.upgrades).toEqual([]);
    expect(r.ingredients.Tin).toMatchObject({ name: 'Tin' });
    expect(r.ingredients.Wood).toMatchObject({ name: 'Wood' });
    // Exactly the catalogued ingredients: SwordBronze has a catalogue row but
    // is nobody's resource; LeatherScraps is a resource with no catalogue row.
    expect(Object.keys(r.ingredients).sort()).toEqual([
      'Bronze',
      'Copper',
      'Tin',
      'Wood',
    ]);
    expect(r.ingredients.LeatherScraps).toBeUndefined();
    const coal = must(
      r.entries.find((e) => e.prefab === 'Coal'),
      'Coal entry',
    );
    expect(coal.craft).toMatchObject({
      via: 'process',
      station: 'charcoal_kiln',
    });
    const chest = must(
      r.entries.find((e) => e.kind === 'piece' && e.prefab === 'piece_chest'),
      'piece_chest entry',
    );
    expect({ via: chest.craft?.via, upgrades: chest.upgrades }).toEqual({
      via: 'piece',
      upgrades: [],
    });
  });

  it('the q2 upgrade step equals the /plan cost for fromQuality 1 → quality 2', async () => {
    const r = await catalogue();
    const sword = must(
      r.entries.find((e) => e.prefab === 'SwordBronze'),
      'SwordBronze entry',
    );
    expect(sword.upgrades.map((u) => u.quality)).toEqual([2, 3, 4]);
    const step = must(sword.upgrades[0], 'q2 step');
    const p = await plan('targets=SwordBronze:2:1:1');
    const root = must(
      p.nodes.find((n) => n.parentId === null),
      'plan root',
    );
    const direct = p.nodes
      .filter((n) => n.parentId === root.id)
      .map((n) => ({ prefab: n.prefab, amount: n.quantity }));
    expect(step.resources).toEqual(direct);
    expect(step.resources).toEqual([
      { prefab: 'Bronze', amount: 4 },
      { prefab: 'Wood', amount: 1 },
      { prefab: 'LeatherScraps', amount: 1 },
    ]);
    expect(root.via).toMatchObject({
      type: 'recipe',
      station: step.station,
      stationLevel: step.stationLevel,
    });
  });
});
