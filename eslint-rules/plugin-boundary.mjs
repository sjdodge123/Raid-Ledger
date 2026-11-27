// @ts-check
/**
 * ROK-2366 — plugin import boundary, shared by api/eslint.config.mjs and
 * web/eslint.config.js.
 *
 * A file outside `src/plugins/<x>/` may reach `plugins/<x>/**` only through
 * `plugins/<x>/index.ts` (written `plugins/<x>` or `plugins/<x>/index`), or
 * another entry file the workspace names (web: each plugin's `register.ts`,
 * which App.tsx imports by design — ROK-1969).
 * Today's offenders are frozen in a per-workspace allowlist
 * (`<workspace>/plugin-boundary-allowlist.json`, `{ "src/file.ts": [specifier] }`)
 * that may only SHRINK:
 *   - a new deep import is not listed, so it fails lint;
 *   - a listed specifier the file no longer imports (or that no longer crosses
 *     the boundary) is reported as STALE on that file, so it must be deleted;
 *   - a listed file that no longer exists fails the workspace's
 *     `plugin-boundary-allowlist` spec (the rule never sees a deleted file);
 *   - each list's total is pinned as a ceiling in that spec, so adding an
 *     entry fails it and raising the pin is a visible, reviewed number edit.
 *
 * Checked: `import`, `export … from`, `export * from`, `import('literal')`
 * (a template with no `${…}` counts as a literal), and a computed `import()`
 * (template literal with `${…}` / `'…' + x`) whose static prefix already lands
 * inside `plugins/<x>/` — that one is never allowlistable.
 * `// eslint-disable… rl-plugin-boundary/*` is banned by
 * `eslint-comments/no-restricted-disable` in pluginBoundaryBlock, so the
 * allowlist is the only escape hatch.
 * Known gaps (none occur in non-test src today): a computed `import()` whose
 * static prefix stops short of `plugins/<x>/` (e.g. `` `./plugins/${p}` ``), `require(…)`,
 * `import x = require(…)` and `typeof import(…)` type queries.
 * Spec: web/src/plugins/plugin-boundary.rule.test.ts (RuleTester).
 */
import fs from 'node:fs';
import path from 'node:path';

/** @param {string} p */
const toPosix = (p) => p.split(path.sep).join('/');

/**
 * @param {string} file allowlist path
 * @returns {Record<string, string[]>}
 */
