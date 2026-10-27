/**
 * ROK-1956 L7 — `GET /companion/v1/config` against a real DB (spec §10
 * I-22, I-23). No production module registers a companion handler (D-4), so
 * this file registers one for `bg3-save` v1, owned by an active plugin.
 */
import type { Response } from 'supertest';
import {
  BG3_SAVE_CONTRACT_ID,
  COMPANION_CAPTURED_AT_MAX_FUTURE_MS,
  COMPANION_IMAGE_EDGE_MAX,
  COMPANION_MESSAGE_MAX_BYTES,
  COMPANION_WEBP_MAX_BYTES,
  CompanionConfigSchema,
  CompanionIngestErrorSchema,
  type CompanionConfig,
} from '@raid-ledger/contract';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import { truncateAllTables } from '../../common/testing/integration-helpers';
import { PluginRegistryService } from '../../plugins/plugin-host/plugin-registry.service';
import { PELICAN_PLUGIN_ID } from '../../plugins/pelican/pelican.constants';
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
import { CompanionConfigService } from './companion-config.service';

const CONFIG = '/companion/v1/config';
const OWNER = PELICAN_PLUGIN_ID;

let testApp: TestApp;

const handler: CompanionContractHandler = {
  contract: BG3_SAVE_CONTRACT_ID,
  versions: [1],
  cadence: { minIntervalSec: 300 },
  handle: () => Promise.resolve(),
};

beforeAll(async () => {
  testApp = await getTestApp();
  const registry = testApp.app.get(CompanionHandlerRegistry);
  // The registry is a singleton; never double-register in a shared app.
  if (!registry.list().some((l) => l.contract === BG3_SAVE_CONTRACT_ID)) {
    registry.register(OWNER, handler);
  }
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
    });
  });

  it('owner plugin off → bg3-save enabled:false', async () => {
    const headers = await deviceHeaders('ci-cfg-off');
    const plugins = testApp.app.get(PluginRegistryService);
    await plugins.deactivate(OWNER);
    try {
      const config = expectConfig(await getConfig(headers));
      expect(bg3Of(config)?.enabled).toBe(false);
    } finally {
      await plugins.activate(OWNER);
    }
  });

  it('no handler registered → bg3-save enabled:false with the default cadence', () => {
    const plugins = testApp.app.get(PluginRegistryService);
    const empty = new CompanionHandlerRegistry(plugins);
    const config = new CompanionConfigService(empty).build({
      userId: 1,
      via: 'device',
      deviceId: 1,
      tokenHash: 'h',
    });
    expect(bg3Of(config)).toMatchObject({
      enabled: false,
      cadence: { minIntervalSec: 120 },
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
