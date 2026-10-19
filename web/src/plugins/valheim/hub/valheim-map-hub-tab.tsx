/**
 * ROK-1837 — the hub Map tab adapter: reads the Pelican server id off the hub
 * page and renders the Map tab. Default export so the tab can be
 * `React.lazy`-loaded and `hub-page` stays flat.
 */
import type { JSX } from 'react';
import type { HubCtx } from '../../hub-module';
import { ValheimMapTab } from '../map/valheim-map-tab';

/** Renders nothing when the hub is not mapped to a Pelican server. */
export default function ValheimMapHubTab({ page }: HubCtx): JSX.Element | null {
    const serverId = page.server?.pelicanServerId;
    if (serverId === undefined) return null;
    return <ValheimMapTab serverId={serverId} />;
}
