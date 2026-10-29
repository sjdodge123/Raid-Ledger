/**
 * ROK-1862 §4 — "not yet discovered": the catalogue, `/tree` and `/plan`
 * carry `discovered` per entry/node and a response-level `discovery`, from
 * the `known_recipes` of the characters the VIEWER validly claims (same rule
 * as personal chests). Split from `valheim-recipes.integration.spec.ts`
 * (that file is at its size limit); setup mirrors it.
 */
import {
  ValheimCharacterMessageSchema,
  ValheimLinkMessageSchema,
  ValheimRecipeCatalogResponseSchema,
  ValheimRecipePlanResponseSchema,
  ValheimRecipeTreeResponseSchema,
  type ValheimPlanNode,
} from '@raid-ledger/contract';
import { signTestAccessToken } from '../../../../common/testing/sign-test-access-token';
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
import { ValheimArmoryImportService } from '../valheim-armory-import.service';
import { ensureFixtureHubId } from '../valheim-armory-map-hub.helpers';
import { ARMORY_KNOWN_LIST_MAX } from '../valheim-armory.mappers';
import { bronzeRecipes } from '../valheim-recipes.testing';

const PLUGINS = [PELICAN_PLUGIN_ID, VALHEIM_PLUGIN_ID];
/** Lacks the Bronze sword; knows Bronze (prefab form) and the chest piece. */
const KNOWN = ['Bronze', 'piece_chest'];
let testApp: TestApp;
let gameId: number;
let server: number;
let admin: string;
let ownerId: number;
let owner: string;
let member: string;

const registry = () => testApp.app.get(PluginRegistryService);
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const base = (s: number) => `/plugins/valheim/armory/servers/${s}/recipes`;
const get = (url: string, t: string) => testApp.request.get(url).set(auth(t));
const sign = (sub: number, impersonatedBy?: number) =>
  signTestAccessToken(testApp, {
    sub,
    username: `u${sub}`,
    ...(impersonatedBy === undefined ? {} : { impersonatedBy }),
  });

