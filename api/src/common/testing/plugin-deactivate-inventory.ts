/**
 * ROK-2369 — the inventory `plugin-deactivate.integration.spec.ts` drives, all
 * derived from the running app and the source tree (never a hand copy):
 *
 * - {@link pluginRoutes}: every route behind `@RequirePlugin` +
 *   `PluginActiveGuard` (class or method), read from Nest's own route
 *   metadata; {@link staticGuardedControllers} is the scanner's view of the
 *   same set, so the spec can tie the two together.
 * - {@link checkedHandlerTargets}: every scoped `@OnEvent` / `@Processor`
 *   handler the plugin-scope scanner (`hub-registration-scan.handlers.ts`)
 *   finds an active check in, resolved to its live provider instance.
 * - {@link scopedCronTargets}: every `@Cron` method in a scoped plugin folder.
 *
 * Discord gateway callbacks (`interactionCreate` / `messageCreate`) are not
 * resolvable to a method and are returned as `skipped`. Class and `@Cron`
 * scans read comment-stripped text, so a doc comment cannot mint a target.
 */
import * as fs from 'fs';
import * as path from 'path';
import { RequestMethod, type INestApplication } from '@nestjs/common';
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { ModulesContainer } from '@nestjs/core';
import {
  PLUGIN_SLUG_KEY,
  PluginActiveGuard,
} from '../../plugins/plugin-host/plugin-active.guard';
import type { ScanSource } from './hub-registration-scan';
import {
  CLEANUP_MARKER,
  isScopeChecked,
  scopedHandlers,
} from './hub-registration-scan.handlers';
import {
  isPluginGuarded,
  scopedControllers,
  scopedFolder,
} from './hub-registration-scan.scope';
import { stripComments } from './strip-comments';

/** Every non-spec `.ts` under `srcRoot`, raw, keyed by its relative path. */
export function loadRawSources(srcRoot: string): ScanSource[] {
  const walk = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
      const full = path.join(dir, d.name);
      if (d.isDirectory()) return walk(full);
      return d.name.endsWith('.ts') && !d.name.endsWith('.spec.ts')
        ? [full]
        : [];
    });
  return walk(srcRoot).map((file) => ({
    file: path.relative(srcRoot, file),
    text: fs.readFileSync(file, 'utf8'),
  }));
}

export type RouteVerb = 'get' | 'post' | 'put' | 'patch' | 'delete';

/** One plugin-guarded route: `Controller.method`, its plugin and URL. */
export interface PluginRoute {
  key: string;
  slug: string;
  verb: RouteVerb;
  path: string;
}

const VERBS: ReadonlyMap<number, RouteVerb> = new Map<number, RouteVerb>([
  [RequestMethod.GET, 'get'],
  [RequestMethod.POST, 'post'],
  [RequestMethod.PUT, 'put'],
  [RequestMethod.PATCH, 'patch'],
  [RequestMethod.DELETE, 'delete'],
]);

function meta(key: string, target: object): unknown {
  const value: unknown = Reflect.getMetadata(key, target);
  return value;
}

function firstPath(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return '';
}

/** `/base/sub` with every `:param` filled (guards run before pipes). */
function joinPath(base: string, sub: string): string {
  const joined = `/${base}/${sub}`.replace(/\/+/g, '/').replace(/(.)\/$/, '$1');
  return joined.replace(/:\w+\??/g, '1');
}

function hasPluginGuard(target: object): boolean {
  const guards = meta(GUARDS_METADATA, target);
  return Array.isArray(guards) && guards.includes(PluginActiveGuard);
}

function slugOf(target: object): string | undefined {
  const slug = meta(PLUGIN_SLUG_KEY, target);
  return typeof slug === 'string' ? slug : undefined;
}

/** Own prototype methods of a class: name + function. */
function protoMethods(cls: object): { name: string; fn: object }[] {
  const proto: unknown = Reflect.get(cls, 'prototype');
  if (typeof proto !== 'object' || proto === null) return [];
  return Object.getOwnPropertyNames(proto).flatMap((name) => {
    const fn: unknown = Reflect.get(proto, name);
    return name !== 'constructor' && typeof fn === 'function'
      ? [{ name, fn }]
      : [];
  });
}

/** Every route of `cls` behind the plugin-active guard. */
function guardedRoutes(cls: object): PluginRoute[] {
  const base = firstPath(meta(PATH_METADATA, cls));
  const clsName = String(Reflect.get(cls, 'name'));
  return protoMethods(cls).flatMap(({ name, fn }) => {
    const method = meta(METHOD_METADATA, fn);
    const verb = typeof method === 'number' ? VERBS.get(method) : undefined;
    const slug = slugOf(fn) ?? slugOf(cls);
    const guarded = hasPluginGuard(fn) || hasPluginGuard(cls);
    if (verb === undefined || slug === undefined || !guarded) return [];
    const sub = firstPath(meta(PATH_METADATA, fn));
    const key = `${clsName}.${name}`;
    return [{ key, slug, verb, path: joinPath(base, sub) }];
  });
}

/** Every plugin-guarded route of every controller registered in `app`. */
export function pluginRoutes(app: INestApplication): PluginRoute[] {
  const seen = new Set<object>();
  const out: PluginRoute[] = [];
  for (const mod of app.get(ModulesContainer).values()) {
    for (const wrapper of mod.controllers.values()) {
      const cls: unknown = wrapper.metatype;
      if (typeof cls !== 'function' || seen.has(cls)) continue;
      seen.add(cls);
      out.push(...guardedRoutes(cls));
    }
  }
  return out;
}

