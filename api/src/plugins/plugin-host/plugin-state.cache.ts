import { CORE_PLUGIN_ID, type PluginInfoDto } from '@raid-ledger/contract';

/** A plugin's install state on this server (`PluginInfoDto.status` vocabulary). */
export type PluginInstallState = PluginInfoDto['status'];

/** One `plugins` row as the cache needs it. */
export interface PluginStateRow {
  slug: string;
  active: boolean;
}

/**
 * ROK-2067 D2 — sync view of the `plugins` table: which slugs are active and
 * which are installed at all. `PluginRegistryService.refreshActiveCache`
 * fills it from ONE query after every install/uninstall/activate/deactivate.
 * Core is active even before its row exists (ROK-1969 D3).
 */
export class PluginStateCache {
  private activeSet = new Set<string>([CORE_PLUGIN_ID]);
  private installedSet = new Set<string>([CORE_PLUGIN_ID]);

  get active(): ReadonlySet<string> {
    return this.activeSet;
  }

  /** Replace both sets from every `plugins` row (empty = table missing). */
  replace(rows: readonly PluginStateRow[]): void {
    this.installedSet = new Set([CORE_PLUGIN_ID, ...rows.map((r) => r.slug)]);
    this.activeSet = new Set([
      CORE_PLUGIN_ID,
      ...rows.filter((r) => r.active).map((r) => r.slug),
    ]);
  }

  /** `active` when `isActive` says so, else `inactive` if a row exists. */
  stateOf(slug: string, isActive: boolean): PluginInstallState {
    if (isActive) return 'active';
    return this.installedSet.has(slug) ? 'inactive' : 'not_installed';
  }
}
