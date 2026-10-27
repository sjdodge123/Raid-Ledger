/**
 * ROK-1969 A1–A4 — every hub behaviour on the api belongs to a plugin.
 *
 * A1/A2: the registry refuses an unowned hub adapter and reports an owner
 * with no manifest. A3: a source scan (comments stripped) resolves every
 * live hub registration (hub points, plugin `@Cron`s, media decorators) to
 * `owner/kind/id` and requires it to equal `HUB_PLUGIN_MANIFESTS` exactly,
 * both ways (`common/testing/hub-registration-scan.ts`). A4: Core can never be deactivated or uninstalled.
 */
import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { CORE_PLUGIN_ID, HUB_PLUGIN_MANIFESTS } from '@raid-ledger/contract';
import { createDrizzleMock } from '../../common/testing/drizzle-mock';
import { stripComments } from '../../common/testing/strip-comments';
import type * as schema from '../../drizzle/schema';
import { HubMediaDecoratorRegistry } from '../../hub-media/hub-media.decorators';
import type { HubMediaRow } from '../../drizzle/schema';
import {
  EVENT_GUILD_TAGGER_KEY,
  EXTENSION_POINTS,
  HUB_EXTENSION_POINTS,
} from './extension-points';
import {
  HUB_POINT_KINDS,
  ownershipDrift,
  scanHubRegistrations,
  type ScanContext,
  type ScanSource,
} from '../../common/testing/hub-registration-scan';
import {
  VALHEIM_GAME_SLUG,
  VALHEIM_PLUGIN_ID,
} from '../valheim/valheim.constants';
import { PELICAN_PLUGIN_ID } from '../pelican/pelican.constants';
import { WOW_COMMON_MANIFEST } from '../wow-common/manifest';
import { CORE_MANIFEST } from '../core/core.manifest';
import { VALHEIM_MANIFEST } from '../valheim/valheim.manifest';
import { PELICAN_MANIFEST } from '../pelican/pelican.manifest';
import { PluginRegistryService } from './plugin-registry.service';

const SRC = path.resolve(__dirname, '../..');
const HUB_POINT_NAMES = [
  'HUB_KIND',
  'EVENT_GUILD_TAGGER',
  'GAME_LOG_PARSER',
  'CRON_REGISTRAR',
] as const;

function registry(): PluginRegistryService {
  const db: unknown = createDrizzleMock();
  return new PluginRegistryService(
    db as PostgresJsDatabase<typeof schema>,
    new EventEmitter2(),
  );
}

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const full = path.join(dir, d.name);
    if (d.isDirectory()) return walk(full);
    const isSource = d.name.endsWith('.ts') && !d.name.endsWith('.spec.ts');
    return isSource ? [full] : [];
  });
}

const SOURCES: ScanSource[] = walk(SRC).map((file) => ({
  file: path.relative(SRC, file),
  text: stripComments(fs.readFileSync(file, 'utf8')),
}));

/** The real constants a registration may name, and the owner of each plugin folder's bare crons. */
const CTX: ScanContext = {
  constants: {
    CORE_PLUGIN_ID,
    VALHEIM_PLUGIN_ID,
    VALHEIM_GAME_SLUG,
    PELICAN_PLUGIN_ID,
    EVENT_GUILD_TAGGER_KEY,
    'WOW_COMMON_MANIFEST.id': WOW_COMMON_MANIFEST.id,
  },
  folderOwners: {
    core: CORE_PLUGIN_ID,
    valheim: VALHEIM_PLUGIN_ID,
    pelican: PELICAN_PLUGIN_ID,
    'wow-common': WOW_COMMON_MANIFEST.id,
  },
};