async function makeUser(username: string, steamId: string | null = null) {
  const [u] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({ discordId: `local:${username}`, username, steamId })
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

async function importRecipes(): Promise<void> {
  const msg = ValheimLinkMessageSchema.parse(bronzeRecipes());
  await testApp.db
    .insert(schema.valheimLinkSnapshots)
    .values(valheimSnapshotRow(server, msg));
  await testApp.app.get(ValheimArmoryImportService).drainOnce();
}

interface Claim {
  by: number;
  known: string[];
  source?: 'auto' | 'admin' | 'manual';
  steamId?: string;
}

/** One character on `server`, claimed per `c` (Steam id `S_<playerId>`). */
async function claimProfile(playerId: string, c: Claim): Promise<void> {
  const ch = ValheimCharacterMessageSchema.parse(
    loadValheimFixture('character-vanilla'),
  );
  await testApp.db.insert(schema.valheimProfiles).values({
    pelicanServerId: server,
    steamId: c.steamId ?? `S_${playerId}`,
    playerId,
    worldUid: '1234567890123',
    worldName: 'W',
    name: `c${playerId.slice(-2)}`,
    gameVersion: '0.220.5',
    modVersion: '1.0.0',
    capturedAt: new Date('2026-10-17T20:15:42Z'),
    equipment: ch.equipment,
    inventory: ch.inventory,
    skills: ch.skills,
    trophies: [],
    knownItems: [],
    knownRecipes: c.known,
    claimedBy: c.by,
    claimSource: c.source ?? 'auto',
    claimedAt: new Date(),
  });
}

/**
 * ROK-1948: an UNCLAIMED character who has found the whole fixture, so
 * server-wide spoiler protection hides nothing and these per-viewer flags
 * are read on the full catalogue (the union never reaches a viewer's flags).
 */
async function worldKnowsEverything(): Promise<void> {
  const ch = ValheimCharacterMessageSchema.parse(
    loadValheimFixture('character-vanilla'),
  );
  await testApp.db.insert(schema.valheimProfiles).values({
    pelicanServerId: server,
    steamId: 'S_WORLD',
    playerId: '1999999999999999',
    worldUid: '1234567890123',
    worldName: 'W',
    name: 'world',
    gameVersion: '0.220.5',
    modVersion: '1.0.0',
    capturedAt: new Date('2026-10-17T20:15:42Z'),
    equipment: ch.equipment,
    inventory: ch.inventory,
    skills: ch.skills,
    trophies: [],
    knownItems: ['CopperOre', 'TinOre', 'Wood'],
    knownRecipes: [
      'Recipe_Bronze',
      'Recipe_SwordBronze',
      'piece_chest',
      'piece_workbench',
      'forge',
      'smelter',
      'charcoal_kiln',
    ],
  });
}

async function catalogue(t: string) {
  const res = await get(base(server), t);
  expect({ status: res.status, body: res.body as unknown }).toMatchObject({
    status: 200,
  });
  return ValheimRecipeCatalogResponseSchema.parse(res.body);
}
async function tree(t: string) {
  const res = await get(`${base(server)}/SwordBronze/tree`, t);
  expect(res.status).toBe(200);
  return ValheimRecipeTreeResponseSchema.parse(res.body);
}
async function plan(t: string) {
  const res = await get(`${base(server)}/plan?targets=SwordBronze:1:1`, t);
  expect(res.status).toBe(200);
  return ValheimRecipePlanResponseSchema.parse(res.body);
}

/** prefab → `discovered` for every entry (the shape the assertions read). */
async function entryFlags(t: string) {
  const c = await catalogue(t);
  const flags = Object.fromEntries(
    c.entries.map((e) => [e.prefab, e.discovered]),
  );
  return { discovery: c.discovery, flags };
}
const nodeFlags = (nodes: readonly ValheimPlanNode[]) =>
  Object.fromEntries(nodes.map((n) => [n.prefab, n.discovered]));

/** Every route's status + whether any entry/node carries a non-null flag. */
async function allRoutes(t: string) {
  const [c, tr, p] = [await catalogue(t), await tree(t), await plan(t)];
  const flags = [
    ...c.entries.map((e) => e.discovered),
    ...tr.nodes.map((n) => n.discovered),
    ...p.nodes.map((n) => n.discovered),
  ];
  return {
    statuses: [c.discovery, tr.discovery, p.discovery],
    nonNull: flags.filter((f) => f !== null && f !== undefined),
  };
}
const UNKNOWN = (status: string) => ({
  statuses: [status, status, status],
  nonNull: [],
});

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
  await ensureFixtureHubId(testApp.db, server, gameId);
  admin = await loginAsAdmin(testApp.request, testApp.seed);
  ownerId = await makeUser('owner');
  owner = await sign(ownerId);
  member = await sign(await makeUser('member'));
  await importRecipes();
  await worldKnowsEverything();
});

afterEach(async () => {
  for (const slug of PLUGINS) {
    if (registry().isActive(slug)) await registry().deactivate(slug);
  }
  testApp.app.get(SettingsService).invalidateCache(true);
});

