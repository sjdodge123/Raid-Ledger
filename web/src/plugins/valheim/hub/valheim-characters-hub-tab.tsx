/**
 * ROK-1836 — the hub tab adapter: reads the Pelican server id off the hub
 * page and renders the Characters list. Default export so the tab can be
 * `React.lazy`-loaded and `hub-page` stays flat.
 */
import type { JSX } from 'react';
import type { HubCtx } from '../../hub-module';
import { ValheimCharactersTab } from './valheim-characters-tab';

export default function ValheimCharactersHubTab({
    page,
}: HubCtx): JSX.Element | null {
    const serverId = page.server?.pelicanServerId;
    if (serverId === undefined) return null;
    return <ValheimCharactersTab serverId={serverId} />;
}
