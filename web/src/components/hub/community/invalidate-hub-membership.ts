/**
 * ROK-1870 — one Join / Leave / member command changes what four surfaces
 * show: the nav's "your hubs" (`/guilds/mine`), the hub page itself, every
 * game page "Community hubs" card and every `/hubs` directory listing (any
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
