// Types for plugin-boundary.mjs, so TypeScript specs (web/src/plugins/plugin-boundary.rule.test.ts)
// can import the rule under strict mode. Keep in step with the JSDoc there. (ROK-2366)
import type { Rule } from 'eslint';

export interface PluginBoundaryOptions {
  aliases?: Record<string, string>;
  hostDirs?: readonly string[];
  entries?: readonly string[];
}

export function loadAllowlist(file: string): Record<string, string[]>;
export function pluginOf(rel: string, hostDirs: readonly string[]): { slug: string; rest: string } | null;
export function createPluginBoundaryRule(
  opts: { workspaceDir: string; allowlistFile: string } & PluginBoundaryOptions,
): Rule.RuleModule;
export function pluginBoundaryBlock(
  opts: { workspaceDir: string; files: string[]; ignores: string[] } & PluginBoundaryOptions,
): Record<string, unknown>;
