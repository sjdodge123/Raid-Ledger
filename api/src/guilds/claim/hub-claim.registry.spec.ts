/**
 * ROK-2153 review m4 — two live providers on one hub serve none (404) on
 * every request, but the misconfiguration is logged once per
 * (hub kind, provider set), not once per request.
 */
import { Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { createDrizzleMock } from '../../common/testing/drizzle-mock';
import type * as schema from '../../drizzle/schema';
import {
  EXTENSION_POINTS,
  type HubClaimHubRef,
  type HubClaimProvider,
} from '../../plugins/plugin-host/extension-points';
import { PluginRegistryService } from '../../plugins/plugin-host/plugin-registry.service';
import { HubClaimRegistry } from './hub-claim.registry';

function provider(pluginSlug: string): HubClaimProvider {
  return {
    pluginSlug,
    supports: () => true,
    status: () => Promise.reject(new Error('unused')),
    claim: () => Promise.reject(new Error('unused')),
  };
}

/**
 * Builds the registry the way boot does: providers register through the
 * plugin host, and the host's active-plugin cache is loaded from `plugins`
 * rows by its real `onModuleInit`. `getAdapter` hides an adapter whose owner
 * is not active, so a harness that skips this step serves no provider at all.
 */
async function registryWith(
  providers: HubClaimProvider[],
): Promise<HubClaimRegistry> {
  const mock = createDrizzleMock();
  mock.from.mockResolvedValueOnce(
    providers.map((p) => ({ slug: p.pluginSlug, active: true })),
  );
  const db: unknown = mock;
  const plugins = new PluginRegistryService(
    db as PostgresJsDatabase<typeof schema>,
    new EventEmitter2(),
  );
  await plugins.onModuleInit();
  for (const p of providers) {
    plugins.registerAdapter(
      EXTENSION_POINTS.HUB_CLAIM_PROVIDER,
      p.pluginSlug,
      p,
      { ownerPluginId: p.pluginSlug },
    );
  }
  return new HubClaimRegistry(plugins);
}

function hub(id: number, kind: HubClaimHubRef['kind']): HubClaimHubRef {
  return { id, kind, gameSlug: null, gameIgdbId: null };
}

describe('HubClaimRegistry.forHub — provider conflict', () => {
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    errorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
  });

  afterEach(() => errorSpy.mockRestore());

  it('serves the single live provider without logging', async () => {
    const only = provider('valheim');
    const reg = await registryWith([only]);
    expect(reg.forHub(hub(1, 'game_community'))).toBe(only);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('serves none on every request but logs once per kind + provider set', async () => {
    const reg = await registryWith([provider('a'), provider('b')]);
    for (let i = 0; i < 3; i += 1) {
      expect(reg.forHub(hub(10 + i, 'game_community'))).toBeUndefined();
    }
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(reg.forHub(hub(20, 'wow_guild'))).toBeUndefined();
    expect(errorSpy).toHaveBeenCalledTimes(2);
  });
});
