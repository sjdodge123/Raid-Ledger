/**
 * ROK-1969 review M1 — a source scan of every live hub registration on the
 * api, resolved to `owner/kind/id`, for the A3 guard
 * (`plugins/plugin-host/hub-ownership.guard.spec.ts`). The guard compares
 * the result with `HUB_PLUGIN_MANIFESTS` in BOTH directions, so a new
 * registration of any hub kind fails until it is declared under its owner.
 *
 * Sources passed in are comment-stripped. An expression the scan cannot
 * resolve (a key, an owner) is a problem, never a silent skip: add it to the
 * guard's constant table instead.
 */
import type {
  HubBehaviourKind,
  PluginHubManifest,
} from '@raid-ledger/contract';
import { mediaSourceGates, mediaSubjects } from './hub-registration-scan.media';

/** One comment-stripped source file, path relative to `api/src`. */
export interface ScanSource {
  file: string;
  text: string;
}

/** What the scan found: `owner/kind/id` keys plus anything it could not resolve. */
export interface ScanResult {
  keys: string[];
  problems: string[];
}

/** `EXTENSION_POINTS.<name>` of each hub point → the behaviour kind it declares. */
export const HUB_POINT_KINDS: Readonly<Record<string, HubBehaviourKind>> = {
  HUB_KIND: 'hub-kind',
  EVENT_GUILD_TAGGER: 'event-tagger',
  GAME_LOG_PARSER: 'log-parser',
  CRON_REGISTRAR: 'scheduled-job',
};

/** Kinds this scan has a live-registration scanner for. */
export const SCANNED_KINDS: readonly HubBehaviourKind[] = [
  ...Object.values(HUB_POINT_KINDS),
  'media-decorator',
  'media-subject',
  'ingest-source',
  'media-gate',
];

/** A registration key whose declared id differs (the tagger's `*` key). */
const KEY_TO_ID: Readonly<Record<string, string>> = {
  'event-tagger:*': 'event-guild-tagger',
};

/** Split a call's argument text on top-level commas. */
function splitArgs(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of text) {
    if ('({['.includes(ch)) depth += 1;
    if (')}]'.includes(ch)) depth -= 1;
    if (ch === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim() !== '') out.push(cur.trim());
  return out;
}

/** `this.<field>` → the literal `readonly <prop> = '<x>'` of the field's class. */
function resolveFieldProp(
  field: string,
  prop: string,
  src: ScanSource,
  all: readonly ScanSource[],
): string | undefined {
  const cls = new RegExp(`\\b${field}\\??:\\s*(\\w+)`).exec(src.text)?.[1];
  if (cls === undefined) return undefined;
  const def = all.find((s) => new RegExp(`class ${cls}\\b`).test(s.text));
  const re = new RegExp(`readonly ${prop}(?::\\s*\\w+)?\\s*=\\s*'([^']+)'`);
  return re.exec(def?.text ?? '')?.[1];
}

/** `this.<field>.kind` → the `readonly kind = '<x>'` of the field's class. */
function resolveAdapterKind(
  expr: string,
  src: ScanSource,
  all: readonly ScanSource[],
): string | undefined {
  const field = /^this\.(\w+)\.kind$/.exec(expr)?.[1];
  return field === undefined
    ? undefined
    : resolveFieldProp(field, 'kind', src, all);
}

/** A key/owner expression → its value: a literal, a known constant, or an adapter kind. */
export function resolveExpr(
  expr: string,
  src: ScanSource,
  all: readonly ScanSource[],
  constants: Readonly<Record<string, string>>,
): string | undefined {
  const literal = /^'([^']*)'$/.exec(expr)?.[1];
  if (literal !== undefined) return literal;
  const local = new RegExp(`const ${expr} = '([^']+)'`).exec(src.text)?.[1];
  return (
    new Map(Object.entries(constants)).get(expr) ??
    local ??
    resolveAdapterKind(expr, src, all)
  );
}

