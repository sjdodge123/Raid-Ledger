/**
 * ROK-1870 — which top-nav item a hub page lights. A WoW guild or game-server
 * page lights "Guild"; a community hub page (`kind: game_community`) lights
 * "Hubs", as does the `/hubs` directory itself.
 */
import type { GuildKind } from '@raid-ledger/contract';
import { useGuildPage } from '../../hub/api/use-guild';
import { HUBS_PATH, useMyGuilds } from './my-hubs-queries';

const HUB_PATH_RE = /^\/guilds\/(\d+)(?:[/?#]|$)/;

/** The hub id in a `/guilds/:id` path, or 0 when the path is not a hub page. */
export function hubIdFromPath(pathname: string): number {
    const id = HUB_PATH_RE.exec(pathname)?.[1];
    return id === undefined ? 0 : Number(id);
}

export interface HubNavActive {
    /** The "Guild" item (a guild / game-server hub page). */
    guild: boolean;
    /** The "Hubs" item (the directory, or a community hub page). */
    hubs: boolean;
}

/**
 * Active state of the Guild / Hubs nav items for `pathname`. The kind comes from
 * the hub page query (shared with the page, so no extra request) or, before it
 * lands, from the viewer's own hub list.
 */
export function useHubNavActive(pathname: string): HubNavActive {
    const id = hubIdFromPath(pathname);
    const page = useGuildPage(id);
    const mine = useMyGuilds().find((g) => g.id === id);
    const kind: GuildKind | undefined = page.data?.guild.kind ?? mine?.kind;
    const community = id > 0 && kind === 'game_community';
    return { guild: id > 0 && !community, hubs: pathname === HUBS_PATH || community };
}