describe('recipe discovery (ROK-1862 §4)', () => {
  it('catalogue: undiscovered sword false, known item + piece true, process-only null', async () => {
    await claimProfile('1000000000000001', { by: ownerId, known: KNOWN });
    expect(await entryFlags(owner)).toMatchObject({
      discovery: 'known',
      flags: {
        SwordBronze: false,
        Bronze: true,
        piece_chest: true,
        Copper: null,
      },
    });
  });

  it('the Recipe_ id form counts as discovered', async () => {
    await claimProfile('1000000000000001', {
      by: ownerId,
      known: ['Recipe_SwordBronze'],
    });
    const { flags } = await entryFlags(owner);
    expect({ SwordBronze: flags.SwordBronze, Bronze: flags.Bronze }).toEqual({
      SwordBronze: true,
      Bronze: false,
    });
  });

  it('/tree and /plan nodes carry the same flags as the catalogue', async () => {
    await claimProfile('1000000000000001', { by: ownerId, known: KNOWN });
    const want = { SwordBronze: false, Bronze: true, Copper: null };
    const tr = await tree(owner);
    const p = await plan(owner);
    expect({
      discovery: tr.discovery,
      flags: nodeFlags(tr.nodes),
    }).toMatchObject({
      discovery: 'known',
      flags: want,
    });
    expect({ discovery: p.discovery, flags: nodeFlags(p.nodes) }).toMatchObject(
      {
        discovery: 'known',
        flags: want,
      },
    );
  });

  it('union of two claimed characters', async () => {
    await claimProfile('1000000000000001', { by: ownerId, known: ['Bronze'] });
    await claimProfile('1000000000000003', {
      by: ownerId,
      known: ['SwordBronze'],
    });
    const { flags } = await entryFlags(owner);
    expect({ SwordBronze: flags.SwordBronze, Bronze: flags.Bronze }).toEqual({
      SwordBronze: true,
      Bronze: true,
    });
  });

  it('a viewer with no claimed character: every flag null, no-character', async () => {
    await claimProfile('1000000000000001', { by: ownerId, known: KNOWN });
    expect(await allRoutes(member)).toEqual(UNKNOWN('no-character'));
  });

  it('privacy: an admin with no own claim never reads another member’s list', async () => {
    await claimProfile('1000000000000001', { by: ownerId, known: KNOWN });
    expect(await allRoutes(admin)).toEqual(UNKNOWN('no-character'));
  });

  it('privacy: a manual claim is honoured only with the viewer’s own Steam id', async () => {
    const match = await makeUser('match', 'S_1000000000000004');
    const wrong = await makeUser('wrong', 'S_SOMEONE_ELSE');
    await claimProfile('1000000000000004', {
      by: match,
      known: KNOWN,
      source: 'manual',
    });
    await claimProfile('1000000000000005', {
      by: wrong,
      known: KNOWN,
      source: 'manual',
    });
    const [ok, bad] = [await sign(match), await sign(wrong)];
    expect({
      match: (await entryFlags(ok)).discovery,
      mismatched: await allRoutes(bad),
    }).toEqual({ match: 'known', mismatched: UNKNOWN('no-character') });
  });

  it('privacy: a playerId under two Steam ids on the server counts for no one', async () => {
    const other = await makeUser('other');
    await claimProfile('1000000000000006', { by: ownerId, known: KNOWN });
    await claimProfile('1000000000000006', {
      by: other,
      known: KNOWN,
      steamId: 'S_IMPOSTOR',
    });
    expect({
      owner: await allRoutes(owner),
      other: await allRoutes(await sign(other)),
    }).toEqual({
      owner: UNKNOWN('no-character'),
      other: UNKNOWN('no-character'),
    });
  });

  it('an impersonated session reads no character (no-character)', async () => {
    await claimProfile('1000000000000001', { by: ownerId, known: KNOWN });
    const imp = await sign(ownerId, testApp.seed.adminUser.id);
    expect(await allRoutes(imp)).toEqual(UNKNOWN('no-character'));
  });

  it(`a list at the store cap (${ARMORY_KNOWN_LIST_MAX}) is truncated: every flag null`, async () => {
    const known = Array.from(
      { length: ARMORY_KNOWN_LIST_MAX },
      (_, i) => `Recipe_${i}`,
    );
    await claimProfile('1000000000000001', { by: ownerId, known });
    expect(await allRoutes(owner)).toEqual(UNKNOWN('truncated'));
  });

  it('a pre-0.4.2 token-only list is outdated: every flag null', async () => {
    await claimProfile('1000000000000001', {
      by: ownerId,
      known: ['_item_sword_bronze', '_piece_chest'],
    });
    expect(await allRoutes(owner)).toEqual(UNKNOWN('outdated'));
  });

  it('a mixed list is read from its prefab entries only', async () => {
    await claimProfile('1000000000000001', {
      by: ownerId,
      known: ['_item_sword_bronze', 'Bronze'],
    });
    const { discovery, flags } = await entryFlags(owner);
    expect({
      discovery,
      SwordBronze: flags.SwordBronze,
      Bronze: flags.Bronze,
    }).toEqual({
      discovery: 'known',
      SwordBronze: false,
      Bronze: true,
    });
  });
});
