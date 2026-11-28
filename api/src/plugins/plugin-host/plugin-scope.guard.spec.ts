/**
 * ROK-2365 — a deactivated plugin's routes and handlers must not run.
 *
 * Every `@Controller` under `api/src/plugins/<x>/` (x not core/plugin-host)
 * sits behind `@RequirePlugin` + `PluginActiveGuard`, and every `@OnEvent` /
 * `@Processor` / Discord interaction or message handler there contains an
 * active check or the `// plugin-scope: cleanup` marker — or is allowlisted
 * below with a reason from the fixed set (`SCOPE_REASON`). A `gap:` entry is
 * a real gap awaiting its own story; never add one to make this pass.
 * Scanner: `common/testing/hub-registration-scan.scope.ts` + `.handlers.ts`.
 */
import * as fs from 'fs';
import * as path from 'path';
import { stripComments } from '../../common/testing/strip-comments';
import type { ScanSource } from '../../common/testing/hub-registration-scan';
import {
  controllerScopeViolations,
  scopedControllers,
  type ScopeAllowlist,
} from '../../common/testing/hub-registration-scan.scope';
import {
  handlerScopeViolations,
  scopedHandlers,
} from '../../common/testing/hub-registration-scan.handlers';

const SRC = path.resolve(__dirname, '../..');

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const full = path.join(dir, d.name);
    if (d.isDirectory()) return walk(full);
    const isSource = d.name.endsWith('.ts') && !d.name.endsWith('.spec.ts');
    return isSource ? [full] : [];
  });
}

const RAW: ScanSource[] = walk(SRC).map((file) => ({
  file: path.relative(SRC, file),
  text: fs.readFileSync(file, 'utf8'),
}));
const STRIPPED: ScanSource[] = RAW.map((s) => ({
  file: s.file,
  text: stripComments(s.text),
}));

const DEMO = 'demo-only';
const CONTROLLER_ALLOWLIST: ScopeAllowlist = {
  // Withdrawal: delete my data / remove my saves runs while bg3 is off (file header says so).
  'plugins/bg3/me-data/bg3-my-data.controller.ts#Bg3MyDataController':
    'cleanup',
  // Sign-in is core: Discord login/link stays up with the plugin off (operator ruling 2026-11-27).
  'plugins/discord/discord-auth.controller.ts#DiscordAuthController':
    'core-auth',
  // ROK-2371 D1a: completes a parked Google identity with a Discord sign-in — core sign-in too.
  'plugins/discord/discord-pending-link.controller.ts#DiscordPendingLinkController':
    'core-auth',
  // DEMO_MODE fixture seeders (each checks DEMO_MODE, JWT + admin).
  'plugins/pelican/pelican-demo-seed.controller.ts#PelicanDemoSeedController':
    DEMO,
  'plugins/valheim/armory/identity/valheim-claim-suggest-demo.controller.ts#ValheimClaimSuggestDemoController':
    DEMO,
  'plugins/valheim/armory/valheim-armory-containers-demo-seed.controller.ts#ValheimArmoryContainersDemoSeedController':
    DEMO,
  'plugins/valheim/armory/valheim-armory-demo-seed.controller.ts#ValheimArmoryDemoSeedController':
    DEMO,
  'plugins/valheim/armory/valheim-armory-map-demo-seed.controller.ts#ValheimArmoryMapDemoSeedController':
    DEMO,
  'plugins/valheim/armory/valheim-armory-recipes-demo-seed.controller.ts#ValheimArmoryRecipesDemoSeedController':
    DEMO,
  'plugins/valheim/armory/valheim-claim-drive-demo-seed.controller.ts#ValheimClaimDriveDemoSeedController':
    DEMO,
  'plugins/valheim/armory/valheim-deaths-demo-seed.controller.ts#ValheimDeathsDemoSeedController':
    DEMO,
  'plugins/valheim/link/valheim-link-demo-seed.controller.ts#ValheimLinkDemoSeedController':
    DEMO,
  // Companion bearer endpoints: valheim-link-token.guard.ts:62 → assertPluginsActive (:120).
  'plugins/valheim/link/blobs/valheim-link-blob.controller.ts#ValheimLinkBlobController':
    'own-guard: ValheimLinkBearerGuard',
  'plugins/valheim/link/ingest/valheim-link-ingest.controller.ts#ValheimLinkIngestController':
    'own-guard: ValheimLinkBearerGuard',
  // Signed-out visitor card: 404s (not a leaking 403) — guild-public-card.service.ts:69.
  'plugins/wow-common/guilds/public-card/public-guild-card.controller.ts#PublicGuildCardController':
    'service-checks-active',
};

/** Cache/token drops: state removal only, must run while off so reactivation is not stale. */
const CACHE_DROP = 'cleanup';
const HANDLER_ALLOWLIST: ScopeAllowlist = {
  // Keeps the core sign-in strategy current on a settings save (operator ruling 2026-11-27).
  'plugins/discord/discord-auth.strategy.ts#handleOAuthUpdate': 'core-auth',
  // reconcile → desired → enabledPanelUrl, pelican-presence.supervisor.ts:225.
  'plugins/pelican/presence/pelican-presence.supervisor.ts#handlePresenceConfigChanged':
    'service-checks-active',
  // Gateway-listener teardown on bot disconnect; the interaction handler itself checks isActive.
  'plugins/valheim/armory/identity/valheim-claim-suggest.listener.ts#onBotDisconnected':
    'cleanup',
  // Releases the claim-DM dedup key after a failed delivery; sends and writes nothing.
  'plugins/valheim/armory/identity/valheim-claim-suggest.service.ts#onDeliveryFailed':
    'cleanup',
  'plugins/wow-common/blizzard-auth.service.ts#handleBlizzardConfigUpdate':
    CACHE_DROP,
  'plugins/wow-common/dungeon-quests.service.ts#onForeverConfigUpdated':
    CACHE_DROP,
  'plugins/wow-common/forever-config.service.ts#handleConfigUpdated':
    'gap: re-points the Forever namespace prefix and purges realm state with no wow-common active check',
  // kick → startIfEmpty → tryStart → canRun, forever-quest-auto-import.service.ts:196.
  'plugins/wow-common/forever-quest-import/forever-quest-auto-import.service.ts#handleBlizzardKeysSaved':
    'service-checks-active',
  'plugins/wow-common/forever-quest-import/forever-quest-auto-import.service.ts#handleForeverConfigSaved':
    'service-checks-active',
  'plugins/wow-common/forever-ruleset-lookup.service.ts#clearCache': CACHE_DROP,
  'plugins/wow-common/forever-ruleset-lookup.service.ts#onForeverConfigUpdated':
    CACHE_DROP,
};

describe('ROK-2365 — plugin controllers sit behind the plugin-active guard', () => {
  it('scans every non-core plugin controller (non-vacuous)', () => {
    expect(scopedControllers(STRIPPED).length).toBeGreaterThanOrEqual(55);
  });

  it('every scoped controller is guarded or allowlisted with a fixed reason', () => {
    expect(controllerScopeViolations(STRIPPED, CONTROLLER_ALLOWLIST)).toEqual(
      [],
    );
  });
});

describe('ROK-2365 — plugin handlers check that their plugin is active', () => {
  it('scans every non-core plugin handler (non-vacuous)', () => {
    expect(scopedHandlers(RAW).length).toBeGreaterThanOrEqual(15);
  });

  it('every scoped handler is checked, marked cleanup, or allowlisted', () => {
    expect(handlerScopeViolations(RAW, HANDLER_ALLOWLIST)).toEqual([]);
  });
});
