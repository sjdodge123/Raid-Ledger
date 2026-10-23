/**
 * ROK-1870 — one Join / Leave / member command changes what four surfaces
 * show: the nav's "your hubs" (`/guilds/mine`), the hub page itself, every
 * game page Hubs card (ROK-1883) and every `/hubs` directory listing (any
 * filter set — a `membership=not-joined` list must drop a joined hub).
 */
import type { QueryClient } from '@tanstack/react-query';
import { guildPageKey } from '../api/use-guild';
import { MY_GUILDS_KEY_PREFIX } from '../api/use-guild-content';

/** Refetch every query that shows `hubId`'s membership. */
export async function invalidateHubMembership(qc: QueryClient, hubId: number): Promise<void> {
    await Promise.all([
        qc.invalidateQueries({ queryKey: MY_GUILDS_KEY_PREFIX }),
        qc.invalidateQueries({ queryKey: guildPageKey(hubId) }),
        qc.invalidateQueries({ queryKey: ['game-hubs'] }),
        qc.invalidateQueries({ queryKey: ['hubs-directory'] }),
    ]);
}

/** Every hub page AND `/guilds/mine` live under this prefix (see `guildPageKey`). */
const HUB_PAGES_PREFIX = ['plugins', 'wow', 'guilds'] as const;

/**
 * ROK-1875 (Codex r5 P2) — a character change (delete, addon import) can add
 * or drop any hub: WoW guild membership derives from GUID-linked characters,
 * and the hub it touched is unknown here. Refetch every hub listing and page.
 */
export async function invalidateAllHubMemberships(qc: QueryClient): Promise<void> {
    await Promise.all([
        qc.invalidateQueries({ queryKey: HUB_PAGES_PREFIX }),
        qc.invalidateQueries({ queryKey: ['game-hubs'] }),
        qc.invalidateQueries({ queryKey: ['hubs-directory'] }),
    ]);
}