/**
 * Class names of the scoped controllers the static scanner reads as fully
 * plugin-guarded — each must show up among {@link pluginRoutes}' keys.
 */
export function staticGuardedControllers(raw: readonly ScanSource[]): string[] {
  const stripped = raw.map((s) => ({
    file: s.file,
    text: stripComments(s.text),
  }));
  return scopedControllers(stripped)
    .filter(isPluginGuarded)
    .map((c) => c.key.split('#')[1] ?? '');
}

/** Live provider instances by class name (first registration wins). */
export function providerInstances(app: INestApplication): Map<string, object> {
  const out = new Map<string, object>();
  for (const mod of app.get(ModulesContainer).values()) {
    for (const wrapper of mod.providers.values()) {
      const cls: unknown = wrapper.metatype;
      const inst: unknown = wrapper.instance;
      if (typeof cls !== 'function' || typeof inst !== 'object') continue;
      if (inst !== null && !out.has(cls.name)) out.set(cls.name, inst);
    }
  }
  return out;
}

/**
 * How a target reaches its active check: `direct` — when fired; `callback` —
 * it only attaches a Discord gateway callback, and the check runs inside that
 * callback (listed separately, as a `skipped` `#interactionCreate[n]` key).
 */
export type GateRoute = 'direct' | 'callback';

/** A handler resolved to the live instance it runs on. */
export interface HandlerTarget {
  key: string;
  instance: object;
  method: string;
  gate: GateRoute;
}

interface TargetEntry {
  key: string;
  classes: string[];
  method: string;
  gate: GateRoute;
}

/** A handler body that only binds a gateway callback (the check lives in it). */
const BINDS_GATEWAY = /\bgatewayBinding\s*\(|\.attachToClient\s*\(/;

export interface TargetInventory {
  targets: HandlerTarget[];
  unresolved: string[];
  skipped: string[];
}

function classesIn(text: string): string[] {
  return [...text.matchAll(/\bclass (\w+)/g)].map((m) => m[1] ?? '');
}

/** The first class in `classes` with a live instance owning `method`. */
function resolveTarget(
  e: TargetEntry,
  index: ReadonlyMap<string, object>,
): HandlerTarget | undefined {
  for (const cls of e.classes) {
    const instance = index.get(cls);
    if (instance === undefined) continue;
    if (typeof Reflect.get(instance, e.method) === 'function') {
      return { key: e.key, instance, method: e.method, gate: e.gate };
    }
  }
  return undefined;
}

function collect(
  entries: readonly TargetEntry[],
  index: ReadonlyMap<string, object>,
  skipped: string[],
): TargetInventory {
  const targets: HandlerTarget[] = [];
  const unresolved: string[] = [];
  for (const e of entries) {
    const t = resolveTarget(e, index);
    if (t === undefined) unresolved.push(e.key);
    else targets.push(t);
  }
  return { targets, unresolved, skipped };
}

/**
 * Scoped handlers the scanner finds an active check in (cleanup-marked ones
 * excluded: those must run while off), resolved to live instances.
 */
export function checkedHandlerTargets(
  raw: readonly ScanSource[],
  index: ReadonlyMap<string, object>,
): TargetInventory {
  const text = new Map(raw.map((s) => [s.file, s.text]));
  const sites = scopedHandlers(raw).filter(
    (s) => isScopeChecked(s) && !s.body.includes(CLEANUP_MARKER),
  );
  const skipped = sites.filter((s) => /\[\d+\]$/.test(s.key)).map((s) => s.key);
  const entries = sites
    .filter((s) => !/\[\d+\]$/.test(s.key))
    .map((s): TargetEntry => {
      const [file = '', member = ''] = s.key.split('#');
      const [first = '', second] = member.split('.');
      const src = stripComments(text.get(file) ?? '');
      const classes = second === undefined ? classesIn(src) : [first];
      const binds = BINDS_GATEWAY.test(stripComments(s.body));
      const gate: GateRoute = binds ? 'callback' : 'direct';
      return { key: s.key, classes, method: second ?? first, gate };
    });
  return collect(entries, index, skipped);
}

/** The cleanup-marked scoped handlers (must still run while off). */
export function cleanupHandlerKeys(raw: readonly ScanSource[]): string[] {
  return scopedHandlers(raw)
    .filter((s) => s.body.includes(CLEANUP_MARKER))
    .map((s) => s.key);
}

const CRON_METHOD =
  /@Cron\([\s\S]*?\)\s*\n\s*(?:(?:public|private|protected)\s+)?(?:async\s+)?(\w+)\s*\(/g;

/** Every `@Cron` method in a scoped (non-core) plugin folder. */
export function scopedCronTargets(
  raw: readonly ScanSource[],
  index: ReadonlyMap<string, object>,
): TargetInventory {
  const entries = raw
    .filter((s) => scopedFolder(s.file) !== undefined)
    .flatMap((s) => {
      const text = stripComments(s.text);
      return [...text.matchAll(CRON_METHOD)].map((m): TargetEntry => ({
        key: `${s.file}#${m[1] ?? ''}`,
        classes: classesIn(text),
        method: m[1] ?? '',
        gate: 'direct',
      }));
    });
  return collect(entries, index, []);
}
