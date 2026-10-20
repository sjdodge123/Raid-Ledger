/**
 * ROK-1853 — the hub Materials tab adapter: reads the Pelican server id off
 * the hub page. Default export so the tab can be `React.lazy`-loaded.
 */
import type { JSX } from 'react';
import type { HubCtx } from '../../hub-module';
import { ValheimMaterialsTab } from '../materials/valheim-materials-tab';

/** Renders nothing when the hub is not mapped to a Pelican server. */
export default function ValheimMaterialsHubTab({
    page,
}: HubCtx): JSX.Element | null {
    const serverId = page.server?.pelicanServerId;
    if (serverId === undefined) return null;
    return <ValheimMaterialsTab serverId={serverId} />;
}
