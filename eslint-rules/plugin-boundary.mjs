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
 *     `plugin-boundary-allowlist` spec (the rule never sees a deleted file).
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
    if (specifier.startsWith(prefix)) targetAbs = path.join(dir, specifier.slice(prefix.length));
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
        stale: "{{list}} lists '{{spec}}' for this file, but it no longer deep-imports a plugin. Delete the entry — the allowlist only shrinks. (ROK-2366)",
      },
    },
    create(context) {
      const fromAbs = context.filename;
      const fromRel = toPosix(path.relative(srcDir, fromAbs));
      if (fromRel.startsWith('..')) return {};
      const wsRel = toPosix(path.relative(workspaceDir, fromAbs));
      /** @type {Record<string, string[]>} */
      const allowlist = context.options[0]?.allowlist ?? {};
      const allowed = new Set(allowlist[wsRel] ?? []);
      const seen = new Set();
      /** @param {any} node */
      const check = (node) => {
        const src = node && node.source;
        if (!src || src.type !== 'Literal' || typeof src.value !== 'string') return;
        const spec = src.value;
        const slug = crossesBoundary({ fromRel, specifier: spec, srcDir, fromAbs, aliases, hostDirs, entries });
        if (slug === null) return;
        seen.add(spec);
        if (allowed.has(spec)) return;
        context.report({ node: src, messageId: 'deep', data: { spec, slug } });
      };
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
    rules: { 'rl-plugin-boundary/deep-import': ['error', { allowlist: loadAllowlist(allowlistFile) }] },
  };
}
