/**
 * ROK-1854 — the hub Planner tab adapter: reads the Pelican server id off
 * the hub page. Default export so the tab can be `React.lazy`-loaded.
 */
import type { JSX } from 'react';
import type { HubCtx } from '../../hub-module';
import { ValheimPlannerTab } from '../planner/valheim-planner-tab';

/** Renders nothing when the hub is not mapped to a Pelican server. */
export default function ValheimPlannerHubTab({
    page,
}: HubCtx): JSX.Element | null {
    const serverId = page.server?.pelicanServerId;
    if (serverId === undefined) return null;
    return <ValheimPlannerTab serverId={serverId} />;
}