/** The owner expression: inline `{ ownerPluginId: X }` or a same-file `const opts = { ownerPluginId: X }`. */
function ownerExpr(
  opts: string | undefined,
  src: ScanSource,
): string | undefined {
  if (opts === undefined) return undefined;
  const inline = /ownerPluginId:\s*([\w.']+)/.exec(opts)?.[1];
  if (inline !== undefined) return inline;
  const decl = new RegExp(
    `const ${opts} = \\{\\s*ownerPluginId:\\s*([\\w.']+)`,
  );
  return decl.exec(src.text)?.[1];
}

/** Every `owner/kind/id` key a manifest set declares; media decorators count per owner. */
export function declaredKeys(
  manifests: Readonly<Record<string, PluginHubManifest>>,
): string[] {
  return Object.entries(manifests).flatMap(([owner, m]) => {
    let decorators = 0;
    return m.behaviours.map((b) =>
      b.kind === 'media-decorator'
        ? `${owner}/media-decorator/#${(decorators += 1)}`
        : `${owner}/${b.kind}/${b.id}`,
    );
  });
}

/** Both directions: live but undeclared, declared but not live, declared of an unscanned kind. */
export function ownershipDrift(
  live: readonly string[],
  manifests: Readonly<Record<string, PluginHubManifest>>,
): string[] {
  const declared = declaredKeys(manifests);
  const unscanned = Object.entries(manifests).flatMap(([owner, m]) =>
    m.behaviours
      .filter((b) => !SCANNED_KINDS.includes(b.kind))
      .map(
        (b) =>
          `${owner}/${b.kind}/${b.id} is declared but the guard has no scanner for "${b.kind}"`,
      ),
  );
  return [
    ...live
      .filter((k) => !declared.includes(k))
      .map(
        (k) => `${k} is registered but not declared in HUB_PLUGIN_MANIFESTS`,
      ),
    ...declared
      .filter(
        (k) =>
          !live.includes(k) && SCANNED_KINDS.some((s) => k.includes(`/${s}/`)),
      )
      .map((k) => `${k} is declared but nothing registers it`),
    ...unscanned,
  ];
}

/** The constant table and plugin-folder owners the guard resolves through. */
export interface ScanContext {
  constants: Readonly<Record<string, string>>;
  /** `api/src/plugins/<folder>/` → owning plugin slug, for bare `@Cron`s. */
  folderOwners: Readonly<Record<string, string>>;
}

type Found = { key?: string; problem?: string };

/** One `registerAdapter(...)` call → its `owner/kind/id`, or a problem. */
function adapterCall(
  args: string[],
  src: ScanSource,
  all: readonly ScanSource[],
  ctx: ScanContext,
): Found | undefined {
  const point = /^EXTENSION_POINTS\.(\w+)$/.exec(args[0] ?? '')?.[1];
  if (point === undefined) {
    return {
      problem: `${src.file}: registerAdapter point "${args[0] ?? ''}" is not an EXTENSION_POINTS member`,
    };
  }
  const kind = new Map(Object.entries(HUB_POINT_KINDS)).get(point);
  if (kind === undefined) return undefined;
  const key = resolveExpr(args[1] ?? '', src, all, ctx.constants);
  const ownerSrc = ownerExpr(args[3], src);
  const owner =
    ownerSrc === undefined
      ? undefined
      : resolveExpr(ownerSrc, src, all, ctx.constants);
  if (key === undefined || owner === undefined) {
    return {
      problem: `${src.file}: ${point} registration — cannot resolve key "${args[1] ?? ''}" / owner "${ownerSrc ?? '(none)'}"`,
    };
  }
  const id = new Map(Object.entries(KEY_TO_ID)).get(`${kind}:${key}`) ?? key;
  return { key: `${owner}/${kind}/${id}` };
}

/** Every `registerAdapter(` call outside plugin-host (which defines it). */
function adapterRegistrations(
  all: readonly ScanSource[],
  ctx: ScanContext,
): Found[] {
  const re = /registerAdapter\(([\s\S]*?)\);/g;
  return all
    .filter((s) => !s.file.startsWith('plugins/plugin-host/'))
    .flatMap((src) =>
      [...src.text.matchAll(re)].flatMap(
        (m) => adapterCall(splitArgs(m[1] ?? ''), src, all, ctx) ?? [],
      ),
    );
}

/** Every bare `@Cron(…, { name })` under `api/src/plugins/<folder>/`, owned by its folder. */
function bareCrons(all: readonly ScanSource[], ctx: ScanContext): Found[] {
  const re = /@Cron\([^)]*?name:\s*([\w']+)/g;
  return all.flatMap((src) => {
    const folder = /^plugins\/([^/]+)\//.exec(src.file)?.[1];
    if (folder === undefined) return [];
    return [...src.text.matchAll(re)].map((m): Found => {
      const owner = new Map(Object.entries(ctx.folderOwners)).get(folder);
      const id = resolveExpr(m[1] ?? '', src, all, ctx.constants);
      if (owner === undefined || id === undefined) {
        return {
          problem: `${src.file}: @Cron — no owner for plugins/${folder} or unresolvable name "${m[1] ?? ''}"`,
        };
      }
      return { key: `${owner}/scheduled-job/${id}` };
    });
  });
}

/** Every `HubMediaDecoratorRegistry.register(owner, fn)` call, counted per owner. */
function mediaDecorators(
  all: readonly ScanSource[],
  ctx: ScanContext,
): Found[] {
  const counts = new Map<string, number>();
  return all
    .filter(
      (s) =>
        s.text.includes('HubMediaDecoratorRegistry') &&
        !s.file.startsWith('hub-media/hub-media.decorators'),
    )
    .flatMap((src) =>
      [...src.text.matchAll(/\.register\(\s*([\w.']+)\s*,/g)].map(
        (m): Found => {
          const owner = resolveExpr(m[1] ?? '', src, all, ctx.constants);
          if (owner === undefined)
            return {
              problem: `${src.file}: media decorator owner "${m[1] ?? ''}" is unresolvable`,
            };
          counts.set(owner, (counts.get(owner) ?? 0) + 1);
          return { key: `${owner}/media-decorator/#${counts.get(owner) ?? 0}` };
        },
      ),
    );
}

/** ROK-1965 D17 — every literal `registerHubIngestSource(owner, 'id')` call. */
function ingestSources(all: readonly ScanSource[], ctx: ScanContext): Found[] {
  const re = /registerHubIngestSource\(\s*([\w.']+)\s*,\s*'([\w.-]+)'\s*\)/g;
  return all.flatMap((src) =>
    [...src.text.matchAll(re)].map((m): Found => {
      const owner = resolveExpr(m[1] ?? '', src, all, ctx.constants);
      if (owner === undefined) {
        return {
          problem: `${src.file}: ingest source owner "${m[1] ?? ''}" is unresolvable`,
        };
      }
      return { key: `${owner}/ingest-source/${m[2] ?? ''}` };
    }),
  );
}

/**
 * ROK-1957 D-16 — every `CompanionHandlerRegistry` registration outside
 * `companion/` (which defines it): `.register(owner, this.<handler>)` →
 * `owner/ingest-source/<contract>`, the contract read from the handler
 * class's literal `readonly contract = '<id>'`.
 */
function companionHandlers(
  all: readonly ScanSource[],
  ctx: ScanContext,
): Found[] {
  const re = /\.register\(\s*([\w.']+)\s*,\s*([^)]*?)\s*\)/g;
  return all
    .filter(
      (s) =>
        s.text.includes('CompanionHandlerRegistry') &&
        !s.file.startsWith('companion/'),
    )
    .flatMap((src) =>
      [...src.text.matchAll(re)].map((m): Found => {
        const owner = resolveExpr(m[1] ?? '', src, all, ctx.constants);
        const field = /^this\.(\w+)$/.exec(m[2] ?? '')?.[1];
        const contract = field && resolveFieldProp(field, 'contract', src, all);
        if (owner === undefined || !contract) {
          return {
            problem: `${src.file}: companion handler "${m[2] ?? ''}" — cannot resolve owner "${m[1] ?? ''}" / contract`,
          };
        }
        return { key: `${owner}/ingest-source/${contract}` };
      }),
    );
}

/** Every live hub registration in `sources`, as `owner/kind/id` keys. */
export function scanHubRegistrations(
  sources: readonly ScanSource[],
  ctx: ScanContext,
): ScanResult {
  const found = [
    ...adapterRegistrations(sources, ctx),
    ...bareCrons(sources, ctx),
    ...mediaDecorators(sources, ctx),
    ...mediaSubjects(sources, ctx),
    ...ingestSources(sources, ctx),
    ...companionHandlers(sources, ctx),
    ...mediaSourceGates(sources, ctx),
  ];
  return {
    keys: found.flatMap((f) => (f.key === undefined ? [] : [f.key])),
    problems: found.flatMap((f) =>
      f.problem === undefined ? [] : [f.problem],
    ),
  };
}
