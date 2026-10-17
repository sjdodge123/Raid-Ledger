/**
 * Plugin game-server status (ROK-1776) — the generic host API a plugin uses to
 * declare that it feeds `GET /game-servers/status`. Plugins declare through
 * `PluginHandle.registerGameServerProvider`; core asks `useGameServerProvidersActive`
 * whether any declaring plugin is active before it requests statuses. Core never
 * imports a plugin's code — `web/src/test/pelican-core-boundary.guard.test.ts`
 * enforces that.
 */
import { usePluginStore } from '../stores/plugin-store';

/** Slugs of plugins that feed the generic game-server status endpoint. */
const providerSlugs = new Set<string>();

/** @internal Called by `PluginHandle.registerGameServerProvider`. Idempotent (HMR). */
export function addGameServerProvider(slug: string): void {
    providerSlugs.add(slug);
}

/** Every declaring plugin slug, regardless of plugin status. */
export function getGameServerProviderSlugs(): readonly string[] {
    return [...providerSlugs];
}

/** @internal Called by `clearRegistry` (tests). */
export function clearGameServerProviders(): void {
    providerSlugs.clear();
}

/** True iff at least one plugin that declared a game-server provider is active. */
export function useGameServerProvidersActive(): boolean {
    return usePluginStore((s) => {
        for (const slug of providerSlugs) {
            if (s.activeSlugs.has(slug)) return true;
        }
        return false;
    });
}
