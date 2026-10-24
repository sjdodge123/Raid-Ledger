/**
 * ROK-1948 — Planner spoiler protection: the catalogue, `/tree` and `/plan`
 * are built from a graph pruned to what ANY character on the server has
 * discovered (claimed or not), identical for every viewer. Setup mirrors
 * `valheim-recipes-discovery.integration.spec.ts`.
 */
import {
  ValheimCharacterMessageSchema,
  ValheimLinkMessageSchema,
  ValheimRecipeCatalogResponseSchema,
  ValheimRecipePlanResponseSchema,
  ValheimRecipeTreeResponseSchema,
} from '@raid-ledger/contract';
import { eq } from 'drizzle-orm';
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
import {
  bronzeRecipes,
  recipeEntry,
  recipeRes,
} from '../valheim-recipes.testing';

const PLUGINS = [PELICAN_PLUGIN_ID, VALHEIM_PLUGIN_ID];
/** AC1: the only discovery on the server. */
const BENCH_CLUB = ['piece_workbench', 'Club'];
/** Names nobody on a BENCH_CLUB server has found: never in any body. */
const HIDDEN = [
  'SwordBronze',
  'Recipe_Bronze',
  'forge',
  'Forge',
  'Copper',
  'Tin',
  'smelter',
  'charcoal_kiln',
  'Coal',
];
let testApp: TestApp;
let gameId: number;
let server: number;
let admin: string;
let ownerId: number;
let member: string;
let claimed: string;

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

const atBench = {
  station: 'piece_workbench',
  repairStation: 'piece_workbench',
};
/** The Bronze chain at the forge + Club and BronzeNails (needs Bronze) at the workbench. */
const recipes = () =>
  bronzeRecipes({
    recipes: [
      recipeEntry('Recipe_Bronze', 'Bronze', [
        recipeRes('Copper', 2),
        recipeRes('Tin', 1),
      ]),
      recipeEntry('Recipe_SwordBronze', 'SwordBronze', [
        recipeRes('Bronze', 8, 4),
        recipeRes('Wood', 2, 1),
      ]),
      recipeEntry('Recipe_Club', 'Club', [recipeRes('Wood', 6)], atBench),
      recipeEntry(
        'Recipe_BronzeNails',
        'BronzeNails',
        [recipeRes('Bronze', 1)],
        atBench,
      ),
    ],
  });

async function importRecipes(): Promise<void> {
  const msg = ValheimLinkMessageSchema.parse(recipes());
  await testApp.db
    .insert(schema.valheimLinkSnapshots)
    .values(valheimSnapshotRow(server, msg));
  await testApp.app.get(ValheimArmoryImportService).drainOnce();
}

interface Profile {
  recipes: string[];
  items?: string[];
  by?: number;
  importedAt?: Date;
}

/** One character on `server`; unclaimed unless `by` is set. */
async function addProfile(playerId: string, c: Profile): Promise<void> {
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
    capturedAt: new Date('2026-10-17T20:15:42Z'),
    equipment: ch.equipment,
    inventory: ch.inventory,
    skills: ch.skills,
    trophies: [],
    knownItems: c.items ?? [],
    knownRecipes: c.recipes,
    ...(c.importedAt ? { importedAt: c.importedAt } : {}),
    ...(c.by === undefined
      ? {}
      : {
          claimedBy: c.by,
          claimSource: 'auto' as const,
          claimedAt: new Date(),
        }),
  });
}

async function body(url: string, t: string, status = 200) {
  const res = await get(url, t);
  expect({ url, status: res.status }).toEqual({ url, status });
  return res.body as unknown;
}
const catalogue = async (t: string) =>
  ValheimRecipeCatalogResponseSchema.parse(await body(base(server), t));

/** Everything a viewer could read off the catalogue, minus per-viewer flags. */
async function shown(t: string) {
  const c = await catalogue(t);
  return {
    spoilers: c.spoilers,
    entries: c.entries.map((e) => ({ ...e, discovered: undefined })),
    stations: c.stations,
    ingredients: c.ingredients,
  };
}
const prefabs = async (t: string) =>
  (await catalogue(t)).entries.map((e) => e.prefab).sort();
const leaks = (json: unknown) =>
  HIDDEN.filter((name) => JSON.stringify(json).includes(name));

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
  member = await sign(await makeUser('member'));
  const claimer = await makeUser('claimer');
  claimed = await sign(claimer);
  await addProfile('1000000000000002', { recipes: [], by: claimer });
  await importRecipes();
});

afterEach(async () => {
  for (const slug of PLUGINS) {
    if (registry().isActive(slug)) await registry().deactivate(slug);
  }
  testApp.app.get(SettingsService).invalidateCache(true);
});

