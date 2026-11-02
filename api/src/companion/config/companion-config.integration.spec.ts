/**
 * ROK-1956 L7 — `GET /companion/v1/config` against a real DB (spec §10
 * I-22, I-23). Since ROK-1957 the `bg3` plugin's real `Bg3SaveHandler` owns
 * `bg3-save` v1 in the shared AppModule (the registry refuses a second
 * owner), so this file shadows a stub with its own cadence onto that real
 * registration and activates its owner plugin, `bg3`.
 */
import type { Response } from 'supertest';
import {
  BG3_PLUGIN_ID,
  BG3_SAVE_CONTRACT_ID,
  COMPANION_CAPTURED_AT_MAX_FUTURE_MS,
  COMPANION_IMAGE_EDGE_MAX,
  COMPANION_MESSAGE_MAX_BYTES,
  COMPANION_WEBP_MAX_BYTES,
  CompanionConfigSchema,
  CompanionIngestErrorSchema,
  type CompanionConfig,
} from '@raid-ledger/contract';
import * as schema from '../../drizzle/schema';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import { truncateAllTables } from '../../common/testing/integration-helpers';
import { PluginRegistryService } from '../../plugins/plugin-host/plugin-registry.service';
import {
  bearer,
  expireLimiterWindows,
  linkDevice,
  makeUser,
  withEnv,
} from '../devices/testing/companion-link.helpers';
import {
  CompanionHandlerRegistry,
  type CompanionContractHandler,
} from '../ingest/companion-handler.registry';
import { shadowBg3SaveHandler } from '../ingest/testing/shadow-bg3-save-handler';
import { CompanionConfigOwners } from './companion-config-owners.service';
import { CompanionConfigService } from './companion-config.service';

const CONFIG = '/companion/v1/config';
const OWNER = BG3_PLUGIN_ID;
const PLUGIN_NAME = "Baldur's Gate 3";

let testApp: TestApp;
let restoreHandler: (() => void) | undefined;

const handler: CompanionContractHandler = {
  contract: BG3_SAVE_CONTRACT_ID,
  versions: [1],
  cadence: { minIntervalSec: 300 },
  handle: () => Promise.resolve(),
};

beforeAll(async () => {
  testApp = await getTestApp();
  restoreHandler = shadowBg3SaveHandler(testApp.app, handler);
  // The shadowed registration is the only bg3-save v1 owner, and it is OWNER.
  const owners = testApp.app
    .get(CompanionHandlerRegistry)
    .list()
    .filter((l) => l.contract === BG3_SAVE_CONTRACT_ID)
    .map((l) => l.ownerPluginId);
  expect(owners).toEqual([OWNER]);
});

afterAll(() => {
  restoreHandler?.();
});

beforeEach(async () => {
  expireLimiterWindows(testApp);
  const plugins = testApp.app.get(PluginRegistryService);
  await plugins.ensureInstalled(OWNER);
  await plugins.activate(OWNER);
});

afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
});

const getConfig = (headers: Record<string, string> = {}): Promise<Response> =>
  testApp.request.get(CONFIG).set(headers);

/** 200 + `no-store` + a body that parses `CompanionConfigSchema`. */
function expectConfig(res: Response): CompanionConfig {
  expect({ status: res.status, cache: res.headers['cache-control'] }).toEqual({
    status: 200,
    cache: 'no-store',
  });
  return CompanionConfigSchema.parse(res.body);
}

function expectUnauthorized(res: Response): void {
  expect(res.status).toBe(401);
  expect(CompanionIngestErrorSchema.parse(res.body).code).toBe('unauthorized');
}

/** A linked device's bearer headers for a fresh member. */
async function deviceHeaders(
  username: string,
): Promise<Record<string, string>> {
  const user = await makeUser(testApp, username);
  const { token } = await linkDevice(testApp, user.token);
  return bearer(token);
}

const bg3Of = (config: CompanionConfig) =>
  config.contracts?.find((c) => c.id === BG3_SAVE_CONTRACT_ID);

describe('I-22 anonymous', () => {
  it('→ configVersion + minAppVersion + limits only (no contracts, no rate)', async () => {
    const config = expectConfig(await getConfig());
    expect(Object.keys(config).sort()).toEqual([
      'configVersion',
      'limits',
      'minAppVersion',
    ]);
    expect(config.limits).toEqual({
      messageMaxBytes: COMPANION_MESSAGE_MAX_BYTES,
      webpMaxBytes: COMPANION_WEBP_MAX_BYTES,
      imageEdgeMax: COMPANION_IMAGE_EDGE_MAX,
      capturedAtMaxFutureMs: COMPANION_CAPTURED_AT_MAX_FUTURE_MS,
    });
  });

  it('minAppVersion follows COMPANION_MIN_APP_VERSION (advice only)', async () => {
    const config = await withEnv({ COMPANION_MIN_APP_VERSION: '2.1.0' }, () =>
      getConfig().then(expectConfig),
    );
    expect(config.minAppVersion).toBe('2.1.0');
  });
});

