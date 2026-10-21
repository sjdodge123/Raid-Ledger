/**
 * ROK-1875 D4 — the single "Hubs" nav item is active on the `/hubs` directory
 * and on every hub page (`/guilds/:id…`), whatever the hub's kind. (ROK-1870
 * split this between a Guild and a Hubs item via a kind lookup; there is no
 * Guild item left to light.)
 */
import { HUBS_PATH } from './my-hubs-queries';

const HUB_PATH_RE = /^\/guilds\/(\d+)(?:[/?#]|$)/;

/** The hub id in a `/guilds/:id` path, or 0 when the path is not a hub page. */
export function hubIdFromPath(pathname: string): number {
    const id = HUB_PATH_RE.exec(pathname)?.[1];
    return id === undefined ? 0 : Number(id);
}

/** Whether `pathname` lights the Hubs nav item. */
export function isHubsNavActive(pathname: string): boolean {
    return pathname === HUBS_PATH || hubIdFromPath(pathname) > 0;
}
