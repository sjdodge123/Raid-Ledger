/**
 * ROK-1891 — `/hubs/:id` is the hub page for every hub kind (WoW guilds,
 * server hubs, community hubs). The old `/guilds/:id…` links — Discord embeds,
 * stored notification URLs, bookmarks — land here and are sent on to the same
 * path under `/hubs/`, keeping the `?post=` query and the `#tab` fragment.
 */
import type { JSX } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { hubPathFromLegacy } from './hub-paths';

export function LegacyHubRedirect(): JSX.Element {
    const { pathname, search, hash } = useLocation();
    return <Navigate to={{ pathname: hubPathFromLegacy(pathname), search, hash }} replace />;
}