describe('Planner spoiler protection (ROK-1948)', () => {
  it('AC1: a Workbench + Club only server hides the forge chain for every viewer', async () => {
    await addProfile('1000000000000001', { recipes: BENCH_CLUB });
    const imp = await sign(ownerId, testApp.seed.adminUser.id);
    const views = [
      await shown(admin),
      await shown(member),
      await shown(claimed),
      await shown(imp),
    ];
    const [first] = nonEmpty(views, 'views');
    expect({
      spoilers: first.spoilers,
      prefabs: first.entries.map((e) => e.prefab).sort(),
      stations: first.stations.map((s) => s.prefab),
      sameForAll: views.every(
        (v) => JSON.stringify(v) === JSON.stringify(first),
      ),
    }).toEqual({
      spoilers: 'protected',
      prefabs: ['Club'],
      stations: ['piece_workbench'],
      sameForAll: true,
    });
  });

  it('AC1: /tree of a hidden item 404s like an unknown prefab; no body names it', async () => {
    await addProfile('1000000000000001', { recipes: BENCH_CLUB });
    const hidden = await body(`${base(server)}/SwordBronze/tree`, admin, 404);
    const missing = await body(`${base(server)}/NoSuchThing/tree`, admin, 404);
    const club = ValheimRecipeTreeResponseSchema.parse(
      await body(`${base(server)}/Club/tree`, admin),
    );
    expect({
      sameAsMissing:
        JSON.stringify(hidden).replace('SwordBronze', 'X') ===
        JSON.stringify(missing).replace('NoSuchThing', 'X'),
      treeSpoilers: club.spoilers,
      leaks: leaks([await body(base(server), admin), club, hidden]),
    }).toEqual({ sameAsMissing: true, treeSpoilers: 'protected', leaks: [] });
  });

  it('a plan drops hidden targets and ends a hidden ingredient in one generic leaf', async () => {
    await addProfile('1000000000000001', {
      recipes: [...BENCH_CLUB, 'BronzeNails'],
    });
    const raw = await body(
      `${base(server)}/plan?targets=SwordBronze:1:1,BronzeNails:1:1`,
      member,
    );
    const p = ValheimRecipePlanResponseSchema.parse(raw);
    const bronze = p.nodes.find((n) => n.prefab === 'Bronze');
    expect({
      spoilers: p.spoilers,
      targets: p.targets.map((t) => t.prefab),
      bronze: bronze && {
        via: bronze.via,
        alternatives: bronze.alternatives,
        crafts: bronze.crafts,
      },
      bronzeChildren: p.nodes.filter((n) => bronze && n.parentId === bronze.id)
        .length,
      shopping: p.shoppingList.map((s) => s.prefab),
      leaks: leaks(raw),
    }).toEqual({
      spoilers: 'protected',
      targets: ['BronzeNails'],
      bronze: { via: { type: 'undiscovered' }, alternatives: 0, crafts: 0 },
      bronzeChildren: 0,
      shopping: [],
      leaks: [],
    });
  });

  it('no usable list on the server (all empty): protection off, everything shows', async () => {
    await addProfile('1000000000000001', { recipes: [] });
    const c = await catalogue(member);
    expect({
      spoilers: c.spoilers,
      sword: c.entries.some((e) => e.prefab === 'SwordBronze'),
      stations: c.stations.map((s) => s.prefab).sort(),
    }).toEqual({
      spoilers: 'off-no-data',
      sword: true,
      stations: ['forge', 'piece_workbench'],
    });
  });

  it('an old-mod (token-only) server falls back to everything', async () => {
    await addProfile('1000000000000001', {
      recipes: ['_item_club', '_piece_workbench'],
    });
    const c = await catalogue(admin);
    expect({
      spoilers: c.spoilers,
      sword: c.entries.some((e) => e.prefab === 'SwordBronze'),
    }).toEqual({ spoilers: 'off-no-data', sword: true });
  });

  it('a mixed server uses the usable lists only', async () => {
    await addProfile('1000000000000001', { recipes: ['_item_sword_bronze'] });
    await addProfile('1000000000000003', { recipes: BENCH_CLUB });
    expect({
      spoilers: (await catalogue(admin)).spoilers,
      prefabs: await prefabs(admin),
    }).toEqual({ spoilers: 'protected', prefabs: ['Club'] });
  });

  it(`a list at the store cap (${ARMORY_KNOWN_LIST_MAX}) turns protection off`, async () => {
    const capped = Array.from(
      { length: ARMORY_KNOWN_LIST_MAX },
      (_, i) => `Recipe_${i}`,
    );
    await addProfile('1000000000000001', { recipes: capped });
    await addProfile('1000000000000003', { recipes: BENCH_CLUB });
    const c = await catalogue(admin);
    expect({
      spoilers: c.spoilers,
      sword: c.entries.some((e) => e.prefab === 'SwordBronze'),
    }).toEqual({ spoilers: 'off-truncated', sword: true });
  });

  it('a re-import (imported_at bump) that discovers the forge chain moves the cache key', async () => {
    await addProfile('1000000000000001', { recipes: BENCH_CLUB });
    const before = await prefabs(admin);
    await testApp.db
      .update(schema.valheimProfiles)
      .set({
        knownRecipes: [...BENCH_CLUB, 'forge', 'Recipe_Bronze', 'SwordBronze'],
        importedAt: new Date(Date.now() + 60_000),
      })
      .where(eq(schema.valheimProfiles.playerId, '1000000000000001'));
    expect({ before, after: await prefabs(admin) }).toEqual({
      before: ['Club'],
      after: ['Bronze', 'Club', 'SwordBronze'],
    });
  });
});
