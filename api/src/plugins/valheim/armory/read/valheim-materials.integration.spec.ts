/**
 * ROK-1853 L3 §2.5 — the Materials read routes against a real database.
 * Containers are seeded through the real snapshot → importer path (golden
 * fixtures + a synthetic world built on their header); profiles/claims are
 * direct inserts. Visibility is asserted per actor on all three routes.
 */
import { JwtService } from '@nestjs/jwt';
import { and, eq } from 'drizzle-orm';
import {
  ValheimContainerDetailSchema,
  ValheimContainerListResponseSchema,
  ValheimMaterialsResponseSchema,
  type ValheimMaterialsResponse,
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

const PLUGINS = [PELICAN_PLUGIN_ID, VALHEIM_PLUGIN_ID];
const OWNER_PID = '1000000000000001';
const OTHER_PID = '1000000000000002';
const T0 = '2026-10-17T20:15:42Z';
const C = schema.valheimContainers;
const P = schema.valheimProfiles;
let testApp: TestApp;
let gameId: number;
let server: number;
let hubId: number;
let admin: string;
let tokens: Record<'member' | 'owner' | 'operator' | 'impersonated', string>;
let ownerId: number;

type Msg = Record<string, unknown>;
type Box = Record<string, unknown>;
const registry = () => testApp.app.get(PluginRegistryService);
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const base = (s: number) => `/plugins/valheim/armory/servers/${s}`;
const get = (url: string, t: string) => testApp.request.get(url).set(auth(t));
const sign = (sub: number, extra: Record<string, unknown> = {}) =>
  testApp.app.get(JwtService).sign({ sub, username: `u${sub}`, ...extra });

async function makeUser(
  username: string,
  role: 'member' | 'operator' = 'member',
  steamId: string | null = null,
): Promise<number> {
  const [u] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({ discordId: `local:${username}`, username, role, steamId })
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

/** Store a message as ingest does, then drain it through the importer. */
async function importMsg(serverId: number, msg: Msg): Promise<void> {
  const row = valheimSnapshotRow(serverId, msg as never);
  await testApp.db.insert(schema.valheimLinkSnapshots).values(row);
  await testApp.app.get(ValheimArmoryImportService).drainOnce();
}

function box(over: Box): Box {
  return {
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
  };
}
const item = (prefab: string, stack: number, quality = 1) => ({
  prefab,
  quality,
  stack,
});

/** The synthetic world: 3 shared (1 a cart), 3 private (2 owner, 1 other). */
function world(over: Msg = {}): Msg {
  const header = loadValheimFixture('containers-basic');
  return {
    ...header,
    capturedAt: T0,
    omittedShared: 2,
    omittedPrivate: 3,
    containers: [
      box({ x: 0, items: [item('Wood', 50), item('Stone', 20)] }),
      box({
        x: 1,
        privacy: 'group',
        creatorPlayerId: OTHER_PID,
        items: [item('Wood', 7)],
      }),
      box({
        prefab: 'piece_chest_private',
        x: 5,
        z: 5,
        privacy: 'private',
        items: [item('Wood', 100), item('Gold', 3)],
      }),
      box({
        prefab: 'piece_chest_private',
        x: 5,
        z: 5,
        privacy: 'private',
        creatorPlayerId: OTHER_PID,
        items: [item('Silver', 9)],
      }),
      box({ prefab: 'Cart', x: 9, vehicle: true, items: [item('Iron', 4)] }),
      box({ x: 12, privacy: 'private', unreadable: true, usedSlots: 0 }),
    ],
    ...over,
  };
}

async function profile(
  serverId: number,
  playerId: string,
  steamId: string,
  claim: { by: number; source: 'auto' | 'manual' | 'admin' } | null,
): Promise<number> {
  const ch = loadValheimFixture('character-vanilla') as never as Record<
    string,
    never
  >;
  const [row] = nonEmpty(
    await testApp.db
      .insert(P)
      .values({
        pelicanServerId: serverId,
        steamId,
        playerId,
        worldUid: '1234567890123',
        worldName: 'W',
        name: `c${playerId.slice(-2)}`,
        gameVersion: '0.220.5',
        modVersion: '1.0.0',
        capturedAt: new Date(T0),
        equipment: ch.equipment,
        inventory: ch.inventory,
        skills: ch.skills,
        trophies: [],
        knownItems: [],
        knownRecipes: [],
        claimedBy: claim?.by ?? null,
        claimSource: claim?.source ?? null,
        claimedAt: claim ? new Date() : null,
      })
      .returning({ id: P.id }),
    'profile',
  );
  return row.id;
}

/** Public key of a seeded chest (tests only — the routes never expose ids). */
async function keyOf(creator: string, prefab: string): Promise<string> {
  const [row] = nonEmpty(
    await testApp.db
      .select({ k: C.publicKey })
      .from(C)
      .where(and(eq(C.creatorPlayerId, creator), eq(C.prefab, prefab))),
    `key ${creator}/${prefab}`,
  );
  return row.k;
}

async function materials(t: string, q = ''): Promise<ValheimMaterialsResponse> {
  const res = await get(`${base(server)}/materials${q}`, t);
  expect(res.status).toBe(200);
  return ValheimMaterialsResponseSchema.parse(res.body);
}
const totalsOf = (r: ValheimMaterialsResponse['shared'] | null | undefined) =>
  (r?.totals ?? []).map(
    (s) => `${s.prefab}:${s.quality}=${s.total}/${s.chests}`,
  );
async function listKeys(t: string, q = ''): Promise<string[]> {
  const res = await get(`${base(server)}/containers${q}`, t);
  expect(res.status).toBe(200);
  return ValheimContainerListResponseSchema.parse(res.body).containers.map(
    (c) => `${c.prefab}@${c.x}:${c.privacy}`,
  );
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
  gameId = g.id;
  server = await makeServer(1);
  hubId = await ensureFixtureHubId(testApp.db, server, gameId);
  admin = await loginAsAdmin(testApp.request, testApp.seed);
  ownerId = await makeUser('owner');
  await profile(server, OWNER_PID, 'S_OWNER', { by: ownerId, source: 'auto' });
  tokens = {
    member: sign(await makeUser('member')),
    owner: sign(ownerId),
    operator: sign(await makeUser('operator', 'operator')),
    impersonated: sign(ownerId, { impersonatedBy: testApp.seed.adminUser.id }),
  };
});

afterEach(async () => {
  for (const slug of PLUGINS) {
    if (registry().isActive(slug)) await registry().deactivate(slug);
  }
  testApp.app.get(SettingsService).invalidateCache(true);
});

const SHARED_TOTALS = ['Iron:1=4/1', 'Stone:1=20/1', 'Wood:1=57/2'];

describe('materials visibility (R1/R2/R4/R5/R6/R12)', () => {
  beforeEach(() => importMsg(server, world()));

  it('R1 member: shared totals summed per (prefab, quality); personal null', async () => {
    const r = await materials(tokens.member);
    expect(totalsOf(r.shared)).toEqual(SHARED_TOTALS);
    expect(r.shared.chestCount).toBe(3);
    // R12: the unreadable chest is private — not in the member's warnings.
    expect(r.shared.warnings).toEqual({
      unreadable: 0,
      omittedEntries: 0,
      omittedShared: 2,
    });
    expect(r.personal).toBeNull();
    expect(r.capturedAt).toBe('2026-10-17T20:15:00.000Z');
    expect(r.worldUid).toBe('1234567890123');
  });

  it('R2 owner (auto claim): personal = own private chests only', async () => {
    const r = await materials(tokens.owner);
    expect(totalsOf(r.shared)).toEqual(SHARED_TOTALS);
    expect(r.personal).toEqual({
      totals: [
        { prefab: 'Gold', quality: 1, total: 3, chests: 1 },
        { prefab: 'Wood', quality: 1, total: 100, chests: 1 },
      ],
      chestCount: 2,
      omittedPrivate: null,
    });
  });

  it('R4 admin: every private chest + omittedPrivate; shared identical to R1', async () => {
    const asMember = await get(`${base(server)}/materials`, tokens.member);
    const r = await materials(admin);
    expect(JSON.stringify(r.shared)).toBe(JSON.stringify(asMember.body.shared));
    expect(totalsOf(r.personal as never)).toEqual([
      'Gold:1=3/1',
      'Silver:1=9/1',
      'Wood:1=100/1',
    ]);
    expect(r.personal?.chestCount).toBe(3);
    expect(r.personal?.omittedPrivate).toBe(3);
  });

  it.each(['operator', 'impersonated'] as const)(
    'R5/R6 %s: no personal block, private chest detail 404',
    async (who) => {
      expect((await materials(tokens[who])).personal).toBeNull();
      const key = await keyOf(OWNER_PID, 'piece_chest_private');
      const res = await get(`${base(server)}/containers/${key}`, tokens[who]);
      expect(res.status).toBe(404);
    },
  );
});

describe('containers list + detail (R2/R3/R11/R17)', () => {
  beforeEach(() => importMsg(server, world()));

  it('member lists shared chests only; owner adds own; admin sees all', async () => {
    const shared = [
      'Cart@9:shared',
      'piece_chest@0:shared',
      'piece_chest@1:shared',
    ];
    expect(await listKeys(tokens.member)).toEqual(shared);
    expect(await listKeys(tokens.owner)).toEqual([
      'Cart@9:shared',
      'piece_chest@0:shared',
      'piece_chest@1:shared',
      'piece_chest@12:personal',
      'piece_chest_private@5:personal',
    ]);
    expect((await listKeys(admin)).length).toBe(6);
  });

  it('R11 two creators at one spot: each owner sees only theirs', async () => {
    const otherId = await makeUser('other');
    await profile(server, OTHER_PID, 'S_OTHER', {
      by: otherId,
      source: 'auto',
    });
    const mine = await keyOf(OWNER_PID, 'piece_chest_private');
    const theirs = await keyOf(OTHER_PID, 'piece_chest_private');
    expect(mine).not.toBe(theirs);
    const other = sign(otherId);
    expect(
      (await get(`${base(server)}/containers/${theirs}`, other)).status,
    ).toBe(200);
    expect(
      (await get(`${base(server)}/containers/${mine}`, other)).status,
    ).toBe(404);
    expect(
      (await get(`${base(server)}/containers/${theirs}`, tokens.owner)).status,
    ).toBe(404);
  });

  it('R2 owner detail of own private chest: stacks, personal', async () => {
    const key = await keyOf(OWNER_PID, 'piece_chest_private');
    const res = await get(`${base(server)}/containers/${key}`, tokens.owner);
    expect(res.status).toBe(200);
    const d = ValheimContainerDetailSchema.parse(res.body);
    expect(d.privacy).toBe('personal');
    expect(d.stacks).toEqual([item('Gold', 3), item('Wood', 100)]);
  });

  it('R3 member detail of a private chest = the unknown-key 404, byte for byte', async () => {
    const key = await keyOf(OWNER_PID, 'piece_chest_private');
    const hidden = await get(
      `${base(server)}/containers/${key}`,
      tokens.member,
    );
    const unknown = await get(
      `${base(server)}/containers/${'Z'.repeat(22)}`,
      tokens.member,
    );
    expect(hidden.status).toBe(404);
    expect(hidden.body).toEqual(unknown.body);
    expect(hidden.body).toMatchObject({ message: 'Container not found' });
  });

  it('R17 includeVehicles=false drops the cart from totals, counts and list', async () => {
    const r = await materials(tokens.member, '?includeVehicles=false');
    expect(totalsOf(r.shared)).toEqual(['Stone:1=20/1', 'Wood:1=57/2']);
    expect(r.shared.chestCount).toBe(2);
    expect(await listKeys(tokens.member, '?includeVehicles=false')).toEqual([
      'piece_chest@0:shared',
      'piece_chest@1:shared',
    ]);
    const cart = await keyOf(OWNER_PID, 'Cart');
    const q = '?includeVehicles=false';
    expect(
      (await get(`${base(server)}/containers/${cart}${q}`, tokens.member))
        .status,
    ).toBe(404);
    expect(
      (await get(`${base(server)}/containers/${cart}`, tokens.member)).status,
    ).toBe(200);
    expect(
      (await get(`${base(server)}/materials?includeVehicles=0`, tokens.member))
        .status,
    ).toBe(400);
  });
});
