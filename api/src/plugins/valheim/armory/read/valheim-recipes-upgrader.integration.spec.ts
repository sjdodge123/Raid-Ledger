/**
 * ROK-1861 — Valheim 1.0.20 upgrade stations planned as a build step. The
 * inline 1.0.20 fixture (`upgraderRecipeRows`) goes through the real
 * snapshot → importer path; `/tree` and `/plan` then carry per-quality
 * `via.steps` and the upgrader's piece cost in `stationBuilds`. ROK-1948:
 * an upgrader nobody on the server has discovered never appears.
 */
import {
  ValheimCharacterMessageSchema,
  ValheimLinkMessageSchema,
  ValheimRecipePlanResponseSchema,
  ValheimRecipeTreeResponseSchema,
  type ValheimPlanNode,
  type ValheimPlanStep,
} from '@raid-ledger/contract';
import { getTestApp, type TestApp } from '../../../../common/testing/test-app';
import { signTestAccessToken } from '../../../../common/testing/sign-test-access-token';
import { truncateAllTables } from '../../../../common/testing/integration-helpers';
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
import {
  UPGRADER_TEST_STATION,
  upgraderRecipeRows,
} from './valheim-recipes.upgrader.testing';

const PLUGINS = [PELICAN_PLUGIN_ID, VALHEIM_PLUGIN_ID];
const CHEST = 'ArmorBronzeChest';
const UPGRADER_BUILD = [
  { prefab: 'Stone', amount: 10 },
  { prefab: 'Bronze', amount: 2 },
];
let testApp: TestApp;
let server: number;
let member: string;

type Msg = Record<string, unknown>;
const registry = () => testApp.app.get(PluginRegistryService);
const base = () => `/plugins/valheim/armory/servers/${server}/recipes`;

function must<T>(v: T | undefined, label: string): T {
  if (v === undefined) throw new Error(`missing ${label}`);
  return v;
}

/** Store a message as ingest does, then drain it through the importer. */
async function importMsg(msg: Msg): Promise<void> {
  const row = valheimSnapshotRow(server, ValheimLinkMessageSchema.parse(msg));
  await testApp.db.insert(schema.valheimLinkSnapshots).values(row);
  await testApp.app.get(ValheimArmoryImportService).drainOnce();
}

/**
 * The inline 1.0.20 set as a wire `recipes` message. `upgradeOnly`: the
 * cuirass is made at no station and only UPGRADED at the upgrader.
 */
function recipesMsg(upgradeOnly = false): Msg {
  const rows = upgraderRecipeRows();
  return {
    ...loadValheimFixture('recipes-vanilla'),
    gameVersion: rows.gameVersion,
    stations: rows.stations,
    pieces: rows.pieces,
    processors: rows.processors,
    processes: rows.processes,
    recipes: rows.recipes.map((r) =>
      upgradeOnly && r.result === CHEST ? { ...r, station: null } : r,
    ),
  };
}

const ICON = { kind: 'atlas', x: 0, y: 0, w: 64, h: 64 };
const catItem = (prefab: string, maxQuality = 1) => ({
  prefab,
  name: `${prefab} name`,
  category: 'Material',
  maxStack: 50,
  maxQuality,
  variants: 0,
  icon: ICON,
});
/** Items catalogue: the cuirass reaches q4; Stone only the build needs. */
const catalogMsg = (): Msg => ({
  ...loadValheimFixture('items-atlas'),
  gameVersion: '1.0.20',
  items: [catItem(CHEST, 4), catItem('Bronze'), catItem('Stone')],
});

/** One unclaimed character whose `known_recipes` drive ROK-1948 protection. */
async function addProfile(knownRecipes: string[]): Promise<void> {
  const ch = ValheimCharacterMessageSchema.parse(
    loadValheimFixture('character-vanilla'),
  );
  await testApp.db.insert(schema.valheimProfiles).values({
    pelicanServerId: server,
    steamId: 'S_1000000000000001',
    playerId: '1000000000000001',
    worldUid: '1234567890123',
    worldName: 'W',
    name: 'c01',
    gameVersion: '1.0.20',
    modVersion: '1.0.0',
    capturedAt: new Date('2026-10-17T20:15:42Z'),
    equipment: ch.equipment,
    inventory: ch.inventory,
    skills: ch.skills,
    trophies: [],
    knownItems: [],
    knownRecipes,
  });
}

async function body(url: string) {
  const res = await testApp.request
    .get(url)
    .set({ Authorization: `Bearer ${member}` });
  expect({ url, status: res.status }).toEqual({ url, status: 200 });
  return res.body as unknown;
}
const tree = async (q: number) =>
  ValheimRecipeTreeResponseSchema.parse(
    await body(`${base()}/${CHEST}/tree?quality=${q}`),
  );
const plan = async (q: number) =>
  ValheimRecipePlanResponseSchema.parse(
    await body(`${base()}/plan?targets=${CHEST}:${q}:1`),
  );

