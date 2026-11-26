/**
 * ROK-2358 — the route seam for a plugin page mounted on a core route
 * (design-system "core lazy route → plugin page", ROK-1836). The page mounts
 * only while its plugin is active; otherwise the route shows `fallback`
 * (default: the app's Page not found), so an inactive plugin's page never
 * renders or fires its plugin's queries.
 *
 * It renders nothing until the active-plugin list has settled, so an active
 * plugin's page is never flashed as "not found" on a cold load.
 */
import type { JSX, ReactNode } from 'react';
import { usePluginsHydrated } from '../../hooks/use-plugins';
import { isSlugActive, usePluginStore } from '../../stores/plugin-store';
import { NotFoundPage } from '../../pages/not-found-page';

interface PluginRouteProps {
    /** The owning plugin's slug (`blizzard`, `valheim`, …). */
    slug: string;
    children: ReactNode;
    /** Shown while the plugin is inactive. Defaults to `<NotFoundPage />`. */
    fallback?: ReactNode;
}

export function PluginRoute({ slug, children, fallback }: PluginRouteProps): JSX.Element | null {
    const hydrated = usePluginsHydrated();
    const active = usePluginStore((s) => isSlugActive(s.activeSlugs, slug));
    if (!hydrated) return null;
    if (!active) return <>{fallback ?? <NotFoundPage />}</>;
    return <>{children}</>;
}
