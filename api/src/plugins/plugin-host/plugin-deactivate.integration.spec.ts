/**
 * ROK-2369 — a deactivated plugin does nothing (plugin-scoping audit, guards
 * gap item 6). The static guard (`plugin-scope.guard.spec.ts`) proves every
 * plugin controller and handler HAS an active check; this proves the checks
 * hold at runtime against a real DB. Everything is derived, never listed.
 * Scope is the scanner's: plugin code under `plugins/<folder>/` (minus core and
 * plugin-host). Plugin-owned behaviour elsewhere (e.g. the AI plugin's handlers
 * and crons, ROK-2354) is NOT exercised here.
 *
 * - routes: every route behind `@RequirePlugin` + `PluginActiveGuard` (Nest
 *   route metadata; must cover every controller the static scanner reads as
 *   guarded) → 403 `Plugin "<slug>" is not active`;
 * - handlers: every scoped `@OnEvent` / `@Processor` the scanner finds an
 *   active check in → fired with every non-built-in plugin off: it must
 *   CONSULT the gate (`isActive` / `getActiveSlugsSync`), must not crash on
 *   the probe (TypeError & co.), and must make no DB write and no
 *   fetch/enqueue/Discord call. Every scoped plugin `@Cron` → no effects;
 * - cron manager: each plugin's `CronRegistrar` jobs leave the scheduler;
 * - withdrawal cleanup (unlink, delete) still runs with the plugin off;
 * - the built-in Core plugin cannot be deactivated.
 */
import * as path from 'path';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SchedulerRegistry } from '@nestjs/schedule';
import { eq } from 'drizzle-orm';
import { BG3_SAVE_CONTRACT_ID } from '@raid-ledger/contract';
import * as schema from '../../drizzle/schema';
import {
  getTestApp,
  stopAllCronJobs,
  type TestApp,
} from '../../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../../common/testing/integration-helpers';
import {
  checkedHandlerTargets,
  cleanupHandlerKeys,
  loadRawSources,
  pluginRoutes,
  providerInstances,
  scopedCronTargets,
  staticGuardedControllers,
  type PluginRoute,
  type TargetInventory,
} from '../../common/testing/plugin-deactivate-inventory';
import {
  flushAsync,
  probeTarget,
  targetProblems,
} from '../../common/testing/plugin-deactivate-effects';
import type { ScanSource } from '../../common/testing/hub-registration-scan';
import { scopedHandlers } from '../../common/testing/hub-registration-scan.handlers';
import { STEAM_ACCOUNT_UNLINKED } from '../../steam/steam.constants';
import {
  PELICAN_PLUGIN_ID,
  PELICAN_SERVER_GAME_CHANGED,
} from '../pelican/pelican.constants';
import { VALHEIM_PLUGIN_ID } from '../valheim/valheim.constants';
import { BG3_PLUGIN_ID } from '../bg3/bg3.constants';
import { ValheimIdentityService } from '../valheim/armory/identity/valheim-identity.service';
import { ValheimLinkTokensRepository } from '../valheim/link/valheim-link-tokens.repository';
import { CLAIM_SUGGEST_TYPE } from '../valheim/armory/identity/valheim-claim-suggest.service';
import { claimSuggestKeys } from '../valheim/armory/identity/valheim-claim-suggest.copy';
import { NotificationDedupService } from '../../notifications/notification-dedup.service';
import { DISCORD_NOTIFICATION_FAILED } from '../../notifications/discord-notification.events';
import { EXTENSION_POINTS, type CronRegistrar } from './extension-points';
import { CronManagerService } from './cron-manager.service';
import { PluginRegistryService } from './plugin-registry.service';

/** ROK-2362: hub arrivals are probed like every other checked handler. */
const PRESENCE_HANDLER =
  'plugins/pelican/hub/server-hub-membership.service.ts#onPresenceChanged';

/** A probe payload: plausible ids, a slug no plugin owns. */
const PROBE = {
  slug: 'rok-2369-probe',
  userId: 0,
  serverId: 0,
  eventId: 0,
  id: 0,
  data: {},
};