function rootOf(nodes: ValheimPlanNode[]): ValheimPlanNode {
  return must(
    nodes.find((n) => n.parentId === null && n.prefab === CHEST),
    'cuirass root',
  );
}
const stepsOf = (n: ValheimPlanNode): ValheimPlanStep[] =>
  n.via.type === 'recipe' ? (n.via.steps ?? []) : [];
/** `q station lvl upgrader idol` per step. */
const stepRows = (n: ValheimPlanNode) =>
  stepsOf(n).map((s) => ({
    q: s.quality,
    station: s.station,
    level: s.stationLevel,
    upgrader: s.upgraderStation,
    idol: s.resources.find((r) => r.prefab === 'Upgrader1Armor')?.amount ?? 0,
  }));
const AT_UPGRADER = [1, 2, 3].map((q) => ({
  q,
  station: UPGRADER_TEST_STATION,
  level: q,
  upgrader: true,
  idol: q === 1 ? 0 : 1,
}));

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
  const [u] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({ discordId: 'local:member', username: 'member' })
      .returning({ id: schema.users.id }),
    'member',
  );
  member = await signTestAccessToken(testApp, {
    sub: u.id,
    username: 'member',
  });
  await importMsg(catalogMsg());
});

afterEach(async () => {
  for (const slug of PLUGINS) {
    if (registry().isActive(slug)) await registry().deactivate(slug);
  }
  testApp.app.get(SettingsService).invalidateCache(true);
});

describe('upgrade stations as a build step (ROK-1861)', () => {
  it('/tree q3: steps at the upgrader with levels; the idol on q2/q3 only; the build listed', async () => {
    await importMsg(recipesMsg());
    const t = await tree(3);
    expect({
      quality: t.target.quality,
      steps: stepRows(rootOf(t.nodes)),
      builds: t.stationBuilds,
      stone: t.items.Stone?.name,
    }).toEqual({
      quality: 3,
      steps: AT_UPGRADER,
      builds: { [UPGRADER_TEST_STATION]: UPGRADER_BUILD },
      stone: 'Stone name',
    });
  });

  it('/plan q3: same steps; the build is never netted into the shopping list', async () => {
    await importMsg(recipesMsg());
    const p = await plan(3);
    const need = Object.fromEntries(
      p.shoppingList.map((l) => [l.prefab, l.need]),
    );
    expect({
      steps: stepRows(rootOf(p.nodes)),
      builds: p.stationBuilds,
      stoneListed: 'Stone' in need,
      // Bronze 5 + 3 + 6 for the cuirass → Copper 2 each; the build's 2 Bronze add none.
      copper: need.Copper,
    }).toEqual({
      steps: AT_UPGRADER,
      builds: { [UPGRADER_TEST_STATION]: UPGRADER_BUILD },
      stoneListed: false,
      copper: 28,
    });
  });

  it('a q1 craft is a single step: no steps and no stationBuilds key', async () => {
    await importMsg(recipesMsg());
    const t = await tree(1);
    expect({
      via: rootOf(t.nodes).via,
      hasBuilds: 'stationBuilds' in t,
    }).toMatchObject({ via: { type: 'recipe' }, hasBuilds: false });
    expect(rootOf(t.nodes).via).not.toHaveProperty('steps');
  });
});

describe('an undiscovered upgrade station stays hidden (ROK-1948 ruling)', () => {
  const KNOWN = ['Recipe_ArmorBronzeChest', 'Recipe_Bronze', 'forge'];

  it('known recipe, upgrader undiscovered: nothing names it on /tree or /plan', async () => {
    await importMsg(recipesMsg(true));
    await addProfile(KNOWN);
    const t = await tree(3);
    const p = await plan(3);
    expect({
      spoilers: t.spoilers,
      treeSteps: stepRows(rootOf(t.nodes)),
      treeBuilds: 'stationBuilds' in t,
      planBuilds: 'stationBuilds' in p,
      leaks: [t, p].filter((b) =>
        JSON.stringify(b).includes(`"${UPGRADER_TEST_STATION}"`),
      ).length,
      stoneNamed: 'Stone' in t.items || 'Stone' in p.items,
    }).toEqual({
      spoilers: 'protected',
      treeSteps: [],
      treeBuilds: false,
      planBuilds: false,
      leaks: 0,
      stoneNamed: false,
    });
  });

  it('once someone discovers the upgrader, its steps and build appear', async () => {
    await importMsg(recipesMsg(true));
    await addProfile([...KNOWN, UPGRADER_TEST_STATION]);
    const t = await tree(3);
    expect({
      spoilers: t.spoilers,
      stations: stepRows(rootOf(t.nodes)).map((s) => s.station),
      builds: t.stationBuilds,
    }).toEqual({
      spoilers: 'protected',
      // q1 needs no station in this variant; q2/q3 upgrade at the upgrader.
      stations: [null, UPGRADER_TEST_STATION, UPGRADER_TEST_STATION],
      builds: { [UPGRADER_TEST_STATION]: UPGRADER_BUILD },
    });
  });
});