describe('ROK-1969 A1 — an unowned hub adapter is refused', () => {
  it.each(HUB_POINT_NAMES)('%s without ownerPluginId throws', (name) => {
    const point: string = EXTENSION_POINTS[name];
    expect(() => registry().registerAdapter(point, 'x', {})).toThrow(
      `Hub extension point "${point}" needs an owner plugin`,
    );
  });

  it('a non-hub point still registers without an owner', () => {
    const r = registry();
    r.registerAdapter(EXTENSION_POINTS.AUTH_PROVIDER, 'discord', { a: 1 });
    expect(r.getAdapter(EXTENSION_POINTS.AUTH_PROVIDER, 'discord')).toEqual({
      a: 1,
    });
  });
});

describe('ROK-1969 A2 — the owner must have a manifest', () => {
  it('reports an owner plugin with no registered manifest', () => {
    const r = registry();
    r.registerAdapter(
      EXTENSION_POINTS.HUB_KIND,
      'x',
      {},
      {
        ownerPluginId: 'nope',
      },
    );
    expect(() => r.assertHubOwnersKnown()).toThrow(
      'Owner plugin "nope" has no registered manifest',
    );
  });

  it('accepts Core as an owner before its manifest is registered', () => {
    const r = registry();
    r.registerAdapter(
      EXTENSION_POINTS.HUB_KIND,
      'x',
      {},
      {
        ownerPluginId: CORE_PLUGIN_ID,
      },
    );
    expect(() => r.assertHubOwnersKnown()).not.toThrow();
  });
});

describe('ROK-1969 A3 — declared ↔ registered, exact (source scan)', () => {
  const live = scanHubRegistrations(SOURCES, CTX);

  it('maps every hub extension point to a behaviour kind', () => {
    const hubNames = Object.entries(EXTENSION_POINTS)
      .filter(([, v]) => HUB_EXTENSION_POINTS.some((p) => p === v))
      .map(([k]) => k);
    expect(hubNames.filter((n) => !(n in HUB_POINT_KINDS))).toEqual([]);
    expect([...HUB_POINT_NAMES].sort()).toEqual(hubNames.sort());
  });

  it('resolves every live registration (non-vacuous)', () => {
    expect(live.problems).toEqual([]);
    expect(live.keys).toEqual(
      expect.arrayContaining([
        'core/hub-kind/game_community',
        'core/event-tagger/event-guild-tagger',
        'valheim/log-parser/valheim',
        'valheim/scheduled-job/ValheimClaimSuggestCron_scan',
        'pelican/hub-kind/game_server',
        'blizzard/hub-kind/wow_guild',
      ]),
    );
  });

  it('every registration is declared under its owner, and every declaration is registered', () => {
    expect(ownershipDrift(live.keys, HUB_PLUGIN_MANIFESTS)).toEqual([]);
  });
});

describe('ROK-1969 A3 — mutation probes (each must go red)', () => {
  it('fails on a new undeclared hub kind AND a new undeclared plugin cron', () => {
    const extra: ScanSource[] = [
      {
        file: 'plugins/bg3/bg3-adapters.ts',
        text: "this.r.registerAdapter(EXTENSION_POINTS.HUB_KIND, 'bg3_party', this.a, { ownerPluginId: 'bg3' });",
      },
      {
        file: 'plugins/valheim/x.cron.ts',
        text: "const JOB_NAME = 'ValheimStray_tick';\n@Cron('* * * * *', { name: JOB_NAME })",
      },
    ];
    const keys = scanHubRegistrations([...SOURCES, ...extra], CTX).keys;
    expect(ownershipDrift(keys, HUB_PLUGIN_MANIFESTS)).toEqual([
      'bg3/hub-kind/bg3_party is registered but not declared in HUB_PLUGIN_MANIFESTS',
      'valheim/scheduled-job/ValheimStray_tick is registered but not declared in HUB_PLUGIN_MANIFESTS',
    ]);
  });

  it('fails on a declaration whose registration is gone, and on a media decorator nobody declared', () => {
    const noTagger = SOURCES.filter(
      (s) => s.file !== 'guilds/guilds-core.module.ts',
    );
    const decorator: ScanSource = {
      file: 'plugins/valheim/map-link.ts',
      text: 'HubMediaDecoratorRegistry; this.d.register(VALHEIM_PLUGIN_ID, fn);',
    };
    const keys = scanHubRegistrations([...noTagger, decorator], CTX).keys;
    expect(ownershipDrift(keys, HUB_PLUGIN_MANIFESTS)).toEqual([
      'valheim/media-decorator/#1 is registered but not declared in HUB_PLUGIN_MANIFESTS',
      'core/hub-kind/game_community is declared but nothing registers it',
      'core/event-tagger/event-guild-tagger is declared but nothing registers it',
    ]);
  });

  it('reports an unowned or unresolvable registration instead of skipping it', () => {
    const bad: ScanSource = {
      file: 'plugins/x/x.ts',
      text: 'this.r.registerAdapter(EXTENSION_POINTS.GAME_LOG_PARSER, SOME_SLUG, p);',
    };
    expect(scanHubRegistrations([bad], CTX).problems).toEqual([
      'plugins/x/x.ts: GAME_LOG_PARSER registration — cannot resolve key "SOME_SLUG" / owner "(none)"',
    ]);
  });
});

