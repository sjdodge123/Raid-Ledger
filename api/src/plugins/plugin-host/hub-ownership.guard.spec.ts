/**
 * ROK-1969 A1–A4 — every hub behaviour on the api belongs to a plugin.
 *
 * A1/A2: the registry refuses an unowned hub adapter and reports an owner
 * with no manifest. A3: a source scan (comments stripped) checks every
 * `registerAdapter(EXTENSION_POINTS.<hub point>` call passes an owner, and
 * that each declared behaviour in `HUB_PLUGIN_MANIFESTS` still has a
 * registration. A4: Core can never be deactivated or uninstalled.
 */
import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  CORE_PLUGIN_ID,
  HUB_PLUGIN_MANIFESTS,
  type PluginHubManifest,
} from '@raid-ledger/contract';
import { createDrizzleMock } from '../../common/testing/drizzle-mock';
import { stripComments } from '../../common/testing/strip-comments';
import type * as schema from '../../drizzle/schema';
import { HubMediaDecoratorRegistry } from '../../hub-media/hub-media.decorators';
import type { HubMediaRow } from '../../drizzle/schema';
import { EXTENSION_POINTS } from './extension-points';
import { PluginRegistryService } from './plugin-registry.service';

const SRC = path.resolve(__dirname, '../..');
const HUB_POINT_NAMES = [
  'HUB_KIND',
  'EVENT_GUILD_TAGGER',
  'GAME_LOG_PARSER',
  'CRON_REGISTRAR',
] as const;
type HubPointName = (typeof HUB_POINT_NAMES)[number];

interface CallSite {
  file: string;
  point: HubPointName;
  text: string;
}

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

const SOURCES = walk(SRC).map((file) => ({
  file: path.relative(SRC, file),
  text: stripComments(fs.readFileSync(file, 'utf8')),
}));

/** Every `registerAdapter(EXTENSION_POINTS.<hub point>, …)` call, up to its `);`. */
function hubCallSites(): CallSite[] {
  const re = /registerAdapter\(\s*EXTENSION_POINTS\.(\w+)[\s\S]*?\);/g;
  return SOURCES.flatMap(({ file, text }) =>
    [...text.matchAll(re)].flatMap((m) => {
      const point = HUB_POINT_NAMES.find((p) => p === m[1]);
      return point ? [{ file, point, text: m[0] }] : [];
    }),
  );
}

/** Owned inline, or via a `const opts = { ownerPluginId: … }` in the same file. */
function passesOwner(site: CallSite): boolean {
  if (site.text.includes('ownerPluginId')) return true;
  const lastArg = /,\s*(\w+),?\s*\);$/.exec(site.text)?.[1];
  if (lastArg === undefined) return false;
  const source = SOURCES.find((s) => s.file === site.file)?.text ?? '';
  return new RegExp(`const ${lastArg} = \\{\\s*ownerPluginId`).test(source);
}

const KIND_TO_POINT: Record<string, HubPointName> = {
  'hub-kind': 'HUB_KIND',
  'log-parser': 'GAME_LOG_PARSER',
  'event-tagger': 'EVENT_GUILD_TAGGER',
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
    r.registerAdapter(EXTENSION_POINTS.HUB_KIND, 'x', {}, {
      ownerPluginId: 'nope',
    });
    expect(() => r.assertHubOwnersKnown()).toThrow(
      'Owner plugin "nope" has no registered manifest',
    );
  });

  it('accepts Core as an owner before its manifest is registered', () => {
    const r = registry();
    r.registerAdapter(EXTENSION_POINTS.HUB_KIND, 'x', {}, {
      ownerPluginId: CORE_PLUGIN_ID,
    });
    expect(() => r.assertHubOwnersKnown()).not.toThrow();
  });
});

describe('ROK-1969 A3 — declared ↔ registered (source scan)', () => {
  const sites = hubCallSites();

  it('finds the hub call sites (non-vacuous)', () => {
    expect(sites.length).toBeGreaterThanOrEqual(6);
  });

  it('every hub call site passes an owner plugin', () => {
    const unowned = sites.filter((s) => !passesOwner(s));
    expect(unowned.map((s) => `${s.file}: ${s.point}`)).toEqual([]);
  });

  it('every declared hub-kind / log-parser / event-tagger has a registration', () => {
    const missing: string[] = [];
    const all: [string, PluginHubManifest][] =
      Object.entries(HUB_PLUGIN_MANIFESTS);
    const behaviours = all.flatMap(([, h]) => h.behaviours);
    for (const [slug, hub] of all) {
      for (const b of hub.behaviours) {
        const point = KIND_TO_POINT[b.kind];
        if (point === undefined) continue;
        const declared = behaviours.filter((x) => x.kind === b.kind).length;
        const registered = sites.filter((s) => s.point === point).length;
        const named = SOURCES.some((s) => s.text.includes(`'${b.id}'`));
        if (registered < declared || !named) missing.push(`${slug}:${b.id}`);
      }
    }
    expect(missing).toEqual([]);
  });
});

describe('ROK-1969 A4 — Core is built in', () => {
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
