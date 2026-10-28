/**
 * ROK-1860 — the Planner source picker, end to end on a real DB: `sources=`
 * on `/plan` and `/tree` (AC2/AC3, D4 silent fallback), the 400 (AC4), and
 * the catalogue's `sourceOptions` (AC5). Data comes from the DEMO_MODE
 * recipes fixture, which carries a second Bronze recipe (`Recipe_Bronze5`)
 * and a second charcoal-kiln Coal process (RoundLog, index 1).
 */
import {
  ValheimRecipeCatalogResponseSchema,
  ValheimRecipePlanResponseSchema,
  ValheimRecipeTreeResponseSchema,
  type ValheimPlanNode,
  type ValheimRecipePlanResponse,
} from '@raid-ledger/contract';
import { eq, sql } from 'drizzle-orm';
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
import { VALHEIM_GAME_SLUG, VALHEIM_PLUGIN_ID } from '../../valheim.constants';
import type { RecipesFixtureResponse } from '../valheim-armory-recipes-demo-seed.controller';
import {
  RECIPES_DEMO_ALL_KNOWN,
  RECIPES_DEMO_ALL_KNOWN_ITEMS,
} from '../valheim-armory-recipes-demo-seed.helpers';

const ORIGINAL_DEMO_MODE = process.env.DEMO_MODE;
const ROUTE = '/admin/test/valheim/recipes-fixture';
const PLUGINS = [VALHEIM_PLUGIN_ID, PELICAN_PLUGIN_ID];

let testApp: TestApp;
let adminToken: string;
let f: RecipesFixtureResponse;
let member: { Authorization: string };

const registry = () => testApp.app.get(PluginRegistryService);
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
const recipesUrl = (rest = '') =>
  `/plugins/valheim/armory/servers/${f.serverId}/recipes${rest}`;

async function seed(body: object = {}): Promise<void> {
  const res = await testApp.request
    .post(ROUTE)
    .set(bearer(adminToken))
    .send(body);
  expect(res.status).toBe(200);
  f = res.body as RecipesFixtureResponse;
  const token = await signTestAccessToken(testApp, {
    sub: f.memberUserId,
    username: `u${f.memberUserId}`,
    role: 'member',
  });
  member = bearer(token);
}

async function get(rest: string, status = 200): Promise<unknown> {
  const res = await testApp.request.get(recipesUrl(rest)).set(member);
  expect({ rest, status: res.status }).toEqual({ rest, status });
  return res.body as unknown;
}

async function plan(targets: string, sources?: string) {
  const qs = sources === undefined ? '' : `&sources=${sources}`;
  return ValheimRecipePlanResponseSchema.parse(
    await get(`/plan?targets=${targets}${qs}`),
  );
}

function nodeOf(body: { nodes: ValheimPlanNode[] }, prefab: string) {
  const n = body.nodes.find((x) => x.prefab === prefab);
  if (!n) throw new Error(`no ${prefab} node`);
  return n;
}

const viaOf = (body: { nodes: ValheimPlanNode[] }, prefab: string) => {
  const { via } = nodeOf(body, prefab);
  if (via.type === 'recipe') return `recipe:${via.recipeId}`;
  if (via.type === 'process') return `process:${via.processor}`;
  return via.type;
};

const prefabs = (body: { nodes: ValheimPlanNode[] }) =>
  [...new Set(body.nodes.map((n) => n.prefab))].sort();

function needOf(body: ValheimRecipePlanResponse, prefab: string): number {
  const line = body.shoppingList.find((l) => l.prefab === prefab);
  if (!line) throw new Error(`no ${prefab} shopping line`);
  return line.need;
}

beforeAll(async () => {
  testApp = await getTestApp();
});

beforeEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
  testApp.app.get(SettingsService).invalidateCache(true);
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
  process.env.DEMO_MODE = 'true';
  await testApp.app.get(SettingsService).setDemoMode(true);
  nonEmpty(
    await testApp.db
      .insert(schema.games)
      .values({ name: 'Valheim', slug: VALHEIM_GAME_SLUG })
      .returning({ id: schema.games.id }),
    'valheim game',
  );
});

afterEach(async () => {
  for (const slug of PLUGINS) {
    if (registry().isActive(slug)) await registry().deactivate(slug);
  }
});

afterAll(() => {
  if (ORIGINAL_DEMO_MODE === undefined) delete process.env.DEMO_MODE;
  else process.env.DEMO_MODE = ORIGINAL_DEMO_MODE;
});