describe('I-23 authenticated callers', () => {
  it('a device token → rate + contracts; bg3-save enabled with the spec handler', async () => {
    const config = expectConfig(
      await getConfig(await deviceHeaders('ci-cfg-dev')),
    );
    expect(config.rate).toBeDefined();
    expect(bg3Of(config)).toEqual({
      id: BG3_SAVE_CONTRACT_ID,
      enabled: true,
      versions: [{ version: 1, status: 'current' }],
      maxBytes: expect.any(Number) as unknown,
      blobSlots: ['thumbnail'],
      cadence: { minIntervalSec: 300 },
      plugin: { id: OWNER, name: PLUGIN_NAME, state: 'active' },
      game: null,
    });
  });

  it('owner plugin off → bg3-save enabled:false', async () => {
    const headers = await deviceHeaders('ci-cfg-off');
    const plugins = testApp.app.get(PluginRegistryService);
    await plugins.deactivate(OWNER);
    try {
      const config = expectConfig(await getConfig(headers));
      expect(bg3Of(config)).toMatchObject({
        enabled: false,
        plugin: { id: OWNER, name: PLUGIN_NAME, state: 'inactive' },
      });
    } finally {
      await plugins.activate(OWNER);
    }
  });

  it('no handler registered → bg3-save enabled:false, default cadence, plugin + game null', async () => {
    const plugins = testApp.app.get(PluginRegistryService);
    const empty = new CompanionHandlerRegistry(plugins);
    const owners = testApp.app.get(CompanionConfigOwners);
    const config = await new CompanionConfigService(
      empty,
      undefined,
      owners,
    ).build({ userId: 1, via: 'device', deviceId: 1, tokenHash: 'h' });
    expect(bg3Of(config)).toMatchObject({
      enabled: false,
      cadence: { minIntervalSec: 120 },
      plugin: null,
      game: null,
    });
  });

  it('a session JWT → contracts listed; a device-only handler shows disabled', async () => {
    const user = await makeUser(testApp, 'ci-cfg-session');
    const config = expectConfig(await getConfig(bearer(user.token)));
    expect(bg3Of(config)?.enabled).toBe(false);
  });

  it('an invalid device bearer → 401 (no downgrade to anonymous)', async () => {
    expectUnauthorized(await getConfig(bearer('rlcd_not-a-real-token')));
  });

  it('a JWT-shaped garbage bearer → 401', async () => {
    const token = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOjF9.not-a-signature';
    expectUnauthorized(await getConfig(bearer(token)));
  });
});

describe('ROK-2067 plugin state', () => {
  it('owner uninstalled → plugin.state not_installed; reinstalled → active + enabled', async () => {
    const headers = await deviceHeaders('ci-cfg-uninst');
    const plugins = testApp.app.get(PluginRegistryService);
    await plugins.deactivate(OWNER);
    await plugins.uninstall(OWNER);
    const off = bg3Of(expectConfig(await getConfig(headers)));
    expect({ enabled: off?.enabled, plugin: off?.plugin }).toEqual({
      enabled: false,
      plugin: { id: OWNER, name: PLUGIN_NAME, state: 'not_installed' },
    });
    await plugins.ensureInstalled(OWNER);
    await plugins.activate(OWNER);
    const on = bg3Of(expectConfig(await getConfig(headers)));
    expect({ enabled: on?.enabled, state: on?.plugin?.state }).toEqual({
      enabled: true,
      state: 'active',
    });
  });
});

interface Bg3GameSeed {
  slug: string;
  coverUrl: string | null;
  itadBoxartUrl?: string;
  hubs: number;
}

/** Insert one `games` row per seed, plus `hubs` active community hubs each. */
async function seedBg3Games(seeds: Bg3GameSeed[]): Promise<void> {
  for (const seed of seeds) {
    const [game] = await testApp.db
      .insert(schema.games)
      .values({
        name: `Game ${seed.slug}`,
        slug: seed.slug,
        coverUrl: seed.coverUrl,
        itadBoxartUrl: seed.itadBoxartUrl ?? null,
      })
      .returning({ id: schema.games.id });
    if (!game) throw new Error(`seed game ${seed.slug} not inserted`);
    for (let i = 0; i < seed.hubs; i++) {
      const name = `Hub ${seed.slug} ${i}`;
      await testApp.db.insert(schema.guilds).values({
        gameId: game.id,
        kind: 'game_community',
        region: 'community',
        source: 'community',
        name,
        nameKey: name.toLowerCase(),
        status: 'active',
      });
    }
  }
}

describe('ROK-2067 D13 game', () => {
  it('no hubs → the hub-manifest primary (baldurs-gate-iii), cover = ITAD boxart when IGDB is null', async () => {
    await seedBg3Games([
      {
        slug: 'baldurs-gate-iii',
        coverUrl: null,
        itadBoxartUrl: 'https://itad.example/iii.jpg',
        hubs: 0,
      },
      {
        slug: 'baldurs-gate-3',
        coverUrl: 'https://igdb.example/3.jpg',
        hubs: 0,
      },
    ]);
    const config = expectConfig(
      await getConfig(await deviceHeaders('ci-cfg-g1')),
    );
    expect(bg3Of(config)?.game).toEqual({
      slug: 'baldurs-gate-iii',
      name: 'Game baldurs-gate-iii',
      coverUrl: 'https://itad.example/iii.jpg',
    });
  });

  it('most hubs wins; a coverless pick borrows the sibling cover, keeps its own name', async () => {
    await seedBg3Games([
      {
        slug: 'baldurs-gate-iii',
        coverUrl: 'https://igdb.example/iii.jpg',
        hubs: 1,
      },
      { slug: 'baldurs-gate-3', coverUrl: null, hubs: 2 },
    ]);
    const config = expectConfig(
      await getConfig(await deviceHeaders('ci-cfg-g2')),
    );
    expect(bg3Of(config)?.game).toEqual({
      slug: 'baldurs-gate-3',
      name: 'Game baldurs-gate-3',
      coverUrl: 'https://igdb.example/iii.jpg',
    });
  });
});