describe('ROK-1969 A2 — every live owner is a real plugin manifest', () => {
  const manifestIds = [
    CORE_MANIFEST.id,
    VALHEIM_MANIFEST.id,
    PELICAN_MANIFEST.id,
    WOW_COMMON_MANIFEST.id,
  ];

  it('every HUB_PLUGIN_MANIFESTS key is an api manifest id', () => {
    expect(Object.keys(HUB_PLUGIN_MANIFESTS).sort()).toEqual(
      [...manifestIds].sort(),
    );
  });

  it('a mistyped owner fails the scan (undeclared) — not just a boot log', () => {
    const typo: ScanSource = {
      file: 'plugins/valheim/typo.ts',
      text: "this.r.registerAdapter(EXTENSION_POINTS.HUB_KIND, 'game_server', a, { ownerPluginId: 'pelicn' });",
    };
    const keys = scanHubRegistrations([typo], CTX).keys;
    expect(keys).toEqual(['pelicn/hub-kind/game_server']);
    expect(ownershipDrift(keys, HUB_PLUGIN_MANIFESTS)).toContain(
      'pelicn/hub-kind/game_server is registered but not declared in HUB_PLUGIN_MANIFESTS',
    );
  });
});

describe('ROK-1969 A4 — Core is built in', () => {
  it('isActive follows manifest.builtIn, the same predicate the list uses', () => {
    const r = registry();
    r.registerManifest({ ...VALHEIM_MANIFEST, id: 'other', builtIn: true });
    expect(r.isActive('other')).toBe(true);
  });

  it('isActive("core") is true with an empty plugins table', () => {
    expect(registry().isActive(CORE_PLUGIN_ID)).toBe(true);
  });

  it('refuses to deactivate Core', async () => {
    await expect(registry().deactivate(CORE_PLUGIN_ID)).rejects.toThrow(
      'Plugin "core" is built in and cannot be deactivated',
    );
  });

  it('refuses to uninstall Core', async () => {
    await expect(registry().uninstall(CORE_PLUGIN_ID)).rejects.toThrow(
      'Plugin "core" is built in and cannot be uninstalled',
    );
  });
});

describe('ROK-1969 §4.4 — hub media decorators carry an owner', () => {
  it('skips a decorator whose owner plugin is inactive', () => {
    const decorators = new HubMediaDecoratorRegistry(registry());
    const link = { label: 'Show on map', href: '/x' };
    const row: unknown = { id: 1 };
    decorators.register('valheim', () => link);
    expect(decorators.linkFor(row as HubMediaRow)).toBeNull();
    decorators.register(CORE_PLUGIN_ID, () => link);
    expect(decorators.linkFor(row as HubMediaRow)).toEqual(link);
  });
});