describe('sources= on /plan and /tree (ROK-1860 AC2/AC3)', () => {
  beforeEach(() => seed());

  it('AC2: a recipe override changes via, children and the shopping list', async () => {
    const d9 = await plan('Bronze:1:1');
    const alt = await plan('Bronze:1:1', 'Bronze:r:Recipe_Bronze5');
    expect([viaOf(d9, 'Bronze'), viaOf(alt, 'Bronze')]).toEqual([
      'recipe:Recipe_Bronze',
      'recipe:Recipe_Bronze5',
    ]);
    expect(nodeOf(d9, 'Tin').quantity).toBe(1);
    expect(nodeOf(alt, 'Tin').quantity).toBe(3);
    expect(nodeOf(alt, 'Copper').quantity).toBe(8);
    expect(needOf(alt, 'TinOre')).toBe(3 * needOf(d9, 'TinOre'));
    expect(alt.shoppingList).not.toEqual(d9.shoppingList);
  });

  it('/tree honours the same override', async () => {
    const tree = (qs: string) =>
      get(`/Bronze/tree${qs}`).then((b) =>
        ValheimRecipeTreeResponseSchema.parse(b),
      );
    const d9 = await tree('');
    const alt = await tree('?sources=Bronze:r:Recipe_Bronze5');
    expect([viaOf(d9, 'Bronze'), viaOf(alt, 'Bronze')]).toEqual([
      'recipe:Recipe_Bronze',
      'recipe:Recipe_Bronze5',
    ]);
  });

  it('AC3: a process override (Coal:p:charcoal_kiln:1) swaps the kiln input', async () => {
    const d9 = await plan('Coal:1:1');
    const alt = await plan('Coal:1:1', 'Coal:p:charcoal_kiln:1');
    expect(viaOf(alt, 'Coal')).toBe('process:charcoal_kiln');
    expect({ d9: prefabs(d9), alt: prefabs(alt) }).toEqual({
      d9: ['Coal', 'Wood'],
      alt: ['Coal', 'RoundLog'],
    });
  });

  it('D4: a ref that is not a candidate falls back to D9 silently', async () => {
    const d9 = await plan('Bronze:1:1');
    for (const ref of ['Bronze:r:Recipe_Nope', 'Bronze:p:smelter:0']) {
      expect({ ref, body: await plan('Bronze:1:1', ref) }).toEqual({
        ref,
        body: d9,
      });
    }
  });

  it('AC4: malformed sources → 400 Invalid sources on both routes', async () => {
    for (const rest of [
      '/plan?targets=Bronze:1:1&sources=Bronze:x:Recipe_Bronze5',
      '/plan?targets=Bronze:1:1&sources=Bronze:p:smelter',
      '/Bronze/tree?sources=Bronze:r:Recipe$5',
    ]) {
      expect({ rest, body: await get(rest, 400) }).toEqual({
        rest,
        body: expect.objectContaining({ message: 'Invalid sources' }),
      });
    }
  });
});

describe('catalogue sourceOptions (ROK-1860 AC5)', () => {
  const catalogue = async () =>
    ValheimRecipeCatalogResponseSchema.parse(await get(''));

  it('multi-source items list their options, one default; others omit it', async () => {
    await seed();
    const { entries } = await catalogue();
    const optionsOf = (p: string) =>
      entries
        .find((e) => e.kind === 'item' && e.prefab === p)
        ?.sourceOptions?.map((o) => [o.ref, o.default]);
    expect(optionsOf('Bronze')).toEqual([
      [{ type: 'recipe', recipeId: 'Recipe_Bronze' }, true],
      [{ type: 'recipe', recipeId: 'Recipe_Bronze5' }, false],
    ]);
    expect(optionsOf('Coal')).toEqual([
      [{ type: 'process', processor: 'charcoal_kiln', index: 0 }, true],
      [{ type: 'process', processor: 'charcoal_kiln', index: 1 }, false],
    ]);
    expect(optionsOf('Club')).toBeUndefined();
    expect(entries.filter((e) => e.sourceOptions).map((e) => e.prefab)).toEqual(
      ['Bronze', 'Coal'],
    );
  });

  it("spoilers on ('early'): every Bronze source hidden → no options, no hidden ids", async () => {
    await seed({ spoilers: 'early' });
    const cat = await catalogue();
    expect(cat.spoilers).toBe('protected');
    expect(cat.entries.filter((e) => e.sourceOptions)).toEqual([]);
    const json = JSON.stringify(cat);
    for (const hidden of ['Recipe_Bronze5', 'RoundLog']) {
      expect({ hidden, found: json.includes(hidden) }).toEqual({
        hidden,
        found: false,
      });
    }
  });
});

describe('catalogue sourceOptions, partly hidden (ROK-1860 D6)', () => {
  const catalogue = async () =>
    ValheimRecipeCatalogResponseSchema.parse(await get(''));

  it('spoilers on, one Bronze source hidden: Bronze offers no options and the hidden recipe is never named', async () => {
    await seed();
    // R3: `Recipe_Bronze` is known by id; with `Bronze` itself unlisted, `Recipe_Bronze5` stays hidden.
    const knownRecipes = [
      ...RECIPES_DEMO_ALL_KNOWN.filter((p) => p !== 'Bronze'),
      'Recipe_Bronze',
    ];
    const P = schema.valheimProfiles;
    await testApp.db
      .update(P)
      .set({
        knownRecipes,
        knownItems: [...RECIPES_DEMO_ALL_KNOWN_ITEMS],
        importedAt: sql`now()`,
      })
      .where(eq(P.pelicanServerId, f.serverId));
    const cat = await catalogue();
    expect(cat.spoilers).toBe('protected');
    const bronze = cat.entries.find(
      (e) => e.kind === 'item' && e.prefab === 'Bronze',
    );
    expect({
      shown: bronze !== undefined,
      options: bronze?.sourceOptions,
    }).toEqual({
      shown: true,
      options: undefined,
    });
    expect(
      cat.entries.filter((e) => e.sourceOptions).map((e) => e.prefab),
    ).toEqual(['Coal']);
    expect(JSON.stringify(cat).includes('Recipe_Bronze5')).toBe(false);
  });
});
