import type { PluginInfoDto } from '@raid-ledger/contract';

/** ROK-1969 §5.4 — built-in plugins (Core) first, everything else in the api's order. */
export function sortCoreFirst(plugins: readonly PluginInfoDto[]): PluginInfoDto[] {
    return [...plugins.filter((p) => p.builtIn), ...plugins.filter((p) => !p.builtIn)];
}