export function loadAllowlist(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/**
 * The plugin a src-relative path sits in, or null.
 * @param {string} rel src-relative posix path
 * @param {readonly string[]} hostDirs plugin-folder names that are host code, not plugins
 */
export function pluginOf(rel, hostDirs) {
  const m = /^plugins\/([^/]+)\/(.+)$/.exec(rel);
  if (!m) return null;
  const [, slug = '', rest = ''] = m;
  if (hostDirs.includes(slug)) return null;
  return { slug, rest };
}

/**
 * The plugin slug `specifier` deep-imports from `fromRel` (src-relative), or null.
 * @param {{ fromRel: string, specifier: string, srcDir: string, fromAbs: string,
 *   aliases: Record<string, string>, hostDirs: readonly string[], entries: readonly string[] }} args
 */
export function crossesBoundary({ fromRel, specifier, srcDir, fromAbs, aliases, hostDirs, entries }) {
  let targetAbs = null;
  if (specifier.startsWith('.')) targetAbs = path.resolve(path.dirname(fromAbs), specifier);
  for (const [prefix, dir] of Object.entries(aliases)) {
    if (!specifier.startsWith(prefix)) continue;
    targetAbs = path.join(dir, specifier.slice(prefix.length));
    break;
  }
  if (targetAbs === null) return null;
  const target = pluginOf(toPosix(path.relative(srcDir, targetAbs)), hostDirs);
  if (!target || entries.includes(target.rest.replace(/\.[jt]sx?$/, ''))) return null;
  return fromRel.startsWith(`plugins/${target.slug}/`) ? null : target.slug;
}

/**
 * @param {{ workspaceDir: string, allowlistFile: string,
 *   aliases?: Record<string, string>, hostDirs?: readonly string[], entries?: readonly string[] }} opts
 * @returns {import('eslint').Rule.RuleModule}
 */
export function createPluginBoundaryRule({ workspaceDir, allowlistFile, aliases = {}, hostDirs = [], entries = ['index'] }) {
  const srcDir = path.join(workspaceDir, 'src');
  const listName = toPosix(path.relative(workspaceDir, allowlistFile));
  return {
    meta: {
      type: 'problem',
      // The allowlist rides in as the rule's option (see pluginBoundaryBlock) so
      // it is part of ESLint's config hash: editing it invalidates --cache results.
      schema: [{ type: 'object', properties: { allowlist: { type: 'object' } }, additionalProperties: false }],
      messages: {
        deep: "'{{spec}}' reaches inside plugin '{{slug}}'. Import it through plugins/{{slug}}/index.ts (export it there) instead. (ROK-2366)",
        computed: "A computed import() reaches inside plugin '{{slug}}'. Import a named loader exported from plugins/{{slug}}/index.ts instead; computed paths cannot be allowlisted. (ROK-2366)",
        stale: "{{list}} lists '{{spec}}' for this file, but it no longer deep-imports a plugin. Delete the entry — the allowlist only shrinks. (ROK-2366)",
      },
    },
    create(context) {
      const fromAbs = context.filename;
      const fromRel = toPosix(path.relative(srcDir, fromAbs));
      if (fromRel.startsWith('..')) return {};
      /** @type {Record<string, string[]>} */
      const allowlist = context.options[0]?.allowlist ?? {};
      const allowed = new Set(allowlist[toPosix(path.relative(workspaceDir, fromAbs))] ?? []);
      const seen = new Set();
      const base = { fromRel, srcDir, fromAbs, aliases, hostDirs, entries };
      const check = makeCheck({ context, base, allowed, seen });
      return {
        ImportDeclaration: check,
        ExportNamedDeclaration: check,
        ExportAllDeclaration: check,
        ImportExpression: check,
        'Program:exit'(program) {
          for (const spec of allowed) {
            if (!seen.has(spec)) context.report({ node: program, messageId: 'stale', data: { spec, list: listName } });
          }
        },
      };
    },
  };
}

/**
 * The specifier when the source is fully static — a string literal, or a
 * template literal with no `${…}` — else null.
 * @param {any} src
 */
function literalSpecifier(src) {
  if (src.type === 'Literal') return typeof src.value === 'string' ? src.value : null;
  if (src.type === 'TemplateLiteral' && src.expressions.length === 0) return src.quasis[0]?.value.cooked ?? null;
  return null;
}

/**
 * The static prefix of a computed `import()` source, or null.
 * @param {any} src
 */
function staticPrefix(src) {
  if (src.type === 'TemplateLiteral') return src.quasis[0]?.value.cooked ?? null;
  if (src.type === 'BinaryExpression' && src.operator === '+' && src.left.type === 'Literal') {
    return typeof src.left.value === 'string' ? src.left.value : null;
  }
  return null;
}

/**
 * The node visitor: report each deep import that the allowlist does not hold.
 * @param {{ context: import('eslint').Rule.RuleContext, allowed: Set<string>, seen: Set<string>,
 *   base: Omit<Parameters<typeof crossesBoundary>[0], 'specifier'> }} args
 */
function makeCheck({ context, base, allowed, seen }) {
  /** @param {any} node */
  return (node) => {
    const src = node && node.source;
    if (!src) return;
    const spec = literalSpecifier(src);
    if (spec === null) {
      if (src.type === 'Literal') return;
      const prefix = node.type === 'ImportExpression' ? staticPrefix(src) : null;
      // `x` stands in for the computed tail: `./plugins/wow/pages/${p}` → plugins/wow/pages/x.
      const slug = prefix === null ? null : crossesBoundary({ ...base, specifier: `${prefix}x` });
      if (slug !== null) context.report({ node: src, messageId: 'computed', data: { slug } });
      return;
    }
    const slug = crossesBoundary({ ...base, specifier: spec });
    if (slug === null) return;
    seen.add(spec);
    if (!allowed.has(spec)) context.report({ node: src, messageId: 'deep', data: { spec, slug } });
  };
}

/**
 * The flat-config block that turns the rule on (as an error) for one workspace.
 * The allowlist is `<workspaceDir>/plugin-boundary-allowlist.json`.
 * @param {{ workspaceDir: string, files: string[], ignores: string[],
 *   aliases?: Record<string, string>, hostDirs?: readonly string[], entries?: readonly string[] }} opts
 */
export function pluginBoundaryBlock({ workspaceDir, files, ignores, ...rest }) {
  const allowlistFile = path.join(workspaceDir, 'plugin-boundary-allowlist.json');
  const rule = createPluginBoundaryRule({ workspaceDir, allowlistFile, ...rest });
  return {
    files,
    ignores,
    plugins: { 'rl-plugin-boundary': { rules: { 'deep-import': rule } } },
    rules: {
      'rl-plugin-boundary/deep-import': ['error', { allowlist: loadAllowlist(allowlistFile) }],
      // The allowlist is the only escape hatch: an eslint-disable for this rule is itself an error.
      '@eslint-community/eslint-comments/no-restricted-disable': ['error', 'rl-plugin-boundary/*'],
    },
  };
}