describe('ROK-2369 — a deactivated plugin does nothing (integration)', () => {
  let testApp: TestApp;
  let adminToken: string;
  let registry: PluginRegistryService;
  let pluginSlugs: string[];
  let raw: ScanSource[];
  let instances: Map<string, object>;

  beforeAll(async () => {
    testApp = await getTestApp();
    adminToken = await loginAsAdmin(testApp.request, testApp.seed);
    registry = testApp.app.get(PluginRegistryService);
    pluginSlugs = (await registry.listPlugins())
      .filter((p) => !p.builtIn)
      .map((p) => p.slug);
    raw = loadRawSources(path.resolve(__dirname, '../..'));
    instances = providerInstances(testApp.app);
  });

  afterEach(async () => {
    await restoreAll();
    testApp.seed = await truncateAllTables(testApp.db);
    adminToken = await loginAsAdmin(testApp.request, testApp.seed);
  });

  /** Installed + active again (adapters restored, crons re-registered, stopped). */
  async function restoreAll(): Promise<void> {
    for (const slug of pluginSlugs) {
      await registry.ensureInstalled(slug);
      await registry.activate(slug);
    }
    stopAllCronJobs(testApp.app);
  }

  async function deactivate(slugs: readonly string[]): Promise<void> {
    for (const slug of slugs) {
      await registry.ensureInstalled(slug);
      await registry.activate(slug);
      await registry.deactivate(slug);
    }
    await flushAsync();
  }

  function send(route: PluginRoute) {
    const auth = `Bearer ${adminToken}`;
    return testApp.request[route.verb](route.path).set('Authorization', auth);
  }

  /**
   * Fire each target with every plugin off (PROBE, then PROBE with each real
   * slug until the gate is reached); name each problem.
   */
  async function problemsOf(
    inv: TargetInventory,
    requireGate: boolean,
  ): Promise<string[]> {
    await deactivate(pluginSlugs);
    const deps = { db: testApp.db, gate: registry };
    const payloads = [
      PROBE,
      ...pluginSlugs.map((slug) => ({ ...PROBE, slug })),
    ];
    const problems: string[] = [];
    for (const t of inv.targets) {
      const r = await probeTarget(t, deps, payloads);
      // A `callback` target only binds a gateway callback; the check runs in it.
      const gated = requireGate && t.gate === 'direct';
      problems.push(...targetProblems(r, { requireGate: gated }));
    }
    return problems;
  }

  it('derives a non-vacuous inventory from the app and the scanner', () => {
    expect(pluginSlugs.length).toBeGreaterThanOrEqual(5);
    expect(pluginSlugs).not.toContain('core');
    const routed = new Set(
      pluginRoutes(testApp.app).map((r) => r.key.split('.')[0]),
    );
    const guarded = staticGuardedControllers(raw);
    expect(guarded.length).toBeGreaterThanOrEqual(20);
    expect(guarded.filter((c) => !routed.has(c))).toEqual([]);
    // Census 2026-11-27: the scanner reads 18 scoped handlers — 4 with an
    // active check (handleLinked, onPresenceChanged (ROK-2362),
    // onBotConnected + its interactionCreate[0] callback), 3 cleanup-marked,
    // 11 allowlisted. Every checked one must resolve; the floors are on what
    // the scanner reads, not a guess.
    expect(scopedHandlers(raw).length).toBeGreaterThanOrEqual(15);
    const handlers = checkedHandlerTargets(raw, instances);
    expect(handlers.unresolved).toEqual([]);
    expect(handlers.targets.length).toBeGreaterThanOrEqual(3);
    const direct = handlers.targets.filter((t) => t.gate === 'direct');
    expect(direct.map((t) => t.key)).toEqual(
      expect.arrayContaining([PRESENCE_HANDLER]),
    );
    const crons = scopedCronTargets(raw, instances);
    expect(crons.unresolved).toEqual([]);
    expect(crons.targets.length).toBeGreaterThanOrEqual(4);
  });

  it('every plugin-guarded controller answers 403 while its plugin is off', async () => {
    const routes = pluginRoutes(testApp.app);
    const problems: string[] = [];
    for (const slug of [...new Set(routes.map((r) => r.slug))]) {
      await deactivate([slug]);
      for (const route of routes.filter((r) => r.slug === slug)) {
        const res = await send(route);
        const want = `Plugin "${slug}" is not active`;
        if (res.status !== 403 || res.body.message !== want) {
          problems.push(
            `${route.key} ${route.verb.toUpperCase()} ${route.path}: ${res.status} ${JSON.stringify(res.body.message)}`,
          );
        }
      }
      await restoreAll();
    }
    expect(problems).toEqual([]);
  });

  it('every active-checked plugin handler consults the gate and writes and sends nothing while off', async () => {
    const inv = checkedHandlerTargets(raw, instances);
    expect(inv.targets.length).toBeGreaterThan(0);
    expect(await problemsOf(inv, true)).toEqual([]);
  });

  it('every plugin @Cron writes and sends nothing while off', async () => {
    const inv = scopedCronTargets(raw, instances);
    expect(inv.targets.length).toBeGreaterThan(0);
    expect(await problemsOf(inv, false)).toEqual([]);
  });

  it('deactivating a plugin unregisters its CronRegistrar jobs', async () => {
    const scheduler = testApp.app.get(SchedulerRegistry);
    const crons = testApp.app.get(CronManagerService);
    const registrars = registry.getAdaptersForExtensionPoint<CronRegistrar>(
      EXTENSION_POINTS.CRON_REGISTRAR,
    );
    const owned = pluginSlugs.filter((s) => registrars.has(s));
    expect(owned.length).toBeGreaterThanOrEqual(1);
    const problems: string[] = [];
    for (const slug of owned) {
      crons.handlePluginActivated({ slug });
      stopAllCronJobs(testApp.app);
      const names = () => [...scheduler.getCronJobs().keys()];
      const mine = () => names().filter((n) => n.startsWith(`${slug}:`));
      if (mine().length === 0) problems.push(`${slug}: no jobs registered`);
      await deactivate([slug]);
      if (mine().length > 0) problems.push(`${slug}: ${mine().join(', ')}`);
      await restoreAll();
    }
    expect(problems).toEqual([]);
  });

  it('the built-in Core plugin cannot be deactivated', async () => {
    await registry.ensureInstalled('core');
    await expect(registry.deactivate('core')).rejects.toThrow(
      'Plugin "core" is built in and cannot be deactivated',
    );
    expect(registry.isActive('core')).toBe(true);
  });

  describe('withdrawal cleanup still runs while the plugin is off', () => {
    it('the scanner finds the cleanup-marked handlers', () => {
      expect(cleanupHandlerKeys(raw)).toEqual(
        expect.arrayContaining([
          'plugins/valheim/armory/identity/valheim-steam-link.listener.ts#handleUnlinked',
          'plugins/valheim/link/valheim-link-remap.listener.ts#handleGameChanged',
        ]),
      );
    });

    it('valheim: a Steam unlink still detaches auto claims', async () => {
      await deactivate([VALHEIM_PLUGIN_ID]);
      const identity = testApp.app.get(ValheimIdentityService, {
        strict: false,
      });
      const detach = jest
        .spyOn(identity, 'detachForUser')
        .mockResolvedValue(undefined);
      const attach = jest.spyOn(identity, 'attachForUser');
      try {
        const userId = testApp.seed.adminUser.id;
        const payload = { userId, steamId64: '76561198000000001' };
        await testApp.app
          .get(EventEmitter2)
          .emitAsync(STEAM_ACCOUNT_UNLINKED, payload);
        expect(detach).toHaveBeenCalledWith(userId, '76561198000000001');
        expect(attach).not.toHaveBeenCalled();
      } finally {
        detach.mockRestore();
        attach.mockRestore();
      }
    });

    it('valheim: a Pelican re-map still revokes the Valheim Link token', async () => {
      await deactivate([VALHEIM_PLUGIN_ID, PELICAN_PLUGIN_ID]);
      // ValheimLinkDemoSeedModule re-provides the repository, so the
      // listener's instance is not necessarily the one `app.get` returns.
      const revoke = jest
        .spyOn(ValheimLinkTokensRepository.prototype, 'revokeIfNotValheim')
        .mockResolvedValue(false);
      try {
        await testApp.app
          .get(EventEmitter2)
          .emitAsync(PELICAN_SERVER_GAME_CHANGED, { serverId: 4242 });
        expect(revoke).toHaveBeenCalledWith(4242);
      } finally {
        revoke.mockRestore();
      }
    });

    it('valheim: a failed claim DM still releases its pair key (ROK-2362)', async () => {
      await deactivate([VALHEIM_PLUGIN_ID]);
      const release = jest
        .spyOn(NotificationDedupService.prototype, 'releaseKey')
        .mockResolvedValue(undefined);
      try {
        const userId = testApp.seed.adminUser.id;
        await testApp.app
          .get(EventEmitter2)
          .emitAsync(DISCORD_NOTIFICATION_FAILED, {
            type: CLAIM_SUGGEST_TYPE,
            userId,
            payload: { profileId: 77 },
          });
        expect(release).toHaveBeenCalledWith(claimSuggestKeys.pair(77, userId));
      } finally {
        release.mockRestore();
      }
    });

    it('bg3: DELETE /plugins/bg3/me/data still deletes my data', async () => {
      const m = schema.companionIngestLatest;
      const userId = testApp.seed.adminUser.id;
      const marker = (contract: string) => ({
        userId,
        contract,
        latestKey: 'cd'.repeat(32),
        latestAt: new Date('2026-10-24T12:00:00Z'),
      });
      await testApp.db
        .insert(m)
        .values([marker(BG3_SAVE_CONTRACT_ID), marker('valheim-world')]);
      await deactivate([BG3_PLUGIN_ID]);
      const res = await testApp.request
        .delete('/plugins/bg3/me/data')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      const left = await testApp.db
        .select({ contract: m.contract })
        .from(m)
        .where(eq(m.userId, userId));
      expect(left).toEqual([{ contract: 'valheim-world' }]);
    });
  });
});
