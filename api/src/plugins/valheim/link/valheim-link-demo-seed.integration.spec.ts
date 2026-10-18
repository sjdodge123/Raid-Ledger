/**
 * ROK-1833 — POST /admin/test/valheim/link-fixture (integration, real DB).
 * The DEMO_MODE fixture the Valheim Link smoke + fleet plan seed: Pelican +
 * Valheim active, the slot's Valheim row + other-game row, reset to "no
 * token" on re-run, and `withToken` issuing a live token once.
 * (403 without DEMO_MODE is the shared DemoModeGuard's own spec.)
 * Token values are never put inside an `expect` — a failure would print them.
 */
import { eq } from 'drizzle-orm';
import { ValheimLinkTokenListResponseSchema } from '@raid-ledger/contract';
import { getTestApp, type TestApp } from '../../../common/testing/test-app';
import {
  loginAsAdmin,
  truncateAllTables,
} from '../../../common/testing/integration-helpers';
import { nonEmpty } from '../../../common/testing/narrow';
import * as schema from '../../../drizzle/schema';
import { SettingsService } from '../../../settings/settings.service';
import { PluginRegistryService } from '../../plugin-host/plugin-registry.service';
import { PELICAN_PLUGIN_ID } from '../../pelican/pelican.constants';
import { VALHEIM_GAME_SLUG, VALHEIM_PLUGIN_ID } from '../valheim.constants';
import type { ValheimLinkFixture } from './valheim-link-demo-seed.controller';
import { hashValheimLinkToken } from './valheim-link-token.helpers';

const ORIGINAL_DEMO_MODE = process.env.DEMO_MODE;
const ROUTE = '/admin/test/valheim/link-fixture';
const PLUGINS = [VALHEIM_PLUGIN_ID, PELICAN_PLUGIN_ID];

let testApp: TestApp;
let adminToken: string;

const registry = () => testApp.app.get(PluginRegistryService);
const auth = () => ({ Authorization: `Bearer ${adminToken}` });

async function enableDemoMode(): Promise<void> {
  process.env.DEMO_MODE = 'true';
  await testApp.app.get(SettingsService).setDemoMode(true);
}

async function insertValheimGame(): Promise<number> {
  const [row] = nonEmpty(
    await testApp.db
      .insert(schema.games)
      .values({ name: 'Valheim', slug: VALHEIM_GAME_SLUG })
      .returning({ id: schema.games.id }),
    'valheim game',
  );
  return row.id;
}

async function seed(body: object = {}): Promise<ValheimLinkFixture> {
  const res = await testApp.request.post(ROUTE).set(auth()).send(body);
  expect(res.status).toBe(200);
  return res.body as ValheimLinkFixture;
}

async function tokenRows(serverId: number) {
  return testApp.db
    .select()
    .from(schema.valheimLinkTokens)
    .where(eq(schema.valheimLinkTokens.pelicanServerId, serverId));
}

async function listTokens() {
  const res = await testApp.request
    .get('/admin/plugins/valheim/link-tokens')
    .set(auth());
  expect(res.status).toBe(200);
  return ValheimLinkTokenListResponseSchema.parse(res.body).data;
}

beforeAll(async () => {
  testApp = await getTestApp();
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
  await enableDemoMode();
});

afterEach(async () => {
  for (const slug of PLUGINS) {
    if (registry().isActive(slug)) await registry().deactivate(slug);
  }
  testApp.seed = await truncateAllTables(testApp.db);
  testApp.app.get(SettingsService).invalidateCache(true);
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
  await enableDemoMode();
});

afterAll(() => {
  if (ORIGINAL_DEMO_MODE === undefined) delete process.env.DEMO_MODE;
  else process.env.DEMO_MODE = ORIGINAL_DEMO_MODE;
});

describe('POST /admin/test/valheim/link-fixture (ROK-1833)', () => {
  it('404s when the env has no Valheim game', async () => {
    const res = await testApp.request.post(ROUTE).set(auth()).send({});
    expect(res.status).toBe(404);
  });

  it('400s on an out-of-range slot or a non-boolean withToken', async () => {
    await insertValheimGame();
    for (const body of [{ slot: 99 }, { slot: -1 }, { withToken: 'yes' }]) {
      const res = await testApp.request.post(ROUTE).set(auth()).send(body);
      expect(res.status).toBe(400);
    }
  });

  it('activates both plugins and seeds a Valheim row with no token', async () => {
    const gameId = await insertValheimGame();
    const seeded = await seed();
    expect(PLUGINS.map((p) => registry().isActive(p))).toEqual([true, true]);
    expect(seeded.serverId).toBe(String(seeded.valheimServerId));
    expect('token' in seeded).toBe(false);
    const [row] = await testApp.db
      .select()
      .from(schema.pelicanServers)
      .where(eq(schema.pelicanServers.id, seeded.valheimServerId));
    expect(row).toMatchObject({ name: 'Ashlands (demo)', gameId });
    const list = await listTokens();
    expect(list.map((s) => s.pelicanServerId)).toContain(
      seeded.valheimServerId,
    );
    expect(list.map((s) => s.pelicanServerId)).not.toContain(
      seeded.otherServerId,
    );
  });

  it('withToken stores the hash of the returned token; re-run resets it', async () => {
    await insertValheimGame();
    const seeded = await seed({ withToken: true });
    const token = seeded.token ?? '';
    const [stored] = await tokenRows(seeded.valheimServerId);
    const matches = stored?.tokenHash === hashValheimLinkToken(token);
    expect(matches).toBe(true);
    expect(stored?.revokedAt).toBeNull();
    const again = await seed({ slot: 0 });
    expect(again.valheimServerId).toBe(seeded.valheimServerId);
    expect(await tokenRows(seeded.valheimServerId)).toHaveLength(0);
  });

  it('gives each slot its own pair of rows', async () => {
    await insertValheimGame();
    const a = await seed({ slot: 0 });
    const b = await seed({ slot: 1 });
    const ids = new Set([
      a.valheimServerId,
      a.otherServerId,
      b.valheimServerId,
      b.otherServerId,
    ]);
    expect(ids.size).toBe(4);
  });
});
