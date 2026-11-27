/**
 * ROK-2365 — plugin-scope guard, controller half (split out:
 * `hub-registration-scan.ts` is at its size limit). Every `@Controller` under
 * `api/src/plugins/<x>/` (x not `core` / `plugin-host`) must carry BOTH
 * `PluginActiveGuard` and `@RequirePlugin(...)` — on the class, or on every
 * route method (either half may sit on the class) — or appear in the guard's
 * allowlist with a reason from {@link SCOPE_REASON}. `RequirePlugin` alone is
 * inert: `PluginActiveGuard` is not an APP_GUARD.
 *
 * The handler half lives in `hub-registration-scan.handlers.ts`. Sources are
 * the comment-stripped {@link ScanSource}s every guard here uses.
 */
import type { ScanSource } from './hub-registration-scan';

/** `<file>#<ClassName or handler>` → reason. */
export type ScopeAllowlist = Readonly<Record<string, string>>;

/** Plugin folders whose code is always on (Core) or is the plugin host itself. */
const EXEMPT_FOLDERS: readonly string[] = ['core', 'plugin-host'];

/**
 * The fixed reason set; `gap:` marks a real gap the Lead files as a story.
 * `core-auth`: sign-in/link is core and runs with its plugin off (operator
 * ruling 2026-11-27, ROK-2365 follow-up).
 */
export const SCOPE_REASON =
  /^(cleanup|core-auth|demo-only|service-checks-active|own-guard: [A-Z]\w+|gap: \S.*)$/;

const ROUTE = /@(Get|Post|Put|Patch|Delete|All|Head|Options|Sse)\(/;
const GUARD = /\bPluginActiveGuard\b/;
const REQUIRE = /@RequirePlugin\(/;

/** `plugins/<x>/…` → `x` when x is a scoped (non-core, non-host) plugin folder. */
export function scopedFolder(file: string): string | undefined {
  const folder = /^plugins\/([^/]+)\//.exec(file)?.[1];
  if (folder === undefined || EXEMPT_FOLDERS.includes(folder)) return undefined;
  return folder;
}

/** One `@Controller` class: its decorator header and its body. */
export interface ControllerSite {
  key: string;
  header: string;
  body: string;
}

/** Every `@Controller` class in one source, header = decorators above `class`. */
function controllersIn(src: ScanSource): ControllerSite[] {
  const starts = [...src.text.matchAll(/@Controller\(/g)].map(
    (m) => m.index ?? 0,
  );
  return starts.flatMap((at, i) => {
    const cls = /class (\w+)/g;
    cls.lastIndex = at;
    const m = cls.exec(src.text);
    if (m === null) return [];
    const end = starts[i + 1] ?? src.text.length;
    return [
      {
        key: `${src.file}#${m[1] ?? ''}`,
        header: src.text.slice(src.text.lastIndexOf(';', at) + 1, m.index),
        body: src.text.slice(m.index, end),
      },
    ];
  });
}

/** Every scoped plugin controller in `sources`. */
export function scopedControllers(
  sources: readonly ScanSource[],
): ControllerSite[] {
  return sources
    .filter((s) => scopedFolder(s.file) !== undefined)
    .flatMap(controllersIn);
}

/** Net `(` minus `)` on one line. */
function parenDelta(line: string): number {
  return (line.match(/\(/g) ?? []).length - (line.match(/\)/g) ?? []).length;
}

/** The decorator block above each class member (prettier: 2-space indent). */
export function memberDecorators(body: string): string[] {
  const groups: string[] = [];
  let cur: string[] = [];
  let depth = 0;
  for (const line of body.split('\n')) {
    if (depth > 0 || /^ {2}@\w/.test(line)) {
      cur.push(line);
      depth += parenDelta(line);
    } else if (cur.length > 0) {
      groups.push(cur.join('\n'));
      cur = [];
    }
  }
  return groups;
}

/** True when the class, or every route of it, is behind the plugin-active guard. */
export function isPluginGuarded(site: ControllerSite): boolean {
  const guard = GUARD.test(site.header);
  const require = REQUIRE.test(site.header);
  if (guard && require) return true;
  const routes = memberDecorators(site.body).filter((g) => ROUTE.test(g));
  return (
    routes.length > 0 &&
    routes.every(
      (g) => (guard || GUARD.test(g)) && (require || REQUIRE.test(g)),
    )
  );
}

/** Problems with one allowlist entry: bad reason, or an `own-guard` the class lacks. */
export function reasonProblems(
  key: string,
  reason: string,
  text: string | undefined,
): string[] {
  if (!SCOPE_REASON.test(reason)) {
    return [`${key}: allowlist reason "${reason}" is not in the fixed set`];
  }
  const own = /^own-guard: (\w+)$/.exec(reason)?.[1];
  if (own !== undefined && !new RegExp(`\\b${own}\\b`).test(text ?? '')) {
    return [`${key}: allowlisted as own-guard ${own}, which it does not use`];
  }
  return [];
}

/** Stale entries: allowlisted but missing, or allowlisted yet compliant. */
function staleEntries(
  sites: readonly ControllerSite[],
  allow: ScopeAllowlist,
): string[] {
  return Object.keys(allow).flatMap((key) => {
    const site = sites.find((s) => s.key === key);
    if (site === undefined) {
      return [`${key}: allowlisted but no such scoped controller`];
    }
    if (isPluginGuarded(site)) {
      return [`${key}: allowlisted but already plugin-guarded — drop it`];
    }
    return reasonProblems(key, allow[key] ?? '', site.header + site.body);
  });
}

/** Every unguarded, un-allowlisted scoped controller, plus allowlist problems. */
export function controllerScopeViolations(
  sources: readonly ScanSource[],
  allow: ScopeAllowlist,
): string[] {
  const sites = scopedControllers(sources);
  const unguarded = sites
    .filter((s) => !isPluginGuarded(s) && allow[s.key] === undefined)
    .map(
      (s) =>
        `${s.key} is not behind @RequirePlugin + PluginActiveGuard (class or every route) and is not allowlisted`,
    );
  return [...unguarded, ...staleEntries(sites, allow)];
}
